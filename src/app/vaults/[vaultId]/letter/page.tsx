import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { ExecutorLetterView } from '@/components/ExecutorLetterView';
import { UnlockGate } from '@/components/UnlockGate';
import { H1, Lead, Page } from '@/components/ui';
import type {
  AccountSecurityRow,
  CustodyPlanRow,
  CustodyPointRow,
  VaultRow,
} from '@/lib/supabase/types';

export default async function LetterPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/vaults/${vaultId}/letter`);

  const [{ data: vault }, { data: plan }, { data: points }, { data: security }] = await Promise.all(
    [
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
    ],
  );

  if (!vault) notFound();
  const vaultRow = vault as VaultRow;
  const planRow = (plan as CustodyPlanRow | null) ?? null;
  const lockTimeout = (security as AccountSecurityRow | null)?.vault_lock_timeout_seconds ?? 300;

  if (!planRow) {
    return (
      <Page>
        <H1>Executor Letter</H1>
        <Lead>
          There is no custody plan for this vault yet, so there is nothing to direct an executor
          to. Set up the custody plan first.
        </Lead>
      </Page>
    );
  }

  return (
    <Page>
      <div className="no-print">
        <H1>Executor Letter</H1>
        <Lead>
          Generated here, in your browser, from your decrypted custody plan. We do not keep a copy
          — only the date you last generated one, so we can tell you when it has gone stale.
        </Lead>
      </div>

      <div className="mt-8">
        <UnlockGate
          vaultId={vaultId}
          vaultLabel={vaultRow.label}
          lockTimeoutSeconds={lockTimeout}
        >
          <ExecutorLetterView
            vaultId={vaultId}
            vaultLabel={vaultRow.label}
            ownerEmail={user.email ?? ''}
            plan={planRow}
            pointRows={(points ?? []) as CustodyPointRow[]}
          />
        </UnlockGate>
      </div>
    </Page>
  );
}
