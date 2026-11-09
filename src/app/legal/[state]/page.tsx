import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { isReviewStale, reviewAgeInDays } from '@/lib/legal/staleness';
import { Card, H1, H2, Lead, Page } from '@/components/ui';
import type { StateRequirementRow } from '@/lib/supabase/types';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU',
] as const;

/**
 * Spec §2.3: a checklist layer sourced from a verified legal database or attorney
 * review, stored as versioned, citation-bearing records, with `last_reviewed_at`
 * and `reviewed_by` surfaced in the UI. "Do not generate this content from model
 * knowledge."
 *
 * The content table ships empty, so for every state this page currently renders
 * the empty state below. That is the correct behaviour and not a stub: a
 * plausible-sounding, unreviewed answer to "what makes a will valid in Nevada"
 * is the most damaging thing this product could say, because the user would act
 * on it and discover the error through their family, after they died.
 *
 * The empty state is written to be genuinely useful anyway — it says what we do
 * not know, why, and where to get the answer.
 */
export default async function StateLegalPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const code = state.toUpperCase();
  if (!US_STATES.includes(code as (typeof US_STATES)[number])) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .schema('legal')
    .from('state_requirements')
    .select('*')
    .eq('state_code', code)
    .eq('status', 'published')
    .maybeSingle();

  const record = (data as StateRequirementRow | null) ?? null;

  // Read the clock once, here, rather than inside JSX, so the value is stable
  // across the tree and the staleness rule itself stays a pure, tested function.
  //
  // react-hooks/purity targets client render, where a clock read makes output
  // non-deterministic between render and hydration. This is an async Server
  // Component: it runs once per request on the server and never hydrates, so a
  // clock read is both correct and unavoidable — the alternative is content that
  // never notices it has gone stale.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const reviewAgeDays = record ? reviewAgeInDays(record.last_reviewed_at, now) : null;
  const stale = record ? isReviewStale(record.last_reviewed_at, now) : false;

  if (!record) {
    return (
      <Page>
        <H1>{code} — estate formalities</H1>
        <Lead>
          We do not have attorney-reviewed content for {code} yet, so this page is empty rather than
          filled in.
        </Lead>

        <div className="mt-8 space-y-6">
          <Card tone="warn">
            <H2>Why we are not guessing</H2>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">
              What makes a will valid varies by state in ways that are easy to state confidently
              and get wrong: how many witnesses, whether they may be beneficiaries, whether a
              handwritten will is recognised at all, whether a self-proving affidavit is accepted,
              whether remote online notarisation is available.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">
              A wrong answer here would not surface as an error message. It would surface in
              probate court, after you died, when nobody could ask you what you meant. So we only
              publish a state checklist once an attorney licensed in that state has reviewed it and
              we can show you their name, the date and the citations.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">
              We would rather show you an empty page than a convincing one.
            </p>
          </Card>

          <Card>
            <H2>What to do instead</H2>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/80">
              <li>
                — Ask an estate attorney licensed in {code}. The engagement for a straightforward
                will is usually a fixed fee and takes one or two meetings.
              </li>
              <li>
                — Most state bar associations run a lawyer-referral service, and many counties have
                a legal-aid clinic that handles simple wills.
              </li>
              <li>
                — Bring the digital-asset questions listed on our RUFADAA page. They are the ones
                most commonly left out of an otherwise competent will.
              </li>
              <li>
                — Everything else in this product works without this page. Your vault is encrypted,
                your custody plan is recorded and your Executor Letter prints regardless.
              </li>
            </ul>
          </Card>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <H1>{code} — estate formalities</H1>
      <Lead>
        A checklist, not advice. Confirm everything here with an attorney licensed in {code} before
        acting on it.
      </Lead>

      <div className="mt-8 space-y-6">
        <Card>
          <H2>Checklist</H2>
          <ul className="mt-3 space-y-3">
            {record.checklist.map((item, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-ink">{item.heading}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink/75">{item.detail}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <H2>At a glance</H2>
          <dl className="mt-3 space-y-2 text-sm">
            <Fact
              label="Handwritten (holographic) will recognised"
              value={record.holographic_will_recognised}
            />
            <Fact
              label="Remote online notarisation available"
              value={record.remote_notarisation_available}
            />
            <Fact
              label="Electronic wills act adopted"
              value={record.electronic_wills_act_adopted}
            />
            <Fact label="Digital-assets act (RUFADAA) adopted" value={record.rufadaa_adopted} />
            {record.rufadaa_citation ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ink/70">Citation</dt>
                <dd className="font-mono text-xs text-ink">{record.rufadaa_citation}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card tone="plain">
          <H2>Provenance</H2>
          <p className="mt-2 text-sm text-ink/80">
            Reviewed by <strong>{record.reviewed_by}</strong>
            {record.reviewer_bar_number ? ` (bar no. ${record.reviewer_bar_number})` : ''}, admitted
            in {record.reviewer_jurisdiction}, on{' '}
            {record.last_reviewed_at?.slice(0, 10) ?? 'an unrecorded date'}. Version{' '}
            {record.version}.
          </p>
          {record.source_citations.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-ink/70">
              {record.source_citations.map((c, i) => (
                <li key={i}>
                  — {c.label}
                  {c.cite ? ` — ${c.cite}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {stale && reviewAgeDays !== null ? (
            <p className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-xs text-ink">
              This review is {reviewAgeDays} days old. Statutes change; treat it as a starting
              point for a conversation with your attorney rather than a current statement of the law.
            </p>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}

function Fact({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-ink/70">{label}</dt>
      <dd className="font-medium text-ink">
        {value === null ? 'Not recorded' : value ? 'Yes' : 'No'}
      </dd>
    </div>
  );
}
