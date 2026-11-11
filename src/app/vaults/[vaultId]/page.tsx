import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { UnlockGate } from '@/components/UnlockGate';
import { VaultItems } from '@/components/VaultItems';
import { Card, H1, Lead, Page } from '@/components/ui';
import type { AccountSecurityRow, VaultRow } from '@/lib/supabase/types';

export default async function VaultPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/vaults/${vaultId}`);

  const [{ data: vault }, { data: security }, { count: itemCount }] = await Promise.all([
    supabase.schema('vault').from('vaults').select('*').eq('id', vaultId).maybeSingle(),
    supabase
      .schema('account')
      .from('account_security')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .schema('vault')
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('vault_id', vaultId)
      .is('deleted_at', null),
  ]);

  if (!vault) notFound();
  const vaultRow = vault as VaultRow;
  const lockTimeout = (security as AccountSecurityRow | null)?.vault_lock_timeout_seconds ?? 300;

  return (
    <Page>
      <div className="no-print flex flex-wrap items-start justify-between gap-4">
        <div>
          <H1>{vaultRow.label}</H1>
          <Lead>
            {itemCount ?? 0} {itemCount === 1 ? 'item' : 'items'}. Names and dates are visible
            while locked; contents are not.
          </Lead>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/vaults/${vaultId}/custody`}
            className="border border-[#2A3B4F] bg-[#070D16] px-3 py-2 font-medium text-ink hover:bg-glow/5"
          >
            Custody plan
          </Link>
          <Link
            href={`/vaults/${vaultId}/letter`}
            className="border border-[#2A3B4F] bg-[#070D16] px-3 py-2 font-medium text-ink hover:bg-glow/5"
          >
            Executor Letter
          </Link>
          <Link
            href={`/vaults/${vaultId}/audit`}
            className="border border-[#2A3B4F] bg-[#070D16] px-3 py-2 font-medium text-ink hover:bg-glow/5"
          >
            Audit log
          </Link>
        </nav>
      </div>

      <div className="mt-8">
        <UnlockGate
          vaultId={vaultId}
          vaultLabel={vaultRow.label}
          lockTimeoutSeconds={lockTimeout}
        >
          <VaultItems vaultId={vaultId} />
        </UnlockGate>
      </div>

      <div className="no-print mt-10">
        <Card>
          <p className="text-xs leading-relaxed text-ink/60">
            <strong>Item names are not encrypted.</strong> They are how you find things while the
            vault is locked, and how an executor sees that something exists before they have the
            passphrase. Put the description in the name and the secret in the contents — &ldquo;Hardware
            wallet recovery&rdquo;, not the seed words themselves. If you paste a passphrase or seed
            phrase into an item, we will refuse to save it and tell you why.
          </p>
        </Card>
      </div>
    </Page>
  );
}
