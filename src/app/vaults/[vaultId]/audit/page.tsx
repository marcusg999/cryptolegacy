import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { Card, H1, Lead, Page } from '@/components/ui';
import type { AuditLogRow, VaultRow } from '@/lib/supabase/types';

/**
 * The audit log. Spec §5.3: "Immutable audit log of every access, attestation,
 * and configuration change — visible to the user, exportable for probate."
 *
 * Readable while locked, because it contains no content: the database rejects an
 * audit row whose metadata carries a content-shaped key, so what is here is
 * identifiers, counts and outcomes.
 */
export default async function AuditPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/vaults/${vaultId}/audit`);

  const [{ data: vault }, { data: entries }] = await Promise.all([
    supabase.schema('vault').from('vaults').select('*').eq('id', vaultId).maybeSingle(),
    supabase
      .schema('vault')
      .from('audit_log')
      .select('*')
      .eq('vault_id', vaultId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  if (!vault) notFound();
  const vaultRow = vault as VaultRow;
  const rows = (entries ?? []) as AuditLogRow[];

  return (
    <Page>
      <H1>Audit log — {vaultRow.label}</H1>
      <Lead>
        Every access, every configuration change, every custody check. Append-only: nothing here
        can be edited or deleted, by you or by us. An executor can file this with the probate court
        as a record of how the vault was maintained.
      </Lead>

      <div className="mt-8">
        {rows.length === 0 ? (
          <Card>
            <p className="text-sm text-ink/70">No entries yet.</p>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink/15 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-ink/15 bg-ink/5 text-left text-xs uppercase tracking-wide text-ink/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">When (UTC)</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-ink/10 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink/70">
                      {row.created_at.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink">{row.action}</td>
                    <td className="px-4 py-2.5 text-xs text-ink/60">
                      {row.target_type ? `${row.target_type} ${row.target_id ?? ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink/60">
                      {Object.keys(row.metadata ?? {}).length > 0
                        ? Object.entries(row.metadata)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(' ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8">
        <Card>
          <p className="text-xs leading-relaxed text-ink/60">
            This log deliberately records <em>that</em> something happened, never <em>what</em> it
            contained. There are no item contents, no custodian names and no locations here, and the
            database refuses to store them — an audit trail that leaked the thing it was auditing
            would be a worse disclosure than no audit trail at all.
          </p>
        </Card>
      </div>
    </Page>
  );
}
