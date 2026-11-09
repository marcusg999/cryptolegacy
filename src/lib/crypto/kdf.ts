/**
 * Passphrase -> key-encryption key, by Argon2id.
 *
 * STANDING RULE (spec §11): the passphrase arrives here as a string from a React
 * input and leaves as a non-extractable `CryptoKey`. Between those two points it
 * is not logged, not stored, not serialised, not put in an error message, and not
 * sent anywhere. Nothing in this file performs I/O of any kind.
 */

import { argon2idAsync } from '@noble/hashes/argon2.js';

import { importAesKey } from './aead';
import {
  KDF_PROFILES,
  KDF_PROFILE_TEST,
  KDF_SALT_BYTES,
  type KdfProfile,
} from './constants';
import { utf8ToBytes, zeroize } from './encoding';
import { randomBytes } from './random';

export function newKdfSalt(): Uint8Array {
  return randomBytes(KDF_SALT_BYTES);
}

/**
 * Look up the cost profile a stored key record was created under.
 *
 * `allowTestProfile` exists so the vault-lifecycle tests can run at cheap cost;
 * `scripts/check-crypto-leaks.mjs` fails the build if it is ever passed from
 * outside `tests/`.
 */
export function resolveKdfProfile(id: number, allowTestProfile = false): KdfProfile {
  if (allowTestProfile && id === KDF_PROFILE_TEST.id) return KDF_PROFILE_TEST;
  const profile = KDF_PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown KDF profile id: ${id}. Cannot derive this vault's key.`);
  }
  return profile;
}

export interface DeriveOptions {
  /** Progress in 0..1, for the unlock spinner. Never receives key material. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Derive the key-encryption key (KEK) that wraps a vault's master key.
 *
 * The passphrase is normalised to Unicode NFKD before hashing. Without that, a
 * phrase transcribed on a Mac and retyped on Windows can be byte-different while
 * looking identical, and the vault would refuse a correct passphrase forever.
 * EFF diceware words are plain ASCII so this is belt-and-braces, but the
 * normalisation form is part of the stored format and must never change.
 */
export async function deriveKeyEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  profile: KdfProfile,
  options: DeriveOptions = {},
): Promise<CryptoKey> {
  if (salt.length !== KDF_SALT_BYTES) {
    throw new Error(`KDF salt must be ${KDF_SALT_BYTES} bytes, got ${salt.length}.`);
  }
  if (profile.algorithm !== 'argon2id') {
    throw new Error(`Unsupported KDF algorithm: ${profile.algorithm}`);
  }

  const normalised = passphrase.normalize('NFKD');
  const passwordBytes = utf8ToBytes(normalised);
  let derived: Uint8Array | null = null;

  try {
    derived = await argon2idAsync(passwordBytes, salt, {
      t: profile.iterations,
      m: profile.memoryKib,
      p: profile.parallelism,
      dkLen: profile.keyBytes,
      version: 0x13,
      // Yield to the event loop so the unlock spinner can paint on a phone.
      asyncTick: 10,
      maxmem: 1024 * 1024 * 1024,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    // Hand the bytes to WebCrypto, which holds them non-extractably from here on.
    return await importAesKey(derived, ['encrypt', 'decrypt']);
  } finally {
    zeroize(passwordBytes, derived);
  }
}
