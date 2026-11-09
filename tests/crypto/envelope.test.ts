import { describe, expect, it } from 'vitest';

import { AeadError, generateExtractableAesKey, exportRawKey, importAesKey } from '@/lib/crypto/aead';
import { AAD, ENVELOPE_VERSION, KDF_PROFILE_TEST, SENTINEL_PLAINTEXT } from '@/lib/crypto/constants';
import { deriveKeyEncryptionKey, newKdfSalt } from '@/lib/crypto/kdf';
import {
  createVaultMasterKey,
  openItem,
  openText,
  sealItem,
  sealText,
  unwrapVaultMasterKey,
  verifySentinel,
  wrapVaultMasterKeyBytes,
} from '@/lib/crypto/envelope';
import { utf8ToBytes } from '@/lib/crypto/encoding';

const VAULT = '11111111-1111-4111-8111-111111111111';
const KEYREC = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const OTHER_ITEM = '44444444-4444-4444-8444-444444444444';

const kek = async (phrase = 'abacus abdomen abide ability ablaze able') =>
  deriveKeyEncryptionKey(phrase, new Uint8Array(16).fill(3), KDF_PROFILE_TEST);

describe('vault master key wrapping', () => {
  it('round-trips the VMK through the KEK', async () => {
    const k = await kek();
    const { key, wrapped } = await createVaultMasterKey(k, VAULT, KEYREC);
    const reopened = await unwrapVaultMasterKey(k, wrapped, VAULT, KEYREC);

    // Prove it is the same key by crossing an item between the two handles.
    const sealed = await sealItem(key, utf8ToBytes('ledger in the safe'), VAULT, ITEM);
    await expect(openItem(reopened, sealed, VAULT, ITEM)).resolves.toEqual(
      utf8ToBytes('ledger in the safe'),
    );
  });

  it('returns a VMK that JavaScript cannot read the bytes of', async () => {
    const { key } = await createVaultMasterKey(await kek(), VAULT, KEYREC);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('stamps the envelope version onto the wrapped key', async () => {
    const { wrapped } = await createVaultMasterKey(await kek(), VAULT, KEYREC);
    expect(wrapped.version).toBe(ENVELOPE_VERSION);
  });

  it('refuses to unwrap under a KEK from a different passphrase', async () => {
    const { wrapped } = await createVaultMasterKey(await kek(), VAULT, KEYREC);
    const wrong = await kek('abacus abdomen abide ability ablaze abnormal');
    await expect(unwrapVaultMasterKey(wrong, wrapped, VAULT, KEYREC)).rejects.toBeInstanceOf(
      AeadError,
    );
  });

  it('refuses to unwrap a record moved to a different vault id', async () => {
    const k = await kek();
    const { wrapped } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(
      unwrapVaultMasterKey(k, wrapped, '99999999-9999-4999-8999-999999999999', KEYREC),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses to unwrap a record moved to a different key-record id', async () => {
    const k = await kek();
    const { wrapped } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(
      unwrapVaultMasterKey(k, wrapped, VAULT, '88888888-8888-4888-8888-888888888888'),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects an unknown envelope version rather than guessing', async () => {
    const k = await kek();
    const { wrapped } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(
      unwrapVaultMasterKey(k, { ...wrapped, version: 99 }, VAULT, KEYREC),
    ).rejects.toThrow(/Unsupported envelope version 99/);
  });

  it('refuses to unwrap a truncated wrapped key', async () => {
    const k = await kek();
    const { wrapped } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(
      unwrapVaultMasterKey(
        k,
        { ...wrapped, ciphertext: wrapped.ciphertext.subarray(0, wrapped.ciphertext.length - 1) },
        VAULT,
        KEYREC,
      ),
    ).rejects.toBeInstanceOf(AeadError);
  });
});

describe('sentinel verification', () => {
  it('accepts the right KEK', async () => {
    const k = await kek();
    const { sentinel } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(verifySentinel(k, sentinel, VAULT, KEYREC)).resolves.toBe(true);
  });

  it('rejects the wrong KEK without throwing', async () => {
    const { sentinel } = await createVaultMasterKey(await kek(), VAULT, KEYREC);
    const wrong = await kek('not the phrase at all friend');
    await expect(verifySentinel(wrong, sentinel, VAULT, KEYREC)).resolves.toBe(false);
  });

  it('rejects a sentinel moved between key records', async () => {
    const k = await kek();
    const { sentinel } = await createVaultMasterKey(k, VAULT, KEYREC);
    await expect(
      verifySentinel(k, sentinel, VAULT, '77777777-7777-4777-8777-777777777777'),
    ).resolves.toBe(false);
  });

  it('rejects a tampered sentinel', async () => {
    const k = await kek();
    const { sentinel } = await createVaultMasterKey(k, VAULT, KEYREC);
    const ct = Uint8Array.from(sentinel.ciphertext);
    ct[0] ^= 0xff;
    await expect(verifySentinel(k, { ...sentinel, ciphertext: ct }, VAULT, KEYREC)).resolves.toBe(
      false,
    );
  });

  it('rejects a sentinel that decrypts to the wrong known plaintext', async () => {
    // Forge a well-formed sentinel under the right key but with other contents.
    const k = await kek();
    const { seal } = await import('@/lib/crypto/aead');
    const forged = await seal(k, utf8ToBytes('something else'), AAD.sentinel(VAULT, KEYREC));
    await expect(verifySentinel(k, forged, VAULT, KEYREC)).resolves.toBe(false);
  });

  it('does not leak the passphrase or the key through the sentinel plaintext', async () => {
    expect(SENTINEL_PLAINTEXT).toBe('civ/v1/sentinel-ok');
    const { sentinel } = await createVaultMasterKey(await kek(), VAULT, KEYREC);
    const hex = Buffer.from(sentinel.ciphertext).toString('hex');
    expect(hex).not.toContain(Buffer.from('abacus').toString('hex'));
  });
});

describe('duress key records', () => {
  it('wraps a different master key under a different passphrase', async () => {
    const realKek = await kek('the real phrase goes right here ok');
    const duressKek = await kek('the duress phrase goes right here');

    const real = await createVaultMasterKey(realKek, VAULT, KEYREC);
    const decoy = await generateExtractableAesKey();
    const decoyRaw = await exportRawKey(decoy);
    const duressRec = await wrapVaultMasterKeyBytes(duressKek, decoyRaw, VAULT, 'duress-rec');

    // The duress passphrase opens the decoy, never the real master key.
    const opened = await unwrapVaultMasterKey(duressKek, duressRec.wrapped, VAULT, 'duress-rec');
    const probe = await sealItem(await importAesKey(decoyRaw), utf8ToBytes('decoy'), VAULT, ITEM);
    await expect(openItem(opened, probe, VAULT, ITEM)).resolves.toEqual(utf8ToBytes('decoy'));

    // And it cannot open the real one.
    await expect(
      unwrapVaultMasterKey(duressKek, real.wrapped, VAULT, KEYREC),
    ).rejects.toBeInstanceOf(AeadError);
    await expect(
      unwrapVaultMasterKey(realKek, duressRec.wrapped, VAULT, 'duress-rec'),
    ).rejects.toBeInstanceOf(AeadError);
  });
});

describe('item sealing', () => {
  const vmk = async () => (await createVaultMasterKey(await kek(), VAULT, KEYREC)).key;

  it('round-trips bytes', async () => {
    const key = await vmk();
    const payload = crypto.getRandomValues(new Uint8Array(4096));
    const sealed = await sealItem(key, payload, VAULT, ITEM);
    await expect(openItem(key, sealed, VAULT, ITEM)).resolves.toEqual(payload);
    expect(sealed.plaintextBytes).toBe(4096);
  });

  it('round-trips text, including astral-plane characters', async () => {
    const key = await vmk();
    const text = 'Dad — the Ledger is in the safe. 🗝️ Seed on the steel plate. ✅';
    const sealed = await sealText(key, text, VAULT, ITEM);
    await expect(openText(key, sealed, VAULT, ITEM)).resolves.toBe(text);
  });

  it('round-trips an empty text item', async () => {
    const key = await vmk();
    const sealed = await sealText(key, '', VAULT, ITEM);
    await expect(openText(key, sealed, VAULT, ITEM)).resolves.toBe('');
  });

  it('uses a distinct DEK per item', async () => {
    const key = await vmk();
    const a = await sealItem(key, utf8ToBytes('same'), VAULT, ITEM);
    const b = await sealItem(key, utf8ToBytes('same'), VAULT, OTHER_ITEM);
    expect(Buffer.from(a.wrappedDek.ciphertext).toString('hex')).not.toBe(
      Buffer.from(b.wrappedDek.ciphertext).toString('hex'),
    );
  });

  it('refuses an item whose wrapped DEK was swapped for another item’s', async () => {
    const key = await vmk();
    const a = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);
    const b = await sealItem(key, utf8ToBytes('bravo'), VAULT, OTHER_ITEM);
    await expect(
      openItem(key, { wrappedDek: b.wrappedDek, payload: a.payload }, VAULT, ITEM),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses an item payload moved to a different item id', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);
    await expect(openItem(key, sealed, VAULT, OTHER_ITEM)).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses an item payload moved to a different vault id', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);
    await expect(
      openItem(key, sealed, '55555555-5555-4555-8555-555555555555', ITEM),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses an item payload whose chunk index was altered', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM, 0);
    await expect(
      openItem(key, { ...sealed, payload: { ...sealed.payload, chunkIndex: 1 } }, VAULT, ITEM),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('keeps chunks of one item independently openable and order-bound', async () => {
    const key = await vmk();
    const c0 = await sealItem(key, utf8ToBytes('chunk zero'), VAULT, ITEM, 0);
    const c1 = await sealItem(key, utf8ToBytes('chunk one'), VAULT, ITEM, 1);
    await expect(openItem(key, c0, VAULT, ITEM)).resolves.toEqual(utf8ToBytes('chunk zero'));
    await expect(openItem(key, c1, VAULT, ITEM)).resolves.toEqual(utf8ToBytes('chunk one'));
    // A chunk relabelled with its neighbour's index must not open.
    await expect(
      openItem(key, { wrappedDek: c0.wrappedDek, payload: { ...c0.payload, chunkIndex: 1 } }, VAULT, ITEM),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses an item under a different vault master key', async () => {
    const key = await vmk();
    const otherKek = await kek('an entirely different passphrase here');
    const other = (await createVaultMasterKey(otherKek, VAULT, KEYREC)).key;
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);
    await expect(openItem(other, sealed, VAULT, ITEM)).rejects.toBeInstanceOf(AeadError);
  });

  it('refuses a tampered payload and a tampered wrapped DEK', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);

    const payloadCt = Uint8Array.from(sealed.payload.ciphertext);
    payloadCt[0] ^= 0x01;
    await expect(
      openItem(key, { ...sealed, payload: { ...sealed.payload, ciphertext: payloadCt } }, VAULT, ITEM),
    ).rejects.toBeInstanceOf(AeadError);

    const dekCt = Uint8Array.from(sealed.wrappedDek.ciphertext);
    dekCt[0] ^= 0x01;
    await expect(
      openItem(key, { ...sealed, wrappedDek: { ...sealed.wrappedDek, ciphertext: dekCt } }, VAULT, ITEM),
    ).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects an unknown envelope version on either layer', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, utf8ToBytes('alpha'), VAULT, ITEM);
    await expect(
      openItem(key, { ...sealed, wrappedDek: { ...sealed.wrappedDek, version: 2 } }, VAULT, ITEM),
    ).rejects.toThrow(/Unsupported envelope version/);
    await expect(
      openItem(key, { ...sealed, payload: { ...sealed.payload, version: 2 } }, VAULT, ITEM),
    ).rejects.toThrow(/Unsupported envelope version/);
  });

  it('does not leave the plaintext recognisable in the ciphertext', async () => {
    const key = await vmk();
    const secret = 'witch collapse practice feed shame open despair creek road again ice least';
    const sealed = await sealText(key, secret, VAULT, ITEM);
    const hex = Buffer.from(sealed.payload.ciphertext).toString('hex');
    expect(hex).not.toContain(Buffer.from(secret).toString('hex'));
    expect(hex).not.toContain(Buffer.from('witch').toString('hex'));
  });

  it('refuses to decode invalid UTF-8 as text rather than returning mojibake', async () => {
    const key = await vmk();
    const sealed = await sealItem(key, new Uint8Array([0xff, 0xfe, 0xfd]), VAULT, ITEM);
    await expect(openText(key, sealed, VAULT, ITEM)).rejects.toThrow();
  });
});
