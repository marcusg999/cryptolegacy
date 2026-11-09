import { describe, expect, it } from 'vitest';

import {
  AeadError,
  exportRawKey,
  generateAesKey,
  generateExtractableAesKey,
  importAesKey,
  open,
  seal,
} from '@/lib/crypto/aead';
import { GCM_IV_BYTES, GCM_TAG_BYTES } from '@/lib/crypto/constants';
import { utf8ToBytes } from '@/lib/crypto/encoding';

const AAD = 'civ/test/aad';

describe('seal / open round trip', () => {
  it('recovers the exact plaintext', async () => {
    const key = await generateAesKey();
    const plaintext = utf8ToBytes('4 BTC behind a passphrase nobody wrote down');
    const blob = await seal(key, plaintext, AAD);
    await expect(open(key, blob, AAD)).resolves.toEqual(plaintext);
  });

  it('handles an empty plaintext', async () => {
    const key = await generateAesKey();
    const blob = await seal(key, new Uint8Array(0), AAD);
    expect(blob.ciphertext.length).toBe(GCM_TAG_BYTES);
    await expect(open(key, blob, AAD)).resolves.toEqual(new Uint8Array(0));
  });

  it('handles a 1 MiB plaintext', async () => {
    const key = await generateAesKey();
    const plaintext = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(plaintext.subarray(0, 65536));
    const blob = await seal(key, plaintext, AAD);
    await expect(open(key, blob, AAD)).resolves.toEqual(plaintext);
  });

  it('uses a fresh 96-bit IV for every call', async () => {
    const key = await generateAesKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const blob = await seal(key, utf8ToBytes('same plaintext every time'), AAD);
      expect(blob.iv.length).toBe(GCM_IV_BYTES);
      ivs.add(Buffer.from(blob.iv).toString('hex'));
    }
    // IV reuse under one key is the catastrophic failure for GCM.
    expect(ivs.size).toBe(200);
  });

  it('produces different ciphertext for identical plaintext', async () => {
    const key = await generateAesKey();
    const a = await seal(key, utf8ToBytes('deterministic?'), AAD);
    const b = await seal(key, utf8ToBytes('deterministic?'), AAD);
    expect(Buffer.from(a.ciphertext).toString('hex')).not.toBe(
      Buffer.from(b.ciphertext).toString('hex'),
    );
  });
});

describe('open — adversarial cases', () => {
  const makeBlob = async () => {
    const key = await generateAesKey();
    const blob = await seal(key, utf8ToBytes('wallet recovery instructions'), AAD);
    return { key, blob };
  };

  it('rejects a wrong key', async () => {
    const { blob } = await makeBlob();
    const other = await generateAesKey();
    await expect(open(other, blob, AAD)).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects a flipped bit anywhere in the ciphertext body', async () => {
    const { key, blob } = await makeBlob();
    for (let i = 0; i < blob.ciphertext.length - GCM_TAG_BYTES; i += 1) {
      const tampered = Uint8Array.from(blob.ciphertext);
      tampered[i] ^= 0x01;
      await expect(open(key, { ...blob, ciphertext: tampered }, AAD)).rejects.toBeInstanceOf(
        AeadError,
      );
    }
  });

  it('rejects a tampered GCM tag', async () => {
    const { key, blob } = await makeBlob();
    for (let i = blob.ciphertext.length - GCM_TAG_BYTES; i < blob.ciphertext.length; i += 1) {
      const tampered = Uint8Array.from(blob.ciphertext);
      tampered[i] ^= 0x80;
      await expect(open(key, { ...blob, ciphertext: tampered }, AAD)).rejects.toBeInstanceOf(
        AeadError,
      );
    }
  });

  it('rejects a tampered IV', async () => {
    const { key, blob } = await makeBlob();
    const iv = Uint8Array.from(blob.iv);
    iv[0] ^= 0xff;
    await expect(open(key, { ...blob, iv }, AAD)).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects a truncated ciphertext', async () => {
    const { key, blob } = await makeBlob();
    for (const cut of [1, GCM_TAG_BYTES, blob.ciphertext.length - 1]) {
      const truncated = blob.ciphertext.subarray(0, blob.ciphertext.length - cut);
      await expect(open(key, { ...blob, ciphertext: truncated }, AAD)).rejects.toBeInstanceOf(
        AeadError,
      );
    }
  });

  it('rejects a ciphertext shorter than the tag', async () => {
    const { key } = await makeBlob();
    await expect(
      open(key, { iv: new Uint8Array(GCM_IV_BYTES), ciphertext: new Uint8Array(4) }, AAD),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects an IV of the wrong length without calling WebCrypto', async () => {
    const { key, blob } = await makeBlob();
    await expect(open(key, { ...blob, iv: new Uint8Array(16) }, AAD)).rejects.toBeInstanceOf(
      AeadError,
    );
    await expect(open(key, { ...blob, iv: new Uint8Array(0) }, AAD)).rejects.toBeInstanceOf(
      AeadError,
    );
  });

  it('rejects mismatched AAD — this is what stops a blob being moved between slots', async () => {
    const { key, blob } = await makeBlob();
    await expect(open(key, blob, 'civ/test/different-slot')).rejects.toBeInstanceOf(AeadError);
    await expect(open(key, blob, '')).rejects.toBeInstanceOf(AeadError);
  });

  it('gives the same opaque message for every failure mode', async () => {
    const { key, blob } = await makeBlob();
    const other = await generateAesKey();
    const tampered = Uint8Array.from(blob.ciphertext);
    tampered[0] ^= 1;

    const messages = new Set<string>();
    for (const attempt of [
      () => open(other, blob, AAD),
      () => open(key, { ...blob, ciphertext: tampered }, AAD),
      () => open(key, blob, 'wrong-aad'),
      () => open(key, { ...blob, iv: new Uint8Array(16) }, AAD),
    ]) {
      await attempt().catch((e: Error) => messages.add(e.message));
    }
    expect(messages.size).toBe(1);
  });
});

describe('key handling', () => {
  it('generateAesKey returns a non-extractable key', async () => {
    const key = await generateAesKey();
    expect(key.extractable).toBe(false);
    await expect(exportRawKey(key)).rejects.toThrow(/non-extractable/);
  });

  it('importAesKey refuses a key of the wrong length', async () => {
    await expect(importAesKey(new Uint8Array(16))).rejects.toThrow(/must be 32 bytes/);
    await expect(importAesKey(new Uint8Array(64))).rejects.toThrow(/must be 32 bytes/);
  });

  it('an extractable key exports to 32 bytes', async () => {
    const key = await generateExtractableAesKey();
    const raw = await exportRawKey(key);
    expect(raw.length).toBe(32);
  });

  it('imported keys are non-extractable even when the source bytes were known', async () => {
    const raw = new Uint8Array(32).fill(7);
    const key = await importAesKey(raw);
    expect(key.extractable).toBe(false);
  });
});
