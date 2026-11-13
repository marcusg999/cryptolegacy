import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { assessCustodyHealth } from '@/lib/custody/health';
import { Card, H1, H2, Lead, Page, StatusPill } from '@/components/ui';
import type { CustodyPlanRow, CustodyPointRow, VaultRow } from '@/lib/supabase/types';

/**
 * The dashboard. Spec §4.3: at-risk custody points are flagged "prominently".
 *
 * This renders on the server, from plaintext metadata only, with no passphrase
 * involved. That is the whole reason the custody schema keeps the *shape* of the
 * arrangement readable while keeping identities and locations encrypted: the
 * user has to be able to see that something has gone stale without unlocking,
 * because the people most at risk are the ones who set this up years ago and
 * have not opened it since.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/dashboard');

  const [{ data: vaults }, { data: plans }, { data: points }] = await Promise.all([
    supabase.schema('vault').from('vaults').select('*').order('created_at'),
    supabase.schema('custody').from('plans').select('*'),
    supabase.schema('custody').from('points').select('*'),
  ]);

  const vaultRows = (vaults ?? []) as VaultRow[];
  const planRows = (plans ?? []) as CustodyPlanRow[];
  const pointRows = (points ?? []) as CustodyPointRow[];

  if (vaultRows.length === 0) {
    return (
      <Page>
        <H1>Your vaults</H1>
        <Lead>
          Nothing set up yet. Creating a vault takes a few minutes and needs paper and a pen —
          your passphrase is generated in your browser and written down by hand, because we never
          receive it and cannot reset it.
        </Lead>
        <div className="mt-8">
          <Link
            href="/vaults/new"
            className="inline-flex items-center justify-center bg-glow px-5 py-2.5 text-sm font-medium text-abyss hover:bg-[#5CFADF]"
          >
            Create your first vault
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <H1>Your vaults</H1>
          <Lead>
            What you see here is metadata: names, dates, how many custody points. Contents stay
            encrypted until you unlock a vault with your passphrase.
          </Lead>
        </div>
        <Link
          href="/vaults/new"
          className="inline-flex items-center justify-center border border-[#2A3B4F] bg-[#070D16] px-4 py-2 text-sm font-medium text-ink hover:bg-glow/5"
        >
          New vault
        </Link>
      </div>

      <div className="mt-8 space-y-6">
        {vaultRows.map((vault) => {
          const plan = planRows.find((p) => p.vault_id === vault.id) ?? null;
          const vaultPoints = pointRows.filter((p) => p.vault_id === vault.id);

          const health = plan
            ? assessCustodyHealth(
                {
                  verificationIntervalMonths: plan.verification_interval_months,
                  planLastModifiedAt: plan.plan_last_modified_at,
                  letterLastGeneratedAt: plan.letter_last_generated_at,
                },
                vaultPoints.map((p) => ({
                  id: p.id,
                  pointType: p.point_type,
                  holding: p.holding,
                  partIndex: p.part_index,
                  lastVerifiedAt: p.last_verified_at,
                  displayOrder: p.display_order,
                })),
              )
            : null;

          return (
            <Card
              key={vault.id}
              tone={!plan || health?.needsAttention ? 'warn' : 'ok'}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <H2>{vault.label}</H2>
                  {vault.purpose ? (
                    <p className="mt-1 text-sm text-ink/60">{vault.purpose}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-ink/50">
                    Created {new Date(vault.created_at).toISOString().slice(0, 10)} · release
                    waiting period {vault.waiting_period_days} days
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/vaults/${vault.id}`}
                    className="inline-flex items-center justify-center bg-glow px-4 py-2 text-sm font-medium text-abyss hover:bg-[#5CFADF]"
                  >
                    Open
                  </Link>
                  <Link
                    href={`/vaults/${vault.id}/custody`}
                    className="inline-flex items-center justify-center border border-[#2A3B4F] bg-[#070D16] px-4 py-2 text-sm font-medium text-ink hover:bg-glow/5"
                  >
                    Custody plan
                  </Link>
                </div>
              </div>

              {!plan ? (
                <div className="mt-4 rounded border border-danger/40 bg-danger/5 p-4 text-sm">
                  <p className="font-semibold text-danger">No custody plan yet.</p>
                  <p className="mt-1 text-ink/80">
                    This vault is encrypted but nobody is recorded as holding the passphrase, and no
                    Executor Letter exists. As things stand, your executor would find an encrypted
                    vault and no way into it. This is the single most important thing left to do.
                  </p>
                </div>
              ) : (
                <CustodySummary
                  vaultId={vault.id}
                  plan={plan}
                  health={health!}
                  pointCount={vaultPoints.length}
                />
              )}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}

function CustodySummary({
  vaultId,
  plan,
  health,
  pointCount,
}: {
  vaultId: string;
  plan: CustodyPlanRow;
  health: ReturnType<typeof assessCustodyHealth>;
  pointCount: number;
}) {
  const mode =
    plan.mode === 'split'
      ? `split into ${plan.part_count} parts, all required`
      : plan.mode === 'hybrid'
        ? 'full copies with different failure modes'
        : 'full copies, any one opens the vault';

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink/70">
          {pointCount} custody {pointCount === 1 ? 'point' : 'points'} · {mode}
        </span>
        {health.atRiskCount > 0 ? (
          <StatusPill tone="risk">
            {health.atRiskCount} at risk — over 18 months unverified
          </StatusPill>
        ) : null}
        {health.neverVerifiedCount > 0 ? (
          <StatusPill tone="never">{health.neverVerifiedCount} never verified</StatusPill>
        ) : null}
        {health.dueCount > 0 ? <StatusPill tone="due">{health.dueCount} due</StatusPill> : null}
        {!health.needsAttention ? (
          <StatusPill tone="ok">Verified and intact</StatusPill>
        ) : null}
      </div>

      {health.letterNeverGenerated ? (
        <p className="rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink">
          <strong>No Executor Letter has been generated.</strong> Your custody plan exists only
          inside the encrypted vault, which your executor cannot read. Generate the letter and
          store the printed copy with your will.{' '}
          <Link className="underline" href={`/vaults/${vaultId}/letter`}>
            Generate it
          </Link>
          .
        </p>
      ) : health.letterOutOfDate ? (
        <p className="rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink">
          <strong>Your Executor Letter is out of date.</strong> The custody plan changed on{' '}
          {new Date(plan.plan_last_modified_at).toISOString().slice(0, 10)}, after the letter was
          generated. A letter that describes an arrangement which no longer exists is worse than
          none — it sends your executor to the wrong place.{' '}
          <Link className="underline" href={`/vaults/${vaultId}/letter`}>
            Regenerate and reprint it
          </Link>
          .
        </p>
      ) : null}

      {health.atRiskCount > 0 ? (
        <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
          <strong>
            {health.atRiskCount} custody {health.atRiskCount === 1 ? 'point has' : 'points have'}{' '}
            not been verified in over 18 months.
          </strong>{' '}
          Banks close branches, people move house, relationships change. Confirm each one is still
          reachable.{' '}
          <Link className="underline" href={`/vaults/${vaultId}/custody`}>
            Run a custody check
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
