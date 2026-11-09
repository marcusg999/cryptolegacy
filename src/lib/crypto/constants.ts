/**
 * Cryptographic parameters and domain-separation labels.
 *
 * Nothing in this file may be changed without bumping the corresponding version
 * identifier, because every stored blob is interpreted according to the version
 * recorded next to it.
 *
 * NO NOVEL CRYPTOGRAPHY. Every construction here is a standard one:
 *   - Argon2id (RFC 9106) for passphrase stretching
 *   - AES-256-GCM (NIST SP 800-38D) for all confidentiality + integrity
 *   - CSPRNG from the platform (`crypto.getRandomValues`) for all key material
 */

/** Envelope format version. Stored alongside every wrapped key and ciphertext. */
export const ENVELOPE_VERSION = 1 as const;

/** AES-256-GCM. */
export const AES_KEY_BITS = 256;
export const AES_KEY_BYTES = 32;
/** 96-bit IV, the only length for which GCM's security proof is unconditional. */
export const GCM_IV_BYTES = 12;
/** 128-bit authentication tag. WebCrypto appends it to the ciphertext. */
export const GCM_TAG_BITS = 128;
export const GCM_TAG_BYTES = 16;

/** Argon2id salt length. 128 bits, per RFC 9106 §4. */
export const KDF_SALT_BYTES = 16;

/**
 * Argon2id cost profiles.
 *
 * Profiles are versioned and the profile id is stored with each key record, so a
 * vault created under profile 1 keeps unlocking after profile 2 exists, and can be
 * re-wrapped on the next successful unlock.
 *
 * Profile 1 — m = 46 MiB, t = 2, p = 1 — exceeds every configuration in the OWASP
 * Password Storage Cheat Sheet's Argon2id guidance (which lists m=47104/t=1/p=1 and
 * m=19456/t=2/p=1 among its acceptable minimums) while staying inside the memory a
 * mobile browser will actually allocate. Measured ~0.6 s in Node 22 on the build
 * machine; budget 1.5–4 s on a mid-range phone.
 *
 * Note honestly what this does and does not buy: the vault passphrase is 12+ EFF
 * diceware words (>= 155 bits), so the KDF is not what stands between an attacker
 * with our database and the plaintext — the passphrase entropy is. The KDF matters
 * for the case the spec does not allow but reality sometimes produces: a user who
 * transcribes only part of the phrase, or a future mode with a weaker secret.
 */
export interface KdfProfile {
  readonly id: number;
  readonly algorithm: 'argon2id';
  /** Memory cost in KiB. */
  readonly memoryKib: number;
  /** Time cost (iterations). */
  readonly iterations: number;
  /** Parallelism (lanes). */
  readonly parallelism: number;
  /** Derived key length in bytes. */
  readonly keyBytes: number;
}

export const KDF_PROFILE_1: KdfProfile = {
  id: 1,
  algorithm: 'argon2id',
  memoryKib: 47104,
  iterations: 2,
  parallelism: 1,
  keyBytes: AES_KEY_BYTES,
};

export const KDF_PROFILES: Readonly<Record<number, KdfProfile>> = Object.freeze({
  1: KDF_PROFILE_1,
});

/** The profile new vaults and re-wraps are created under. */
export const CURRENT_KDF_PROFILE = KDF_PROFILE_1;

/**
 * A deliberately cheap profile for tests only. Using it outside tests would weaken
 * every vault created with it, so `assertProductionProfile` rejects it.
 */
export const KDF_PROFILE_TEST: KdfProfile = {
  id: 0,
  algorithm: 'argon2id',
  memoryKib: 64,
  iterations: 1,
  parallelism: 1,
  keyBytes: AES_KEY_BYTES,
};

export function assertProductionProfile(profile: KdfProfile): void {
  if (profile.id === KDF_PROFILE_TEST.id) {
    throw new Error('Refusing to use the test KDF profile for a real vault.');
  }
  if (!KDF_PROFILES[profile.id]) {
    throw new Error(`Unknown KDF profile id: ${profile.id}`);
  }
}

/**
 * Domain-separation labels, used as AES-GCM additional authenticated data (AAD).
 *
 * Every wrap and every payload is bound to its role and its identity, so a
 * ciphertext cannot be moved from one slot to another. Swapping an item's
 * ciphertext for a different item's, or a duress key record's wrapped master key
 * for the primary record's, makes the GCM tag fail rather than silently
 * decrypting the wrong thing.
 */
export const AAD = {
  /** Wrapping of the Vault Master Key by the passphrase-derived key. */
  vaultMasterKey: (vaultId: string, keyRecordId: string) =>
    `civ/v${ENVELOPE_VERSION}/vmk|vault=${vaultId}|key=${keyRecordId}`,
  /** The sentinel blob proving a passphrase is the right one. */
  sentinel: (vaultId: string, keyRecordId: string) =>
    `civ/v${ENVELOPE_VERSION}/sentinel|vault=${vaultId}|key=${keyRecordId}`,
  /** Wrapping of a per-item Data Encryption Key by the Vault Master Key. */
  dataEncryptionKey: (vaultId: string, itemId: string) =>
    `civ/v${ENVELOPE_VERSION}/dek|vault=${vaultId}|item=${itemId}`,
  /** An item payload, bound to its item and chunk index. */
  itemPayload: (vaultId: string, itemId: string, chunkIndex: number) =>
    `civ/v${ENVELOPE_VERSION}/item|vault=${vaultId}|item=${itemId}|chunk=${chunkIndex}`,
} as const;

/**
 * Plaintext of the sentinel blob. Its content is not secret — the point is that it
 * is *known*, so a successful authenticated decryption proves the passphrase.
 */
export const SENTINEL_PLAINTEXT = `civ/v${ENVELOPE_VERSION}/sentinel-ok`;

/** EFF long wordlist size, 6^5. */
export const WORDLIST_SIZE = 7776;
/** log2(7776) — bits of entropy per independently sampled word. */
export const BITS_PER_WORD = Math.log2(WORDLIST_SIZE);

/** Minimum words in a generated passphrase. Spec §3.2. */
export const MIN_PASSPHRASE_WORDS = 12;
/** Default words in a generated passphrase. */
export const DEFAULT_PASSPHRASE_WORDS = 12;
/** Recommended minimum when the custody plan splits the phrase. Spec §4.2. */
export const RECOMMENDED_SPLIT_WORDS = 15;
/** Upper bound, purely to keep the transcription sheet printable. */
export const MAX_PASSPHRASE_WORDS = 36;

/** Canonical separator between words in a passphrase. */
export const WORD_SEPARATOR = ' ';
