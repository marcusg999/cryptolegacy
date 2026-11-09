-- ---------------------------------------------------------------------------
-- Legal content library. Spec §2.3.
--
-- READ THIS BEFORE ADDING A ROW.
--
-- The spec is unambiguous: "source this from a verified legal database or
-- attorney review, stored as versioned, citation-bearing content records. DO NOT
-- GENERATE THIS CONTENT FROM MODEL KNOWLEDGE."
--
-- So this migration ships the table, the constraints that make an unreviewed row
-- impossible to publish, and ZERO rows. The app renders an honest empty state
-- for a state with no reviewed content rather than filling the gap with
-- plausible-sounding text, because a confidently wrong answer about what makes a
-- will valid is the most damaging thing this product could say.
--
-- Populating this table is a legal-operations task, not an engineering one.
-- See docs/LEGAL_CONTENT.md for the intake process.
-- ---------------------------------------------------------------------------

create type legal.content_status as enum ('draft', 'in_review', 'published', 'retired');

create table legal.state_requirements (
  id              uuid primary key default gen_random_uuid(),
  -- Two-letter USPS code, plus DC and territories.
  state_code      text not null
    constraint state_code_format check (state_code ~ '^[A-Z]{2}$'),
  version         integer not null
    constraint version_positive check (version >= 1),
  status          legal.content_status not null default 'draft',

  -- The checklist layer the spec asks for: what makes a valid will here, is a
  -- holographic will recognised, is remote online notarisation available, what
  -- does the probate court require. Stored as structured JSON so the UI renders
  -- a checklist rather than a wall of prose.
  checklist       jsonb not null default '[]'::jsonb,
  -- Does this state recognise a handwritten, unwitnessed will?
  holographic_will_recognised boolean,
  -- Is remote online notarisation available?
  remote_notarisation_available boolean,
  -- Has this state adopted an electronic-wills act? Spec §2.2.
  electronic_wills_act_adopted boolean,
  -- Has this state adopted RUFADAA, and under what citation? Spec §2.1.
  rufadaa_adopted boolean,
  rufadaa_citation text,
  notes           text,

  -- Provenance. Spec §2.3: surfaced in the UI, because stale legal content is a
  -- liability rather than a feature.
  source_citations jsonb not null default '[]'::jsonb,
  last_reviewed_at timestamptz,
  reviewed_by     text,
  reviewer_bar_number text,
  reviewer_jurisdiction text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint state_version_unique unique (state_code, version),

  -- A published row MUST carry its provenance. This is the constraint that makes
  -- "do not generate this from model knowledge" enforceable rather than
  -- aspirational: there is no way to publish a row without naming a human
  -- reviewer, a review date, and at least one citation.
  constraint published_rows_are_reviewed check (
    status <> 'published'
    or (
      last_reviewed_at is not null
      and reviewed_by is not null and char_length(reviewed_by) > 0
      and reviewer_jurisdiction is not null and char_length(reviewer_jurisdiction) > 0
      and jsonb_array_length(source_citations) >= 1
      and jsonb_array_length(checklist) >= 1
    )
  )
);

create unique index state_requirements_published_idx
  on legal.state_requirements (state_code)
  where status = 'published';

create index state_requirements_lookup_idx
  on legal.state_requirements (state_code, status, version desc);

create trigger state_requirements_touch
  before update on legal.state_requirements
  for each row execute function vault.touch_updated_at();

comment on table legal.state_requirements is
  'Attorney-reviewed state checklists. Ships EMPTY on purpose: spec §2.3 forbids model-generated legal content.';
comment on constraint published_rows_are_reviewed on legal.state_requirements is
  'A row cannot reach published status without a named reviewer, a review date and a citation.';

-- Guidance documents: the RUFADAA prompt, the "video is evidence not a will"
-- explainer, the probate overview. Same provenance rules.
create table legal.guidance_documents (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null
    constraint slug_format check (slug ~ '^[a-z0-9-]{3,80}$'),
  version         integer not null constraint guidance_version_positive check (version >= 1),
  status          legal.content_status not null default 'draft',
  title           text not null,
  body_markdown   text not null,
  -- Null means the document applies nationally.
  state_code      text constraint guidance_state_format check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  source_citations jsonb not null default '[]'::jsonb,
  last_reviewed_at timestamptz,
  reviewed_by     text,
  reviewer_jurisdiction text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint guidance_slug_version_unique unique (slug, version),
  constraint guidance_published_rows_are_reviewed check (
    status <> 'published'
    or (
      last_reviewed_at is not null
      and reviewed_by is not null and char_length(reviewed_by) > 0
      and reviewer_jurisdiction is not null and char_length(reviewer_jurisdiction) > 0
      and jsonb_array_length(source_citations) >= 1
    )
  )
);

create index guidance_lookup_idx
  on legal.guidance_documents (slug, status, version desc);

create trigger guidance_touch
  before update on legal.guidance_documents
  for each row execute function vault.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: readable by any signed-in user, but only the published versions. Writes
-- go through a privileged legal-ops path, never the client — there is no INSERT,
-- UPDATE or DELETE policy at all.
-- ---------------------------------------------------------------------------
alter table legal.state_requirements enable row level security;
alter table legal.guidance_documents enable row level security;

create policy state_requirements_read_published on legal.state_requirements
  for select to authenticated, anon
  using (status = 'published');

create policy guidance_read_published on legal.guidance_documents
  for select to authenticated, anon
  using (status = 'published');

grant select on legal.state_requirements to authenticated, anon;
grant select on legal.guidance_documents to authenticated, anon;
