/**
 * AES-256-GCM, the only confidentiality primitive in the product.
 *
 * Every call takes explicit additional authenticated data (AAD). That is not
 * optional: the AAD is what binds a ciphertext to its slot, so a database with
 * write access cannot move one blob into another's place and have it decrypt.
 */

import { AES_KEY_BITS, AES_KEY_BYTES, GCM_IV_BYTES, GCM_TAG_BITS } from './constants';
import { utf8ToBytes } from './encoding';
import { randomBytes } from './random';

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error(
      'WebCrypto SubtleCrypto is unavailable. This requires a secure context (HTTPS or localhost).',
    );
  }
  return s;
}

/** A sealed blob: random IV plus ciphertext-with-appended-GCM-tag. */
export interface SealedBlob {
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * Import raw key bytes as a non-extractable AES-GCM key.
 *
 * Non-extractable means the bytes live inside the browser's crypto
 * implementation and JavaScript cannot read them back out, so they do not appear
 * in a heap snapshot, an error report, or a `JSON.stringify` of some state object.
 * Everything downstream of key derivation holds `CryptoKey`, never bytes.
 */
export async function importAesKey(
  raw: Uint8Array,
  usages: readonly KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<CryptoKey> {
  if (raw.length !== AES_KEY_BYTES) {
    throw new Error(`AES key must be ${AES_KEY_BYTES} bytes, got ${raw.length}.`);
  }
  return subtle().importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    /* extractable */ false,
    usages as KeyUsage[],
  );
}

/** Generate a fresh non-extractable AES-256-GCM key. Used for every DEK and the VMK. */
export async function generateAesKey(): Promise<CryptoKey> {
  return subtle().generateKey(
    { name: 'AES-GCM', length: AES_KEY_BITS },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * An extractable AES key. Only used where the key itself must be wrapped —
 * i.e. the VMK and DEKs, whose raw bytes have to be sealed under a parent key.
 * Marked explicitly so the extractable case is always visible at the call site.
 */
export async function generateExtractableAesKey(): Promise<CryptoKey> {
  return subtle().generateKey(
    { name: 'AES-GCM', length: AES_KEY_BITS },
    /* extractable */ true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
  if (!key.extractable) {
    throw new Error('Refusing to export a non-extractable key.');
  }
  return new Uint8Array(await subtle().exportKey('raw', key));
}

/**
 * Encrypt with a fresh random 96-bit IV.
 *
 * The IV is generated here and nowhere else, so there is no code path that can
 * reuse one. GCM IV reuse under the same key is catastrophic — it leaks the XOR of
 * the two plaintexts and the authentication subkey — so this is the single most
 * important invariant in the file.
 */
export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<SealedBlob> {
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: utf8ToBytes(aad) as unknown as BufferSource,
        tagLength: GCM_TAG_BITS,
      },
      key,
      plaintext as unknown as BufferSource,
    ),
  );
  return { iv, ciphertext };
}

/**
 * Decrypt and verify. Throws `AeadError` on any failure.
 *
 * Every failure mode — wrong key, tampered ciphertext, tampered tag, wrong AAD,
 * truncated blob — surfaces as the same error with the same message. The caller
 * cannot distinguish them, and neither can an attacker probing the UI.
 */
export async function open(
  key: CryptoKey,
  blob: SealedBlob,
  aad: string,
): Promise<Uint8Array> {
  if (blob.iv.length !== GCM_IV_BYTES) {
    throw new AeadError();
  }
  try {
    const plaintext = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: blob.iv as unknown as BufferSource,
        additionalData: utf8ToBytes(aad) as unknown as BufferSource,
        tagLength: GCM_TAG_BITS,
      },
      key,
      blob.ciphertext as unknown as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new AeadError();
  }
}

/**
 * The only error `open` throws. Carries no detail, by design: a message that
 * distinguished "wrong passphrase" from "corrupted blob" would be an oracle.
 */
export class AeadError extends Error {
  constructor() {
    super('Authenticated decryption failed.');
    this.name = 'AeadError';
  }
}
