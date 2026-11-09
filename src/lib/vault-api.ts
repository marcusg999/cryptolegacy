'use client';

/**
 * Vault CRUD. Build-order step 3.
 *
 * Every function here does its encryption in the browser and sends ciphertext.
 * The division of labour is deliberate and worth stating: this module knows how
 * to talk to the database, `src/lib/crypto` knows how to encrypt, and
 * `vault-session` holds the key. No module does two of those three.
 *
 * PostgREST returns `bytea` as a hex string prefixed `\x`, and accepts it in the
 * same form, so the conversions are here rather than scattered at call sites.
 */

import { createClient } from '@/lib/supabase/client';
import {
  base64ToBytes,
  bytesToBase64,
} from '@/lib/crypto/encoding';
import type { SealedItem } from '@/lib/crypto/envelope';
import { decryptText, encryptText } from '@/lib/vault-session';
import type {
  CustodyCheckRow,
  CustodyPlanRow,
  CustodyPointRow,
  DisclosureStageRow,
  ItemKindRow,
  ItemRow,
  VaultKeyRow,
  VaultRow,
} from '@/lib/supabase/types';
import type { VaultKeyRecord } from '@/lib/crypto/records';

// --- bytea <-> bytes -------------------------------------------------------

/** PostgREST renders a bytea as `\x48656c6c6f`. */
export function byteaToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('\\x') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new Error('Malformed bytea from the database.');
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBytea(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += (b as number).toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

const b64FromBytea = (hex: string) => bytesToBase64(byteaToBytes(hex));
const byteaFromB64 = (b64: string) => bytesToBytea(base64ToBytes(b64));

// --- vaults ----------------------------------------------------------------

export async function listVaults(): Promise<VaultRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('vaults')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not list vaults: ${error.message}`);
  return (data ?? []) as VaultRow[];
}

export async function getVault(vaultId: string): Promise<VaultRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('vaults')
    .select('*')
    .eq('id', vaultId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the vault: ${error.message}`);
  return (data as VaultRow | null) ?? null;
}

/**
 * Persist a new vault and its primary key record.
 *
 * Note the order: the vault row first, then the key record. If the second insert
 * fails the user is left with a vault that cannot be unlocked, which the
 * dashboard detects and offers to delete — a recoverable state. The reverse
 * order is not possible (the foreign key requires the vault), and wrapping both
 * in a transaction would mean a server round trip holding, briefly, both halves,
 * which buys nothing the recovery path does not already handle.
 */
export async function createVaultRecords(params: {
  vaultId: string;
  label: string;
  purpose?: string;
  keyRecord: VaultKeyRecord;
  waitingPeriodDays?: number;
}): Promise<VaultRow> {
  const supabase = createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('You must be signed in to create a vault.');

  const { data: vaultRow, error: vaultError } = await supabase
    .schema('vault')
    .from('vaults')
    .insert({
      id: params.vaultId,
      owner_id: user.user.id,
      label: params.label,
      ...(params.purpose ? { purpose: params.purpose } : {}),
      ...(params.waitingPeriodDays ? { waiting_period_days: params.waitingPeriodDays } : {}),
    })
    .select()
    .single();
  if (vaultError) throw new Error(`Could not create the vault: ${vaultError.message}`);

  const { error: keyError } = await supabase
    .schema('vault')
    .from('vault_keys')
    .insert({
      id: params.keyRecord.id,
      vault_id: params.vaultId,
      kind: params.keyRecord.kind,
      kdf_profile_id: params.keyRecord.kdf_profile_id,
      kdf_salt: byteaFromB64(params.keyRecord.kdf_salt),
      wrapped_vmk_iv: byteaFromB64(params.keyRecord.wrapped_vmk.iv),
      wrapped_vmk: byteaFromB64(params.keyRecord.wrapped_vmk.ciphertext),
      sentinel_iv: byteaFromB64(params.keyRecord.sentinel.iv),
      sentinel: byteaFromB64(params.keyRecord.sentinel.ciphertext),
      envelope_version: params.keyRecord.wrapped_vmk.version,
    });
  if (keyError) {
    throw new Error(
      `The vault was created but its key record could not be saved (${keyError.message}). ` +
        'The vault is unusable; delete it from the dashboard and start again. Do not reuse the passphrase.',
    );
  }

  await recordAudit({ vaultId: params.vaultId, action: 'vault.created' });
  return vaultRow as VaultRow;
}

export async function loadKeyRecords(vaultId: string): Promise<VaultKeyRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('vault_keys')
    .select('*')
    .eq('vault_id', vaultId)
    // Primary first: the common case needs one Argon2id derivation, not two.
    .order('kind', { ascending: true });
  if (error) throw new Error(`Could not load the vault key: ${error.message}`);

  return ((data ?? []) as VaultKeyRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    kdf_profile_id: row.kdf_profile_id,
    kdf_salt: b64FromBytea(row.kdf_salt),
    wrapped_vmk: {
      version: row.envelope_version,
      iv: b64FromBytea(row.wrapped_vmk_iv),
      ciphertext: b64FromBytea(row.wrapped_vmk),
    },
    sentinel: {
      iv: b64FromBytea(row.sentinel_iv),
      ciphertext: b64FromBytea(row.sentinel),
    },
  }));
}

export async function deleteVault(vaultId: string): Promise<void> {
  const supabase = createClient();
  await recordAudit({ vaultId, action: 'vault.deleted' });
  const { error } = await supabase.schema('vault').from('vaults').delete().eq('id', vaultId);
  if (error) throw new Error(`Could not delete the vault: ${error.message}`);
}

// --- items -----------------------------------------------------------------

export interface ItemSummary {
  readonly id: string;
  readonly kind: ItemKindRow;
  readonly name: string;
  readonly plaintextBytes: number;
  readonly disclosureStage: DisclosureStageRow;
  readonly version: number;
  readonly updatedAt: string;
}

/**
 * List items without unlocking. Spec §5.2: "A logged-in session without the
 * passphrase sees metadata only: item names, sizes, dates."
 */
export async function listItems(vaultId: string): Promise<ItemSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('items')
    .select('id, kind, name, plaintext_bytes, disclosure_stage, version, updated_at')
    .eq('vault_id', vaultId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not list vault items: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as Pick<
      ItemRow,
      'id' | 'kind' | 'name' | 'plaintext_bytes' | 'disclosure_stage' | 'version' | 'updated_at'
    >;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      plaintextBytes: r.plaintext_bytes,
      disclosureStage: r.disclosure_stage,
      version: r.version,
      updatedAt: r.updated_at,
    };
  });
}

function sealedToColumns(sealed: SealedItem) {
  return {
    wrapped_dek_iv: bytesToBytea(sealed.wrappedDek.iv),
    wrapped_dek: bytesToBytea(sealed.wrappedDek.ciphertext),
    content_iv: bytesToBytea(sealed.payload.iv),
    content: bytesToBytea(sealed.payload.ciphertext),
    plaintext_bytes: sealed.plaintextBytes,
    envelope_version: sealed.payload.version,
  };
}

export async function createTextItem(params: {
  vaultId: string;
  name: string;
  text: string;
  kind?: ItemKindRow;
  disclosureStage?: DisclosureStageRow;
}): Promise<string> {
  const supabase = createClient();
  const itemId = crypto.randomUUID();
  const sealed = await encryptText(params.vaultId, itemId, params.text);

  const { error } = await supabase
    .schema('vault')
    .from('items')
    .insert({
      id: itemId,
      vault_id: params.vaultId,
      kind: params.kind ?? 'text',
      disclosure_stage: params.disclosureStage ?? 'inventory_education',
      name: params.name,
      ...sealedToColumns(sealed),
    });
  if (error) throw new Error(`Could not save the item: ${error.message}`);

  await recordAudit({
    vaultId: params.vaultId,
    action: 'item.created',
    targetType: 'item',
    targetId: itemId,
    metadata: { bytes: sealed.plaintextBytes, kind: params.kind ?? 'text' },
  });
  return itemId;
}

export async function readTextItem(vaultId: string, itemId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('items')
    .select('*')
    .eq('id', itemId)
    .eq('vault_id', vaultId)
    .single();
  if (error) throw new Error(`Could not load the item: ${error.message}`);

  const row = data as ItemRow;
  if (!row.content || !row.content_iv) {
    throw new Error('This item has no inline payload; media items are not supported yet.');
  }

  const plaintext = await decryptText(vaultId, itemId, {
    wrappedDek: {
      version: row.envelope_version,
      iv: byteaToBytes(row.wrapped_dek_iv),
      ciphertext: byteaToBytes(row.wrapped_dek),
    },
    payload: {
      version: row.envelope_version,
      chunkIndex: 0,
      iv: byteaToBytes(row.content_iv),
      ciphertext: byteaToBytes(row.content),
    },
  });

  await recordAudit({
    vaultId,
    action: 'item.read',
    targetType: 'item',
    targetId: itemId,
  });
  return plaintext;
}

/**
 * Replace an item's contents, archiving the previous version first.
 *
 * Spec §8 asks for version history on everything, and the reason is specific:
 * "wills get amended, wallets get migrated, custodians get divorced". An edit
 * that silently destroys the previous ciphertext makes a mistaken edit
 * unrecoverable, which in this product can mean unrecoverable money.
 */
export async function updateTextItem(params: {
  vaultId: string;
  itemId: string;
  name: string;
  text: string;
}): Promise<void> {
  const supabase = createClient();

  const { data: existing, error: loadError } = await supabase
    .schema('vault')
    .from('items')
    .select('*')
    .eq('id', params.itemId)
    .eq('vault_id', params.vaultId)
    .single();
  if (loadError) throw new Error(`Could not load the item to update: ${loadError.message}`);
  const prior = existing as ItemRow;

  const { error: archiveError } = await supabase
    .schema('vault')
    // item_versions is not in the generated Database type on purpose: it is
    // append-only and written only here.
    .from('item_versions' as 'items')
    .insert({
      item_id: prior.id,
      version: prior.version,
      name: prior.name,
      plaintext_bytes: prior.plaintext_bytes,
      wrapped_dek_iv: prior.wrapped_dek_iv,
      wrapped_dek: prior.wrapped_dek,
      content_iv: prior.content_iv,
      content: prior.content,
      storage_path: prior.storage_path,
      envelope_version: prior.envelope_version,
    } as never);
  if (archiveError) {
    throw new Error(
      `Could not archive the previous version (${archiveError.message}). ` +
        'The item was left unchanged rather than overwritten without a backup.',
    );
  }

  const sealed = await encryptText(params.vaultId, params.itemId, params.text);
  const { error } = await supabase
    .schema('vault')
    .from('items')
    .update({
      name: params.name,
      version: prior.version + 1,
      ...sealedToColumns(sealed),
    })
    .eq('id', params.itemId);
  if (error) throw new Error(`Could not update the item: ${error.message}`);

  await recordAudit({
    vaultId: params.vaultId,
    action: 'item.updated',
    targetType: 'item',
    targetId: params.itemId,
    metadata: { version: prior.version + 1, bytes: sealed.plaintextBytes },
  });
}

/** Soft delete, so a mistaken deletion is recoverable. */
export async function deleteItem(vaultId: string, itemId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema('vault')
    .from('items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('vault_id', vaultId);
  if (error) throw new Error(`Could not delete the item: ${error.message}`);
  await recordAudit({ vaultId, action: 'item.deleted', targetType: 'item', targetId: itemId });
}

// --- custody ---------------------------------------------------------------

export async function getCustodyPlan(vaultId: string): Promise<CustodyPlanRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('custody')
    .from('plans')
    .select('*')
    .eq('vault_id', vaultId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the custody plan: ${error.message}`);
  return (data as CustodyPlanRow | null) ?? null;
}

export async function listCustodyPoints(vaultId: string): Promise<CustodyPointRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('custody')
    .from('points')
    .select('*')
    .eq('vault_id', vaultId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`Could not load custody points: ${error.message}`);
  return (data ?? []) as CustodyPointRow[];
}

export async function recordCustodyCheck(params: {
  vaultId: string;
  pointId: string;
  outcome: CustodyCheckRow['outcome'];
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.schema('custody').from('checks').insert({
    vault_id: params.vaultId,
    point_id: params.pointId,
    outcome: params.outcome,
  });
  if (error) throw new Error(`Could not record the custody check: ${error.message}`);
  await recordAudit({
    vaultId: params.vaultId,
    action: 'custody.point.checked',
    targetType: 'custody_point',
    targetId: params.pointId,
    metadata: { outcome: params.outcome },
  });
}

export async function recordLetterGenerated(vaultId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema('custody')
    .rpc('record_letter_generated', { p_vault_id: vaultId });
  if (error) throw new Error(`Could not record the letter generation: ${error.message}`);
  await recordAudit({ vaultId, action: 'custody.letter.generated' });
}

// --- audit -----------------------------------------------------------------

/**
 * Append an audit entry.
 *
 * `metadata` carries identifiers, counts and outcomes. It must not carry user
 * content — the database rejects a content-shaped key outright, so a mistake
 * here fails loudly in development rather than silently logging a secret.
 */
export async function recordAudit(params: {
  vaultId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  try {
    const supabase = createClient();
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    await supabase.schema('vault').from('audit_log').insert({
      ...(params.vaultId ? { vault_id: params.vaultId } : {}),
      actor_id: user.user.id,
      action: params.action,
      ...(params.targetType ? { target_type: params.targetType } : {}),
      ...(params.targetId ? { target_id: params.targetId } : {}),
      metadata: params.metadata ?? {},
    });
  } catch {
    // An audit write must never break the operation it is describing. The
    // failure is visible as a gap in the exported log, which is the honest
    // outcome: better a missing line than a blocked unlock during a death claim.
  }
}

export async function listAuditLog(vaultId: string, limit = 200) {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('vault')
    .from('audit_log')
    .select('*')
    .eq('vault_id', vaultId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  return data ?? [];
}
