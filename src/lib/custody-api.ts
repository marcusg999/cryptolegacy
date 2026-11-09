'use client';

/**
 * Custody plan persistence.
 *
 * The split that matters: a custody point's label, custodian name, contact and
 * location are encrypted in the browser and stored as one opaque blob (spec
 * §4.1). Its type, whether it holds a full copy or a part, and its verification
 * dates are plaintext, because the dashboard has to be able to warn about a
 * stale arrangement while the vault is locked.
 */

import { z } from 'zod';

import { createClient } from '@/lib/supabase/client';
import { bytesToUtf8, utf8ToBytes } from '@/lib/crypto/encoding';
import { decryptBytes, encryptBytes } from '@/lib/vault-session';
import { bytesToBytea, byteaToBytes, recordAudit } from '@/lib/vault-api';
import { assertNoPassphraseInContent } from '@/lib/custody/passphrase-guard';
import type {
  CustodyHolding,
  CustodyMode,
  CustodyPoint,
  CustodyPointDetail,
  CustodyPointType,
} from '@/lib/custody/types';
import type { CustodyPointRow } from '@/lib/supabase/types';

/** Validated on decrypt, because a blob that fails to parse is a bug we want to see. */
const custodyPointDetail = z.object({
  label: z.string().min(1).max(200),
  custodianName: z.string().max(200).optional(),
  contact: z.string().max(400).optional(),
  locationNotes: z.string().max(2000).optional(),
  notes: z.string().max(4000).optional(),
});

export async function upsertCustodyPlan(params: {
  vaultId: string;
  mode: CustodyMode;
  passphraseWordCount: number;
  partCount: number;
  verificationIntervalMonths: number;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema('custody')
    .from('plans')
    .upsert(
      {
        vault_id: params.vaultId,
        mode: params.mode,
        passphrase_word_count: params.passphraseWordCount,
        part_count: params.partCount,
        verification_interval_months: params.verificationIntervalMonths,
      },
      { onConflict: 'vault_id' },
    );
  if (error) throw new Error(`Could not save the custody plan: ${error.message}`);

  await recordAudit({
    vaultId: params.vaultId,
    action: 'custody.plan.saved',
    metadata: {
      mode: params.mode,
      part_count: params.partCount,
      word_count: params.passphraseWordCount,
    },
  });
}

export async function addCustodyPoint(params: {
  vaultId: string;
  pointType: CustodyPointType;
  holding: CustodyHolding;
  partIndex: number | null;
  detail: CustodyPointDetail;
  displayOrder: number;
}): Promise<string> {
  // Checked before encryption: a passphrase sealed into the vault is protected by
  // nothing, since the vault is what the passphrase opens.
  for (const [field, value] of Object.entries(params.detail)) {
    if (typeof value === 'string' && value.length > 0) {
      assertNoPassphraseInContent(value, `The custody point's ${field}`);
    }
  }

  const supabase = createClient();
  const pointId = crypto.randomUUID();
  const plaintext = utf8ToBytes(JSON.stringify(custodyPointDetail.parse(params.detail)));
  const sealed = await encryptBytes(params.vaultId, pointId, plaintext);

  const { error } = await supabase
    .schema('custody')
    .from('points')
    .insert({
      id: pointId,
      vault_id: params.vaultId,
      point_type: params.pointType,
      holding: params.holding,
      part_index: params.partIndex,
      detail_wrapped_dek_iv: bytesToBytea(sealed.wrappedDek.iv),
      detail_wrapped_dek: bytesToBytea(sealed.wrappedDek.ciphertext),
      detail_iv: bytesToBytea(sealed.payload.iv),
      detail: bytesToBytea(sealed.payload.ciphertext),
      envelope_version: sealed.payload.version,
      display_order: params.displayOrder,
    });
  if (error) throw new Error(`Could not add the custody point: ${error.message}`);

  await recordAudit({
    vaultId: params.vaultId,
    action: 'custody.point.added',
    targetType: 'custody_point',
    targetId: pointId,
    // Identifiers and shape only — never the label or the place. The database
    // refuses a metadata key named `label` or `location` outright.
    metadata: { point_type: params.pointType, holding: params.holding },
  });
  return pointId;
}

export async function deleteCustodyPoint(vaultId: string, pointId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema('custody')
    .from('points')
    .delete()
    .eq('id', pointId)
    .eq('vault_id', vaultId);
  if (error) throw new Error(`Could not remove the custody point: ${error.message}`);
  await recordAudit({
    vaultId,
    action: 'custody.point.removed',
    targetType: 'custody_point',
    targetId: pointId,
  });
}

/** Decrypt every custody point. Requires an unlocked vault. */
export async function decryptCustodyPoints(
  vaultId: string,
  rows: readonly CustodyPointRow[],
): Promise<CustodyPoint[]> {
  const out: CustodyPoint[] = [];
  for (const row of rows) {
    const plaintext = await decryptBytes(vaultId, row.id, {
      wrappedDek: {
        version: row.envelope_version,
        iv: byteaToBytes(row.detail_wrapped_dek_iv),
        ciphertext: byteaToBytes(row.detail_wrapped_dek),
      },
      payload: {
        version: row.envelope_version,
        chunkIndex: 0,
        iv: byteaToBytes(row.detail_iv),
        ciphertext: byteaToBytes(row.detail),
      },
    });

    out.push({
      meta: {
        id: row.id,
        pointType: row.point_type,
        holding: row.holding,
        partIndex: row.part_index,
        lastVerifiedAt: row.last_verified_at,
        displayOrder: row.display_order,
      },
      detail: custodyPointDetail.parse(JSON.parse(bytesToUtf8(plaintext))),
    });
  }
  return out;
}
