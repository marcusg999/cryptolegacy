import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { CustodyPlanner } from '@/components/CustodyPlanner';
import { UnlockGate } from '@/components/UnlockGate';
import { Card, H1, Lead, Page } from '@/components/ui';
import type {
  AccountSecurityRow,
  CustodyPlanRow,
  CustodyPointRow,
  VaultKeyRow,
  VaultRow,
} from '@/lib/supabase/types';

export default async function CustodyPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/vaults/${vaultId}/custody`);

  const [{ data: vault }, { data: plan }, { data: points }, { data: security }, { data: keys }] =
    await Promise.all([
      supabase.schema('vault').from('vaults').select('*').eq('id', vaultId).maybeSingle(),
      supabase.schema('custody').from('plans').select('*').eq('vault_id', vaultId).maybeSingle(),
      supabase
        .schema('custody')
        .from('points')
        .select('*')
        .eq('vault_id', vaultId)
        .order('display_order'),
      supabase
        .schema('account')
        .from('account_security')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase.schema('vault').from('vault_keys').select('*').eq('vault_id', vaultId),
    ]);

  if (!vault) notFound();
  const vaultRow = vault as VaultRow;
  const lockTimeout = (security as AccountSecurityRow | null)?.vault_lock_timeout_seconds ?? 300;

  // The word count is only knowable from the plan once one exists. For a brand
  // new vault there is no plan yet, so the planner asks.
  const planRow = (plan as CustodyPlanRow | null) ?? null;
  const keyRows = (keys ?? []) as VaultKeyRow[];

  return (
    <Page>
      <H1>Custody plan — {vaultRow.label}</H1>
      <Lead>
        This decides where your passphrase lives and who holds it. We never learn any of it: the
        labels, custodian names and locations below are encrypted in your browser before they are
        stored, which is why this page needs the vault unlocked.
      </Lead>

      <div className="mt-6">
        <Card>
          <p className="text-sm leading-relaxed text-ink/75">
            <strong>Why this is the most important page in the product.</strong> We hold the
            encrypted vault; you hold the passphrase, somewhere physical. Neither opens anything
            alone. Your executor needs both, and the only thing that will tell them where to look
            is the Executor Letter you print from this plan and keep with your will.
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <UnlockGate
          vaultId={vaultId}
          vaultLabel={vaultRow.label}
          lockTimeoutSeconds={lockTimeout}
        >
          <CustodyPlanner
            vaultId={vaultId}
            vaultLabel={vaultRow.label}
            existingPlan={planRow}
            existingPoints={(points ?? []) as CustodyPointRow[]}
            keyRecordCount={keyRows.length}
          />
        </UnlockGate>
      </div>
    </Page>
  );
}
