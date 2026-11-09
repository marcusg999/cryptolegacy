import { describe, expect, it } from 'vitest';
import { argon2id } from '@noble/hashes/argon2.js';

import { deriveKeyEncryptionKey, newKdfSalt } from '@/lib/crypto/kdf';
import { KDF_PROFILE_1, KDF_PROFILE_TEST, KDF_SALT_BYTES, assertProductionProfile } from '@/lib/crypto/constants';
import { seal, open } from '@/lib/crypto/aead';
import { utf8ToBytes } from '@/lib/crypto/encoding';

describe('Argon2id library conformance', () => {
  // If this vector ever breaks, the library has changed behaviour and every vault
  // created before the change becomes unopenable. It is the single most important
  // regression test in the repository.
  it('matches the RFC 9106 Argon2id test vector', () => {
    const out = argon2id(
      new Uint8Array(32).fill(1),
      new Uint8Array(16).fill(2),
      {
        t: 3,
        m: 32,
        p: 4,
        key: new Uint8Array(8).fill(3),
        personalization: new Uint8Array(12).fill(4),
        dkLen: 32,
        version: 0x13,
      },
    );
    expect(Buffer.from(out).toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('deriveKeyEncryptionKey', () => {
  const salt = new Uint8Array(KDF_SALT_BYTES).fill(9);

  it('is deterministic for the same passphrase, salt and profile', async () => {
    const a = await deriveKeyEncryptionKey('abacus abdomen abide', salt, KDF_PROFILE_TEST);
    const b = await deriveKeyEncryptionKey('abacus abdomen abide', salt, KDF_PROFILE_TEST);
    const blob = await seal(a, utf8ToBytes('round trip'), 'aad');
    await expect(open(b, blob, 'aad')).resolves.toEqual(utf8ToBytes('round trip'));
  });

  it('produces a different key for a different passphrase', async () => {
    const a = await deriveKeyEncryptionKey('abacus abdomen abide', salt, KDF_PROFILE_TEST);
    const b = await deriveKeyEncryptionKey('abacus abdomen abiding', salt, KDF_PROFILE_TEST);
    const blob = await seal(a, utf8ToBytes('x'), 'aad');
    await expect(open(b, blob, 'aad')).rejects.toThrow('Authenticated decryption failed.');
  });

  it('produces a different key for a different salt', async () => {
    const a = await deriveKeyEncryptionKey('same phrase', salt, KDF_PROFILE_TEST);
    const other = new Uint8Array(KDF_SALT_BYTES).fill(10);
    const b = await deriveKeyEncryptionKey('same phrase', other, KDF_PROFILE_TEST);
    const blob = await seal(a, utf8ToBytes('x'), 'aad');
    await expect(open(b, blob, 'aad')).rejects.toThrow('Authenticated decryption failed.');
  });

  it('produces a different key under a different cost profile', async () => {
    const a = await deriveKeyEncryptionKey('same phrase', salt, KDF_PROFILE_TEST);
    const b = await deriveKeyEncryptionKey('same phrase', salt, {
      ...KDF_PROFILE_TEST,
      iterations: 2,
    });
    const blob = await seal(a, utf8ToBytes('x'), 'aad');
    await expect(open(b, blob, 'aad')).rejects.toThrow('Authenticated decryption failed.');
  });

  it('normalises the passphrase to NFKD so a Mac-typed phrase opens on Windows', async () => {
    // U+00E9 (precomposed) vs U+0065 U+0301 (decomposed) must derive the same key.
    const a = await deriveKeyEncryptionKey('café abacus', salt, KDF_PROFILE_TEST);
    const b = await deriveKeyEncryptionKey('café abacus', salt, KDF_PROFILE_TEST);
    const blob = await seal(a, utf8ToBytes('x'), 'aad');
    await expect(open(b, blob, 'aad')).resolves.toEqual(utf8ToBytes('x'));
  });

  it('rejects a salt of the wrong length', async () => {
    await expect(
      deriveKeyEncryptionKey('x', new Uint8Array(8), KDF_PROFILE_TEST),
    ).rejects.toThrow(/salt must be 16 bytes/);
  });

  it('returns a non-extractable key, so the KEK bytes cannot be read back', async () => {
    const key = await deriveKeyEncryptionKey('x', salt, KDF_PROFILE_TEST);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('reports progress without ever receiving key material', async () => {
    const seen: unknown[] = [];
    await deriveKeyEncryptionKey('x', salt, KDF_PROFILE_TEST, {
      onProgress: (f) => seen.push(f),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const v of seen) {
      expect(typeof v).toBe('number');
      expect(v as number).toBeGreaterThanOrEqual(0);
      expect(v as number).toBeLessThanOrEqual(1);
    }
  });
});

describe('cost profile guards', () => {
  it('accepts the production profile', () => {
    expect(() => assertProductionProfile(KDF_PROFILE_1)).not.toThrow();
  });

  it('refuses the test profile for a real vault', () => {
    expect(() => assertProductionProfile(KDF_PROFILE_TEST)).toThrow(/test KDF profile/);
  });

  it('refuses an unknown profile id', () => {
    expect(() => assertProductionProfile({ ...KDF_PROFILE_1, id: 99 })).toThrow(/Unknown KDF profile/);
  });

  it('keeps the production profile at or above OWASP Argon2id minimums', () => {
    // OWASP lists m=19456 KiB / t=2 / p=1 among its acceptable configurations.
    expect(KDF_PROFILE_1.memoryKib).toBeGreaterThanOrEqual(19456);
    expect(KDF_PROFILE_1.iterations).toBeGreaterThanOrEqual(2);
    expect(KDF_PROFILE_1.keyBytes).toBe(32);
    expect(KDF_PROFILE_1.algorithm).toBe('argon2id');
  });
});

describe('salt generation', () => {
  it('produces 16 distinct bytes each call', () => {
    const a = newKdfSalt();
    const b = newKdfSalt();
    expect(a.length).toBe(KDF_SALT_BYTES);
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });
});
