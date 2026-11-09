import { describe, expect, it } from 'vitest';

import {
  buildDuressKeyRecord,
  createVault,
  unlockVault,
  VaultIntegrityError,
  WrongPassphraseError,
} from '@/lib/crypto/vault';
import { KDF_PROFILE_1, KDF_PROFILE_TEST } from '@/lib/crypto/constants';
import { generatePassphrase } from '@/lib/crypto/diceware';
import { openText, sealText } from '@/lib/crypto/envelope';
import { exportRawKey, generateExtractableAesKey } from '@/lib/crypto/aead';
import { vaultKeyRecord } from '@/lib/crypto/records';

const VAULT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEYREC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DURESS_KEYREC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ITEM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const PHRASE = 'witch collapse practice feed shame open despair creek road again ice least';
const WRONG = 'witch collapse practice feed shame open despair creek road again ice lease';

const create = (phrase = PHRASE) =>
  createVault({
    passphrase: phrase,
    vaultId: VAULT,
    keyRecordId: KEYREC,
    profile: KDF_PROFILE_TEST,
    allowTestProfile: true,
  });

describe('vault lifecycle', () => {
  it('creates a vault and unlocks it with the same passphrase', async () => {
    const { keyRecord, vaultMasterKey } = await create();
    const sealed = await sealText(vaultMasterKey, 'Seed is on the steel plate.', VAULT, ITEM);

    const unlocked = await unlockVault({
      passphrase: PHRASE,
      vaultId: VAULT,
      keyRecords: [keyRecord],
      allowTestProfile: true,
    });
    expect(unlocked.kind).toBe('primary');
    expect(unlocked.keyRecordId).toBe(KEYREC);
    await expect(openText(unlocked.vaultMasterKey, sealed, VAULT, ITEM)).resolves.toBe(
      'Seed is on the steel plate.',
    );
  });

  it('produces a key record that contains no secret material', async () => {
    const { keyRecord } = await create();
    const serialised = JSON.stringify(keyRecord);

    // Not the passphrase, nor any word of it, nor a hash or verifier of it.
    for (const word of PHRASE.split(' ')) {
      expect(serialised).not.toContain(word);
    }
    expect(serialised).not.toContain(PHRASE);
    // Field set is exactly: id, kind, kdf profile/salt, wrapped key, sentinel.
    expect(Object.keys(keyRecord).sort()).toEqual([
      'id',
      'kdf_profile_id',
      'kdf_salt',
      'kind',
      'sentinel',
      'wrapped_vmk',
    ]);
    // No field whose name suggests a server-side strength signal.
    expect(serialised).not.toMatch(/strength|score|verifier|hash|hint|clue/i);
  });

  it('emits a key record that validates against the wire schema', async () => {
    const { keyRecord } = await create();
    expect(() => vaultKeyRecord.parse(keyRecord)).not.toThrow();
  });

  it('uses a different salt for every vault, so one rainbow table cannot cover two', async () => {
    const a = await create();
    const b = await create();
    expect(a.keyRecord.kdf_salt).not.toBe(b.keyRecord.kdf_salt);
    expect(a.keyRecord.wrapped_vmk.ciphertext).not.toBe(b.keyRecord.wrapped_vmk.ciphertext);
  });

  it('uses a different master key for every vault', async () => {
    const a = await create();
    const b = await create();
    const sealed = await sealText(a.vaultMasterKey, 'x', VAULT, ITEM);
    await expect(openText(b.vaultMasterKey, sealed, VAULT, ITEM)).rejects.toThrow();
  });

  it('defaults to the production cost profile when none is given', async () => {
    const { keyRecord } = await createVault({
      passphrase: PHRASE,
      vaultId: VAULT,
      keyRecordId: KEYREC,
    });
    expect(keyRecord.kdf_profile_id).toBe(KDF_PROFILE_1.id);
  }, 60_000);
});

describe('unlockVault — negative cases', () => {
  it('rejects a one-character-off passphrase', async () => {
    const { keyRecord } = await create();
    await expect(
      unlockVault({ passphrase: WRONG, vaultId: VAULT, keyRecords: [keyRecord], allowTestProfile: true }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a passphrase with words in the wrong order', async () => {
    const { keyRecord } = await create();
    const reordered = PHRASE.split(' ').reverse().join(' ');
    await expect(
      unlockVault({ passphrase: reordered, vaultId: VAULT, keyRecords: [keyRecord], allowTestProfile: true }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects an empty passphrase', async () => {
    const { keyRecord } = await create();
    await expect(
      unlockVault({ passphrase: '', vaultId: VAULT, keyRecords: [keyRecord], allowTestProfile: true }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a prefix of the passphrase — there is no partial credit', async () => {
    const { keyRecord } = await create();
    const words = PHRASE.split(' ');
    for (const n of [1, 6, 11]) {
      await expect(
        unlockVault({
          passphrase: words.slice(0, n).join(' '),
          vaultId: VAULT,
          keyRecords: [keyRecord],
          allowTestProfile: true,
        }),
      ).rejects.toBeInstanceOf(WrongPassphraseError);
    }
  });

  it('rejects the right passphrase against the wrong vault id', async () => {
    const { keyRecord } = await create();
    await expect(
      unlockVault({
        passphrase: PHRASE,
        vaultId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        keyRecords: [keyRecord],
        allowTestProfile: true,
      }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a key record whose salt was swapped', async () => {
    const { keyRecord } = await create();
    const other = await create();
    await expect(
      unlockVault({
        passphrase: PHRASE,
        vaultId: VAULT,
        keyRecords: [{ ...keyRecord, kdf_salt: other.keyRecord.kdf_salt }],
        allowTestProfile: true,
      }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('distinguishes a damaged wrapped key from a wrong passphrase', async () => {
    // Sentinel intact, wrapped VMK corrupted: the user must not be told to go
    // hunting for a transcription error that does not exist.
    const { keyRecord } = await create();
    const bytes = Buffer.from(keyRecord.wrapped_vmk.ciphertext, 'base64');
    bytes[0] = (bytes[0] as number) ^ 0xff;
    const damaged = {
      ...keyRecord,
      wrapped_vmk: { ...keyRecord.wrapped_vmk, ciphertext: bytes.toString('base64') },
    };
    await expect(
      unlockVault({ passphrase: PHRASE, vaultId: VAULT, keyRecords: [damaged], allowTestProfile: true }),
    ).rejects.toBeInstanceOf(VaultIntegrityError);
  });

  it('refuses a vault with no key records', async () => {
    await expect(
      unlockVault({ passphrase: PHRASE, vaultId: VAULT, keyRecords: [] }),
    ).rejects.toThrow(/no key records/);
  });

  it('refuses a key record referencing an unknown cost profile', async () => {
    const { keyRecord } = await create();
    await expect(
      unlockVault({
        passphrase: PHRASE,
        vaultId: VAULT,
        keyRecords: [{ ...keyRecord, kdf_profile_id: 404 }],
        allowTestProfile: true,
      }),
    ).rejects.toThrow(/Unknown KDF profile id: 404/);
  });

  it('gives the same error for every wrong passphrase, leaking nothing about closeness', async () => {
    const { keyRecord } = await create();
    const messages = new Set<string>();
    for (const attempt of [WRONG, '', 'zoom zoom zoom', PHRASE.slice(0, 20)]) {
      await unlockVault({ passphrase: attempt, vaultId: VAULT, keyRecords: [keyRecord], allowTestProfile: true }).catch(
        (e: Error) => messages.add(e.message),
      );
    }
    expect(messages.size).toBe(1);
  });
});

describe('unlockVault — duress record (spec §6.3)', () => {
  const duressPhrase = 'zoom zebra yoga yummy wrist wrath wording wonderful woozy woof wolf wobbly';

  const withDuress = async () => {
    const real = await create();
    const decoy = await generateExtractableAesKey();
    const decoyRaw = await exportRawKey(decoy);
    const duress = await buildDuressKeyRecord({
      duressPassphrase: duressPhrase,
      vaultId: VAULT,
      keyRecordId: DURESS_KEYREC,
      decoyMasterKeyRaw: decoyRaw,
      profile: KDF_PROFILE_TEST,
      allowTestProfile: true,
    });
    return { real, duress, decoyRaw };
  };

  it('the primary passphrase still selects the primary record', async () => {
    const { real, duress } = await withDuress();
    const r = await unlockVault({
      passphrase: PHRASE,
      vaultId: VAULT,
      keyRecords: [real.keyRecord, duress],
      allowTestProfile: true,
    });
    expect(r.kind).toBe('primary');
    expect(r.keyRecordId).toBe(KEYREC);
  });

  it('the duress passphrase selects the duress record and a different master key', async () => {
    const { real, duress } = await withDuress();
    const r = await unlockVault({
      passphrase: duressPhrase,
      vaultId: VAULT,
      keyRecords: [real.keyRecord, duress],
      allowTestProfile: true,
    });
    expect(r.kind).toBe('duress');
    expect(r.keyRecordId).toBe(DURESS_KEYREC);

    // Real content sealed under the real VMK must not open under the duress one.
    const realItem = await sealText(real.vaultMasterKey, 'real seed location', VAULT, ITEM);
    await expect(openText(r.vaultMasterKey, realItem, VAULT, ITEM)).rejects.toThrow();
  });

  it('a duress record is indistinguishable from a primary one by shape alone', async () => {
    const { real, duress } = await withDuress();
    const shape = (r: object) => Object.keys(r).sort().join(',');
    expect(shape(duress)).toBe(shape(real.keyRecord));
    expect(duress.kdf_salt.length).toBe(real.keyRecord.kdf_salt.length);
    expect(duress.wrapped_vmk.ciphertext.length).toBe(
      real.keyRecord.wrapped_vmk.ciphertext.length,
    );
    expect(duress.sentinel.ciphertext.length).toBe(real.keyRecord.sentinel.ciphertext.length);
  });

  it('a wrong passphrase still fails against both records', async () => {
    const { real, duress } = await withDuress();
    await expect(
      unlockVault({ passphrase: WRONG, vaultId: VAULT, keyRecords: [real.keyRecord, duress], allowTestProfile: true }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe('end-to-end: generated phrase through create, store, reload, unlock', () => {
  it('a freshly generated 12-word phrase opens a vault rebuilt from JSON', async () => {
    const generated = generatePassphrase(12);
    const { keyRecord, vaultMasterKey } = await createVault({
      passphrase: generated.phrase,
      vaultId: VAULT,
      keyRecordId: KEYREC,
      profile: KDF_PROFILE_TEST,
      allowTestProfile: true,
    });

    const sealed = await sealText(
      vaultMasterKey,
      'Ledger Nano X, attorney safe, Sacramento.',
      VAULT,
      ITEM,
    );

    // Simulate the full server round trip: everything goes through JSON.
    const fromServer = vaultKeyRecord.parse(JSON.parse(JSON.stringify(keyRecord)));
    const storedItem = JSON.parse(
      JSON.stringify({
        iv: Buffer.from(sealed.payload.iv).toString('base64'),
        ct: Buffer.from(sealed.payload.ciphertext).toString('base64'),
        dekIv: Buffer.from(sealed.wrappedDek.iv).toString('base64'),
        dekCt: Buffer.from(sealed.wrappedDek.ciphertext).toString('base64'),
      }),
    );

    const unlocked = await unlockVault({
      passphrase: generated.phrase,
      vaultId: VAULT,
      keyRecords: [fromServer],
      allowTestProfile: true,
    });

    await expect(
      openText(
        unlocked.vaultMasterKey,
        {
          wrappedDek: {
            version: 1,
            iv: new Uint8Array(Buffer.from(storedItem.dekIv, 'base64')),
            ciphertext: new Uint8Array(Buffer.from(storedItem.dekCt, 'base64')),
          },
          payload: {
            version: 1,
            chunkIndex: 0,
            iv: new Uint8Array(Buffer.from(storedItem.iv, 'base64')),
            ciphertext: new Uint8Array(Buffer.from(storedItem.ct, 'base64')),
          },
        },
        VAULT,
        ITEM,
      ),
    ).resolves.toBe('Ledger Nano X, attorney safe, Sacramento.');
  });
});
