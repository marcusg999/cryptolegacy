/**
 * Public surface of the cryptographic core.
 *
 * `KDF_PROFILE_TEST` is deliberately NOT re-exported. It is reachable only from
 * the deep path `@/lib/crypto/constants`, which `scripts/check-crypto-leaks.mjs`
 * permits in `tests/` and nowhere else.
 *
 * Everything the rest of the app is allowed to use is re-exported here. Importing
 * from a deeper path is a smell: it usually means a caller wants raw key bytes,
 * which it should not have.
 */

export { AeadError, type SealedBlob } from './aead';
export {
  AAD,
  BITS_PER_WORD,
  CURRENT_KDF_PROFILE,
  DEFAULT_PASSPHRASE_WORDS,
  ENVELOPE_VERSION,
  KDF_PROFILES,
  MAX_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  RECOMMENDED_SPLIT_WORDS,
  WORDLIST_SIZE,
  type KdfProfile,
} from './constants';
export {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
  zeroize,
} from './encoding';
export {
  checkTranscription,
  entropyBitsForWordCount,
  generatePassphrase,
  normalisePassphraseInput,
  wordCountForEntropyBits,
  type GeneratedPassphrase,
  type TranscriptionCheck,
} from './diceware';
export {
  openItem,
  openText,
  sealItem,
  sealText,
  type SealedItem,
  type SealedPayload,
  type WrappedKey,
} from './envelope';
export { deriveKeyEncryptionKey } from './kdf';
export { randomBytes, randomInt } from './random';
export {
  blobToRecord,
  payloadToRecord,
  recordToBlob,
  recordToPayload,
  recordToWrappedKey,
  sealedItemRecord,
  vaultKeyRecord,
  wrappedKeyToRecord,
  type SealedItemRecord,
  type VaultKeyKind,
  type VaultKeyRecord,
} from './records';
export {
  buildDuressKeyRecord,
  createVault,
  unlockVault,
  VaultIntegrityError,
  WrongPassphraseError,
  type CreateVaultResult,
  type UnlockVaultResult,
} from './vault';
export { wordIndex, wordlist, wordsWithPrefix } from './wordlist';
