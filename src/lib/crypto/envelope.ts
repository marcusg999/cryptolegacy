/**
 * Envelope encryption. Spec §5.1.
 *
 *   item payload  --AES-256-GCM-->  per-item DEK
 *   DEK           --AES-256-GCM-->  Vault Master Key (VMK)
 *   VMK           --AES-256-GCM-->  Argon2id(passphrase, salt)  = KEK
 *
 * The VMK exists only as a non-extractable `CryptoKey` in browser memory for the
 * duration of an unlocked session. Nothing in this module writes to storage, makes
 * a network request, or logs.
 */

import {
  AeadError,
  exportRawKey,
  generateExtractableAesKey,
  importAesKey,
  open,
  seal,
  type SealedBlob,
} from './aead';
import { AAD, ENVELOPE_VERSION, SENTINEL_PLAINTEXT } from './constants';
import { bytesToUtf8, timingSafeEqual, utf8ToBytes, zeroize } from './encoding';

/** A wrapped key as it is stored: version + IV + ciphertext. */
export interface WrappedKey extends SealedBlob {
  readonly version: number;
}

/** A sealed item payload as it is stored. */
export interface SealedPayload extends SealedBlob {
  readonly version: number;
  readonly chunkIndex: number;
}

// ---------------------------------------------------------------------------
// Vault Master Key
// ---------------------------------------------------------------------------

export interface GeneratedVaultMasterKey {
  readonly key: CryptoKey;
  readonly wrapped: WrappedKey;
  readonly sentinel: SealedBlob;
}

/**
 * Create a new VMK and wrap it under the passphrase-derived KEK, plus the sentinel
 * blob used to verify a passphrase without revealing anything about it.
 *
 * The returned `key` is re-imported non-extractably: the extractable handle used
 * for wrapping is dropped and its raw bytes zeroized, so the only VMK that
 * survives the call cannot be read back out by JavaScript.
 */
export async function createVaultMasterKey(
  kek: CryptoKey,
  vaultId: string,
  keyRecordId: string,
): Promise<GeneratedVaultMasterKey> {
  const extractable = await generateExtractableAesKey();
  let raw: Uint8Array | null = null;
  try {
    raw = await exportRawKey(extractable);
    const wrappedBlob = await seal(kek, raw, AAD.vaultMasterKey(vaultId, keyRecordId));
    const nonExtractable = await importAesKey(raw);
    const sentinel = await seal(
      kek,
      utf8ToBytes(SENTINEL_PLAINTEXT),
      AAD.sentinel(vaultId, keyRecordId),
    );
    return {
      key: nonExtractable,
      wrapped: { version: ENVELOPE_VERSION, ...wrappedBlob },
      sentinel,
    };
  } finally {
    zeroize(raw);
  }
}

/**
 * Wrap an existing VMK under a second KEK.
 *
 * This is how a duress passphrase gets its own key record, and how a passphrase
 * change would work if one were ever possible — it is not (spec §3.1, there is no
 * password reset), so in V1 the only caller is duress enrolment, which wraps a
 * *different*, decoy VMK.
 */
export async function wrapVaultMasterKeyBytes(
  kek: CryptoKey,
  vmkRaw: Uint8Array,
  vaultId: string,
  keyRecordId: string,
): Promise<{ wrapped: WrappedKey; sentinel: SealedBlob }> {
  const wrappedBlob = await seal(kek, vmkRaw, AAD.vaultMasterKey(vaultId, keyRecordId));
  const sentinel = await seal(
    kek,
    utf8ToBytes(SENTINEL_PLAINTEXT),
    AAD.sentinel(vaultId, keyRecordId),
  );
  return { wrapped: { version: ENVELOPE_VERSION, ...wrappedBlob }, sentinel };
}

/**
 * Verify a KEK against a stored sentinel.
 *
 * Returns a boolean rather than throwing, because "this passphrase is not the one"
 * is an expected outcome the UI has to render. Note what the *server* can learn
 * from this: only that an unlock attempt succeeded or failed, which is what it
 * needs in order to rate-limit, and nothing more.
 */
export async function verifySentinel(
  kek: CryptoKey,
  sentinel: SealedBlob,
  vaultId: string,
  keyRecordId: string,
): Promise<boolean> {
  try {
    const plaintext = await open(kek, sentinel, AAD.sentinel(vaultId, keyRecordId));
    return timingSafeEqual(plaintext, utf8ToBytes(SENTINEL_PLAINTEXT));
  } catch (error) {
    if (error instanceof AeadError) return false;
    throw error;
  }
}

/** Unwrap the VMK. Throws `AeadError` if the KEK is wrong or the blob is damaged. */
export async function unwrapVaultMasterKey(
  kek: CryptoKey,
  wrapped: WrappedKey,
  vaultId: string,
  keyRecordId: string,
): Promise<CryptoKey> {
  assertVersion(wrapped.version);
  let raw: Uint8Array | null = null;
  try {
    raw = await open(kek, wrapped, AAD.vaultMasterKey(vaultId, keyRecordId));
    return await importAesKey(raw);
  } finally {
    zeroize(raw);
  }
}

// ---------------------------------------------------------------------------
// Per-item Data Encryption Keys
// ---------------------------------------------------------------------------

export interface SealedItem {
  readonly wrappedDek: WrappedKey;
  readonly payload: SealedPayload;
  /** Plaintext byte length, kept as metadata so the vault list is usable when locked. */
  readonly plaintextBytes: number;
}

/**
 * Encrypt one item under a fresh random DEK, and wrap that DEK under the VMK.
 *
 * A fresh DEK per item is not ceremony: it bounds the damage from any single
 * IV-reuse bug or key compromise to one item, and it is what makes per-item
 * sharing or selective disclosure possible later without re-encrypting the vault.
 */
export async function sealItem(
  vmk: CryptoKey,
  plaintext: Uint8Array,
  vaultId: string,
  itemId: string,
  chunkIndex = 0,
): Promise<SealedItem> {
  const dekExtractable = await generateExtractableAesKey();
  let dekRaw: Uint8Array | null = null;
  try {
    dekRaw = await exportRawKey(dekExtractable);
    const wrappedDekBlob = await seal(vmk, dekRaw, AAD.dataEncryptionKey(vaultId, itemId));
    const dek = await importAesKey(dekRaw);
    const payloadBlob = await seal(
      dek,
      plaintext,
      AAD.itemPayload(vaultId, itemId, chunkIndex),
    );
    return {
      wrappedDek: { version: ENVELOPE_VERSION, ...wrappedDekBlob },
      payload: { version: ENVELOPE_VERSION, chunkIndex, ...payloadBlob },
      plaintextBytes: plaintext.length,
    };
  } finally {
    zeroize(dekRaw);
  }
}

/** Decrypt one item. Throws `AeadError` on any tampering or wrong key. */
export async function openItem(
  vmk: CryptoKey,
  item: { wrappedDek: WrappedKey; payload: SealedPayload },
  vaultId: string,
  itemId: string,
): Promise<Uint8Array> {
  assertVersion(item.wrappedDek.version);
  assertVersion(item.payload.version);
  let dekRaw: Uint8Array | null = null;
  try {
    dekRaw = await open(vmk, item.wrappedDek, AAD.dataEncryptionKey(vaultId, itemId));
    const dek = await importAesKey(dekRaw);
    return await open(
      dek,
      item.payload,
      AAD.itemPayload(vaultId, itemId, item.payload.chunkIndex),
    );
  } finally {
    zeroize(dekRaw);
  }
}

/** Convenience wrappers for text items (notes, instructions, custody plans). */
export async function sealText(
  vmk: CryptoKey,
  text: string,
  vaultId: string,
  itemId: string,
): Promise<SealedItem> {
  const bytes = utf8ToBytes(text);
  try {
    return await sealItem(vmk, bytes, vaultId, itemId);
  } finally {
    zeroize(bytes);
  }
}

export async function openText(
  vmk: CryptoKey,
  item: { wrappedDek: WrappedKey; payload: SealedPayload },
  vaultId: string,
  itemId: string,
): Promise<string> {
  const bytes = await openItem(vmk, item, vaultId, itemId);
  try {
    return bytesToUtf8(bytes);
  } finally {
    zeroize(bytes);
  }
}

function assertVersion(version: number): void {
  if (version !== ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported envelope version ${version}; this build understands ${ENVELOPE_VERSION}.`,
    );
  }
}
