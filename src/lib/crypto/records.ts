/**
 * The wire/storage format. These are the only shapes that cross the network.
 *
 * Read the list of fields below as the answer to "what does our database learn?"
 * Salts, IVs, ciphertexts, cost parameters, byte counts and timestamps. No
 * passphrase, no hash of one, no verifier, no strength score (spec §3.1).
 */

import { z } from 'zod';

import { base64ToBytes, bytesToBase64 } from './encoding';
import type { SealedBlob } from './aead';
import type { SealedPayload, WrappedKey } from './envelope';

const base64Field = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'must be base64');

export const sealedBlobRecord = z.object({
  iv: base64Field,
  ciphertext: base64Field,
});
export type SealedBlobRecord = z.infer<typeof sealedBlobRecord>;

export const wrappedKeyRecord = sealedBlobRecord.extend({
  version: z.number().int().positive(),
});
export type WrappedKeyRecord = z.infer<typeof wrappedKeyRecord>;

export const sealedPayloadRecord = wrappedKeyRecord.extend({
  chunk_index: z.number().int().nonnegative(),
});
export type SealedPayloadRecord = z.infer<typeof sealedPayloadRecord>;

export const vaultKeyKind = z.enum(['primary', 'duress']);
export type VaultKeyKind = z.infer<typeof vaultKeyKind>;

/**
 * One unlock record. A vault has exactly one `primary` and at most one `duress`.
 *
 * Both are the same shape on purpose. Anyone reading the database cannot tell a
 * duress record from a primary one by its contents — only by the `kind` column,
 * which is what lets the server raise the silent alert. A future hardening step
 * is to move `kind` behind the master key so even the database cannot tell; that
 * is noted in SECURITY.md as a known limitation rather than quietly skipped.
 */
export const vaultKeyRecord = z.object({
  id: z.string().uuid(),
  kind: vaultKeyKind,
  kdf_profile_id: z.number().int().nonnegative(),
  kdf_salt: base64Field,
  wrapped_vmk: wrappedKeyRecord,
  sentinel: sealedBlobRecord,
});
export type VaultKeyRecord = z.infer<typeof vaultKeyRecord>;

export const sealedItemRecord = z.object({
  wrapped_dek: wrappedKeyRecord,
  payload: sealedPayloadRecord,
  plaintext_bytes: z.number().int().nonnegative(),
});
export type SealedItemRecord = z.infer<typeof sealedItemRecord>;

// --- conversions -----------------------------------------------------------

export function blobToRecord(blob: SealedBlob): SealedBlobRecord {
  return { iv: bytesToBase64(blob.iv), ciphertext: bytesToBase64(blob.ciphertext) };
}

export function recordToBlob(record: SealedBlobRecord): SealedBlob {
  return { iv: base64ToBytes(record.iv), ciphertext: base64ToBytes(record.ciphertext) };
}

export function wrappedKeyToRecord(key: WrappedKey): WrappedKeyRecord {
  return { version: key.version, ...blobToRecord(key) };
}

export function recordToWrappedKey(record: WrappedKeyRecord): WrappedKey {
  return { version: record.version, ...recordToBlob(record) };
}

export function payloadToRecord(payload: SealedPayload): SealedPayloadRecord {
  return {
    version: payload.version,
    chunk_index: payload.chunkIndex,
    ...blobToRecord(payload),
  };
}

export function recordToPayload(record: SealedPayloadRecord): SealedPayload {
  return {
    version: record.version,
    chunkIndex: record.chunk_index,
    ...recordToBlob(record),
  };
}
