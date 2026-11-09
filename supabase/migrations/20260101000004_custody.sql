-- ---------------------------------------------------------------------------
-- Custody plan. Spec §4.
--
-- The division of plaintext from ciphertext here is the point of the whole
-- schema, so it is worth stating once more: spec §4.1 requires that locations
-- and custodian identities live inside the encrypted vault. They do — in
-- `detail_*` columns that are AES-256-GCM blobs under a per-point DEK wrapped by
-- the vault master key. What stays readable is the shape of the arrangement:
-- how many points, what type each is, whether it holds a full copy or a part,
-- and when it was last verified. That is exactly, and only, what the dashboard
-- needs to flag an at-risk arrangement while the vault is locked, and what an
-- executor is shown after death verification (spec §4.4).
-- ---------------------------------------------------------------------------

create type custody.mode as enum ('redundancy', 'split', 'hybrid');
create type custody.point_type as enum ('person', 'institution', 'location', 'other');
create type custody.holding as enum ('full_copy', 'split_part');

create table custody.plans (
  vault_id        uuid primary key references vault.vaults (id) on delete cascade,
  mode            custody.mode not null default 'redundancy',
  -- Spec §4.2 requires the entropy arithmetic be shown in the UI, and the
  -- dashboard must be able to warn about a dangerous split while locked, so the
  -- word count is stored. It is metadata about the shape of the secret, not the
  -- secret: it narrows a search space of 2^155 to a search space of 2^155.
  -- Recorded as a deliberate, bounded disclosure in SECURITY.md.
  passphrase_word_count integer not null
    constraint word_count_range check (passphrase_word_count between 12 and 36),
  part_count      integer not null default 1
    constraint part_count_positive check (part_count >= 1),
  -- Spec §4.3: default annual, configurable quarterly.
  verification_interval_months integer not null default 12
    constraint verification_interval_allowed check (verification_interval_months in (3, 6, 12)),
  -- Spec §4.4: warn when the printed letter drifts behind the plan.
  plan_last_modified_at   timestamptz not null default now(),
  letter_last_generated_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint parts_fit_in_phrase check (part_count <= passphrase_word_count)
);

create trigger plans_touch
  before update on custody.plans
  for each row execute function vault.touch_updated_at();

comment on column custody.plans.letter_last_generated_at is
  'Set when the user generates an Executor Letter. The letter itself is never stored (spec §4.4).';

create table custody.points (
  id              uuid primary key default gen_random_uuid(),
  vault_id        uuid not null references vault.vaults (id) on delete cascade,
  point_type      custody.point_type not null,
  holding         custody.holding not null default 'full_copy',
  part_index      integer
    constraint part_index_positive check (part_index is null or part_index >= 1),
  -- ENCRYPTED. Label, custodian name, contact, address, notes — one JSON blob,
  -- sealed under a per-point DEK which is itself wrapped by the vault master key.
  detail_wrapped_dek_iv bytea not null
    constraint point_dek_iv_length check (octet_length(detail_wrapped_dek_iv) = 12),
  detail_wrapped_dek    bytea not null
    constraint point_dek_length check (octet_length(detail_wrapped_dek) = 48),
  detail_iv       bytea not null
    constraint point_detail_iv_length check (octet_length(detail_iv) = 12),
  detail          bytea not null
    constraint point_detail_size check (octet_length(detail) between 17 and 65536),
  envelope_version smallint not null default 1,
  last_verified_at timestamptz,
  display_order   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A part-holder needs a part number; a full-copy holder must not have one.
  constraint part_index_matches_holding check (
    (holding = 'split_part' and part_index is not null)
    or (holding = 'full_copy' and part_index is null)
  )
);

create index points_vault_idx on custody.points (vault_id, display_order);

create trigger points_touch
  before update on custody.points
  for each row execute function vault.touch_updated_at();

comment on column custody.points.detail is
  'ENCRYPTED JSON: label, custodianName, contact, locationNotes, notes. The server cannot read it.';
comment on column custody.points.point_type is
  'PLAINTEXT. Needed to warn about correlated failure modes without an unlock.';

-- Spec §4.3: the custody check. A dated record that the user confirmed a point
-- was reachable and intact. This is the differentiator the spec names, so the
-- history is kept rather than just the latest timestamp — "verified annually
-- since 2026" is a far stronger trust signal than "verified recently".
create table custody.checks (
  id          uuid primary key default gen_random_uuid(),
  point_id    uuid not null references custody.points (id) on delete cascade,
  vault_id    uuid not null references vault.vaults (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  -- What the user asserted. Nothing about the contents of the envelope.
  outcome     text not null
    constraint check_outcome_known check (outcome in ('intact', 'moved', 'missing', 'unreachable')),
  created_at  timestamptz not null default now()
);

create index checks_point_idx on custody.checks (point_id, checked_at desc);

-- A verification history that can be edited afterwards is not evidence.
create trigger checks_append_only
  before update or delete on custody.checks
  for each row execute function vault.forbid_mutation();

-- Keep points.last_verified_at in step with the check history automatically, so
-- the dashboard and the health report cannot disagree with the audit trail.
create or replace function custody.apply_check_to_point()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.outcome = 'intact' then
    update custody.points
       set last_verified_at = new.checked_at
     where id = new.point_id
       and (last_verified_at is null or last_verified_at < new.checked_at);
  end if;
  return new;
end;
$$;

create trigger checks_update_point
  after insert on custody.checks
  for each row execute function custody.apply_check_to_point();

-- Spec §4.4: any change to the plan invalidates the printed letter. Maintained
-- in the database so a client that forgets to update the timestamp cannot leave
-- the user believing a stale letter is current.
-- `clock_timestamp()`, not `now()`. `now()` is the transaction start time and is
-- identical for every statement in the transaction, so a plan edit and a letter
-- generation landing in the same transaction would tie, and the drift check
-- would report the stale letter as current. `clock_timestamp()` advances within
-- a transaction, so the ordering is real.
create or replace function custody.mark_plan_modified()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_vault_id uuid := coalesce(new.vault_id, old.vault_id);
begin
  update custody.plans
     set plan_last_modified_at = clock_timestamp()
   where vault_id = v_vault_id;
  return coalesce(new, old);
end;
$$;

-- Recording that a letter was printed goes through this function for the same
-- reason: both sides of the drift comparison must come from the same clock.
create or replace function custody.record_letter_generated(p_vault_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_at timestamptz := clock_timestamp();
begin
  update custody.plans
     set letter_last_generated_at = v_at
   where vault_id = p_vault_id;

  if not found then
    raise exception 'No custody plan for vault %', p_vault_id
      using errcode = 'no_data_found';
  end if;
  return v_at;
end;
$$;

comment on function custody.record_letter_generated(uuid) is
  'Stamps letter_last_generated_at. SECURITY INVOKER, so the caller''s RLS still applies.';

revoke all on function custody.record_letter_generated(uuid) from public;
grant execute on function custody.record_letter_generated(uuid) to authenticated;

-- Fires on anything that changes what the letter TELLS THE EXECUTOR TO DO, and
-- on nothing else.
--
-- In particular, a routine custody verification must NOT invalidate the letter.
-- Confirming an envelope is still in the bank updates `last_verified_at`, which
-- does change a line the letter prints — but if that triggered a "reprint your
-- letter" warning, the user would see the warning every single time they did the
-- right thing, and would learn to ignore it. A drift warning that cries wolf is
-- worse than none, because it trains the user through the one warning that
-- actually matters.
create trigger points_mark_plan_modified_ins_del
  after insert or delete on custody.points
  for each row execute function custody.mark_plan_modified();

create trigger points_mark_plan_modified_upd
  after update on custody.points
  for each row
  when (
    old.point_type            is distinct from new.point_type
    or old.holding            is distinct from new.holding
    or old.part_index         is distinct from new.part_index
    or old.display_order      is distinct from new.display_order
    or old.detail             is distinct from new.detail
    or old.detail_iv          is distinct from new.detail_iv
    or old.detail_wrapped_dek is distinct from new.detail_wrapped_dek
    or old.detail_wrapped_dek_iv is distinct from new.detail_wrapped_dek_iv
  )
  execute function custody.mark_plan_modified();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table custody.plans enable row level security;
alter table custody.points enable row level security;
alter table custody.checks enable row level security;

create policy plans_select_own on custody.plans
  for select to authenticated using (vault.owns_vault(vault_id));
create policy plans_insert_own on custody.plans
  for insert to authenticated with check (vault.owns_vault(vault_id));
create policy plans_update_own on custody.plans
  for update to authenticated
  using (vault.owns_vault(vault_id)) with check (vault.owns_vault(vault_id));
create policy plans_delete_own on custody.plans
  for delete to authenticated using (vault.owns_vault(vault_id));

create policy points_select_own on custody.points
  for select to authenticated using (vault.owns_vault(vault_id));
create policy points_insert_own on custody.points
  for insert to authenticated with check (vault.owns_vault(vault_id));
create policy points_update_own on custody.points
  for update to authenticated
  using (vault.owns_vault(vault_id)) with check (vault.owns_vault(vault_id));
create policy points_delete_own on custody.points
  for delete to authenticated using (vault.owns_vault(vault_id));

create policy checks_select_own on custody.checks
  for select to authenticated using (vault.owns_vault(vault_id));
create policy checks_insert_own on custody.checks
  for insert to authenticated with check (vault.owns_vault(vault_id));

grant select, insert, update, delete on custody.plans to authenticated;
grant select, insert, update, delete on custody.points to authenticated;
grant select, insert on custody.checks to authenticated;
