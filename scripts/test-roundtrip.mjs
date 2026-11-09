#!/usr/bin/env node
/**
 * The one path the unit tests cannot cover: real cryptographic output crossing a
 * real database and coming back.
 *
 * Unit tests prove the crypto in memory. The pgTAP suite proves the policies.
 * Neither exercises the conversion between a `Uint8Array` and the `\x…` text
 * representation PostgREST uses for `bytea`, and a mistake there would corrupt
 * ciphertext silently — the vault would accept the write, and the failure would
 * surface years later when someone tried to unlock it. That is exactly the kind
 * of silent cryptographic bug spec §10 warns about.
 *
 * Skips cleanly when no database is reachable, so `npm test` stays hermetic.
 *
 *   PGHOST=/tmp PGPORT=5433 PGUSER=postgres node scripts/test-roundtrip.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB = `civ_roundtrip_${process.pid}`;

function psql(args, opts = {}) {
  return execFileSync('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// --- availability -----------------------------------------------------------
try {
  psql(['-d', 'postgres', '-tAqc', 'select 1']);
} catch {
  console.log('⊘ round-trip test skipped: no PostgreSQL reachable.');
  console.log('  Start one and set PGHOST/PGPORT/PGUSER to run it.');
  process.exit(0);
}

// --- build the crypto bundle ------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'civ-roundtrip-'));
const bundle = join(outDir, 'crypto.mjs');
try {
  execFileSync(
    'npx',
    ['esbuild', 'src/lib/crypto/index.ts', '--bundle', '--format=esm',
     `--outfile=${bundle}`, '--platform=node', '--alias:@=./src', '--log-level=error'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (e) {
  console.error('Could not bundle the crypto module:', e.message);
  process.exit(1);
}

const C = await import(bundle);

// --- schema -----------------------------------------------------------------
psql(['-d', 'postgres', '-q', '-c', `drop database if exists "${DB}"`, '-c', `create database "${DB}"`]);
const cleanup = () => {
  try { psql(['-d', 'postgres', '-q', '-c', `drop database if exists "${DB}"`]); } catch {}
  rmSync(outDir, { recursive: true, force: true });
};
process.on('exit', cleanup);

psql(['-d', DB, '-q', '-v', 'ON_ERROR_STOP=1',
  '-c', 'create extension if not exists pgcrypto',
  '-c', 'create extension if not exists pgtap',
  '-c', 'create schema if not exists auth',
  '-c', 'create schema if not exists tests',
  '-c', 'create table auth.users (id uuid primary key default gen_random_uuid(), email text unique)',
]);
psql(['-d', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(ROOT, 'scripts/local-auth-harness.sql')],
  { stdio: ['ignore', 'pipe', 'ignore'] });

for (const file of execFileSync('ls', [join(ROOT, 'supabase/migrations')], { encoding: 'utf8' })
  .trim().split('\n')) {
  psql(['-d', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(ROOT, 'supabase/migrations', file)]);
}

const sql = (q) => psql(['-d', DB, '-tAqc', q]).trim();

// Mirrors src/lib/vault-api.ts exactly. If these drift, this test stops testing
// the real conversion — keep them identical.
const bytesToBytea = (b) => '\\x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const byteaToBytes = (hex) => {
  const body = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.substring(i * 2, i * 2 + 2), 16);
  return out;
};
const b64ToBytea = (b64) => bytesToBytea(C.base64ToBytes(b64));

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

// --- the round trip ---------------------------------------------------------
const userId = '00000000-0000-4000-8000-00000000f00d';
const vaultId = '00000000-0000-4000-8000-00000000fa17';
const keyRecordId = '00000000-0000-4000-8000-00000000ce11';
const itemId = '00000000-0000-4000-8000-00000000117e';

sql(`insert into auth.users (id, email) values ('${userId}','roundtrip@example.test')`);
sql(`insert into account.account_security (user_id) values ('${userId}')`);
sql(`insert into vault.vaults (id, owner_id, label) values ('${vaultId}','${userId}','Round trip')`);

const phrase = C.generatePassphrase(12);
const { keyRecord, vaultMasterKey } = await C.createVault({
  passphrase: phrase.phrase,
  vaultId,
  keyRecordId,
});

// The column constraints encode the format: a 16-byte salt, a 12-byte IV, a
// 48-byte wrapped key. An insert that violates one fails here rather than
// producing a row nothing can open.
sql(`insert into vault.vault_keys
  (id, vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel, envelope_version)
  values ('${keyRecordId}','${vaultId}','primary',${keyRecord.kdf_profile_id},
   '${b64ToBytea(keyRecord.kdf_salt)}','${b64ToBytea(keyRecord.wrapped_vmk.iv)}',
   '${b64ToBytea(keyRecord.wrapped_vmk.ciphertext)}','${b64ToBytea(keyRecord.sentinel.iv)}',
   '${b64ToBytea(keyRecord.sentinel.ciphertext)}',${keyRecord.wrapped_vmk.version})`);
check('real key material satisfies every bytea length constraint', true);

const secret = 'Ledger Nano X, attorney safe, Sacramento. Model 2, bought March 2024.';
const sealed = await C.sealText(vaultMasterKey, secret, vaultId, itemId);
sql(`insert into vault.items (id, vault_id, kind, name, plaintext_bytes,
     wrapped_dek_iv, wrapped_dek, content_iv, content, envelope_version)
     values ('${itemId}','${vaultId}','text','Wallet locations',${sealed.plaintextBytes},
     '${bytesToBytea(sealed.wrappedDek.iv)}','${bytesToBytea(sealed.wrappedDek.ciphertext)}',
     '${bytesToBytea(sealed.payload.iv)}','${bytesToBytea(sealed.payload.ciphertext)}',
     ${sealed.payload.version})`);
check('a sealed item satisfies every bytea length constraint', true);

const keyJson = JSON.parse(sql(
  `select row_to_json(t) from (select kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk,
     sentinel_iv, sentinel, envelope_version from vault.vault_keys where id='${keyRecordId}') t`));

check('bytea renders as \\x hex, which is what the client assumes',
  keyJson.kdf_salt.startsWith('\\x'), keyJson.kdf_salt.slice(0, 12) + '…');

const fromDb = {
  id: keyRecordId,
  kind: 'primary',
  kdf_profile_id: keyJson.kdf_profile_id,
  kdf_salt: C.bytesToBase64(byteaToBytes(keyJson.kdf_salt)),
  wrapped_vmk: {
    version: keyJson.envelope_version,
    iv: C.bytesToBase64(byteaToBytes(keyJson.wrapped_vmk_iv)),
    ciphertext: C.bytesToBase64(byteaToBytes(keyJson.wrapped_vmk)),
  },
  sentinel: {
    iv: C.bytesToBase64(byteaToBytes(keyJson.sentinel_iv)),
    ciphertext: C.bytesToBase64(byteaToBytes(keyJson.sentinel)),
  },
};
check('the salt survives the round trip byte for byte', fromDb.kdf_salt === keyRecord.kdf_salt);
check('the wrapped master key survives the round trip byte for byte',
  fromDb.wrapped_vmk.ciphertext === keyRecord.wrapped_vmk.ciphertext);

const unlocked = await C.unlockVault({ passphrase: phrase.phrase, vaultId, keyRecords: [fromDb] });
check('the vault unlocks from the key record as the database returns it', unlocked.kind === 'primary');

const itemJson = JSON.parse(sql(
  `select row_to_json(t) from (select wrapped_dek_iv, wrapped_dek, content_iv, content, envelope_version
     from vault.items where id='${itemId}') t`));
const opened = await C.openText(unlocked.vaultMasterKey, {
  wrappedDek: { version: itemJson.envelope_version, iv: byteaToBytes(itemJson.wrapped_dek_iv), ciphertext: byteaToBytes(itemJson.wrapped_dek) },
  payload: { version: itemJson.envelope_version, chunkIndex: 0, iv: byteaToBytes(itemJson.content_iv), ciphertext: byteaToBytes(itemJson.content) },
}, vaultId, itemId);
check('the item decrypts to the exact original', opened === secret, `${opened.length} chars`);

// What a database dump actually contains.
const stored = sql(`select string_agg(x, ' ') from (
  select encode(content,'escape') as x from vault.items
  union all select encode(wrapped_vmk,'escape') from vault.vault_keys
  union all select encode(sentinel,'escape') from vault.vault_keys) q`)
  + ' ' + sql(`select coalesce(string_agg(t::text, ' '), '') from vault.items t`)
  + ' ' + sql(`select coalesce(string_agg(t::text, ' '), '') from vault.vault_keys t`);

check('no plaintext of the item survives anywhere in the database',
  !stored.includes('Ledger') && !stored.includes('Sacramento') && !stored.includes(secret));
check('no word of the passphrase appears anywhere in the vault tables',
  phrase.words.every((w) => !stored.includes(w)));

// Corruption must surface, not decrypt to something plausible.
sql(`update vault.items set content = overlay(content placing '\\x00'::bytea from 1 for 1) where id='${itemId}'`);
const tampered = JSON.parse(sql(
  `select row_to_json(t) from (select wrapped_dek_iv, wrapped_dek, content_iv, content, envelope_version
     from vault.items where id='${itemId}') t`));
let caught = false;
try {
  await C.openText(unlocked.vaultMasterKey, {
    wrappedDek: { version: 1, iv: byteaToBytes(tampered.wrapped_dek_iv), ciphertext: byteaToBytes(tampered.wrapped_dek) },
    payload: { version: 1, chunkIndex: 0, iv: byteaToBytes(tampered.content_iv), ciphertext: byteaToBytes(tampered.content) },
  }, vaultId, itemId);
} catch (e) {
  caught = e.name === 'AeadError';
}
check('a single byte flipped in the database is caught by the GCM tag', caught);

// --- report -----------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.pass) failed += 1;
}
console.log(failed ? `\n✗ ${failed} of ${checks.length} round-trip checks FAILED` : `\n✓ ${checks.length} round-trip checks passed`);
process.exit(failed ? 1 : 0);
