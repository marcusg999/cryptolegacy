#!/usr/bin/env node
/**
 * Spec §11: "The passphrase never leaves the browser. Not in logs, analytics,
 * error reports, Sentry breadcrumbs, LLM calls, or any network request. Add a CI
 * check that greps for leak patterns in anything touching the crypto module."
 *
 * This is that check. It is a grep, with all the limitations of a grep — it
 * cannot prove the absence of a leak, and it is not a substitute for the
 * external review the build gate requires. What it does do is make the obvious
 * regressions impossible to merge: a `console.log(passphrase)` added while
 * debugging, a telemetry call dropped into the crypto module, a service-role key
 * reachable from client code.
 *
 * Exits non-zero on any finding. Run by `npm run ci`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const findings = [];
const report = (file, line, rule, detail) =>
  findings.push({ file: relative(ROOT, file), line, rule, detail });

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'coverage', 'out'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const allFiles = walk(join(ROOT, 'src')).concat(
  walk(join(ROOT, 'scripts')),
  walk(join(ROOT, 'tests')),
);

const cryptoFiles = allFiles.filter((f) =>
  /src\/lib\/(crypto|custody)\//.test(f.replace(/\\/g, '/')),
);
const clientFiles = allFiles.filter((f) => {
  const p = f.replace(/\\/g, '/');
  return /src\//.test(p) && !/src\/lib\/server\//.test(p) && !/\/api\//.test(p);
});

const lines = (file) => readFileSync(file, 'utf8').split('\n');

// --- 1. The crypto and custody modules perform no I/O and no logging. --------
//
// The rule is structural rather than name-based: these modules are pure
// functions over bytes. Anything that could carry a value off the machine has no
// business in them, whatever it is called.
const IO_PATTERNS = [
  [/\bconsole\s*\./, 'console.* — the crypto module must not log'],
  [/\bfetch\s*\(/, 'fetch() — the crypto module must not make network requests'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest — no network access from the crypto module'],
  [/\bnavigator\s*\.\s*sendBeacon\b/, 'sendBeacon — telemetry has no place here'],
  [/\b(localStorage|sessionStorage|indexedDB)\b/, 'persistent storage — key material must never be written to disk'],
  [/\bdocument\s*\.\s*cookie\b/, 'document.cookie — key material must never reach a cookie'],
  [/\b(Sentry|datadog|LogRocket|mixpanel|amplitude|posthog|analytics)\b/i, 'third-party telemetry SDK'],
  [/\bprocess\s*\.\s*env\b/, 'process.env — the crypto module takes no configuration from the environment'],
];

for (const file of cryptoFiles) {
  lines(file).forEach((text, i) => {
    const code = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    for (const [pattern, detail] of IO_PATTERNS) {
      if (pattern.test(code)) report(file, i + 1, 'no-io-in-crypto', detail);
    }
  });
}

// --- 2. No passphrase-shaped value may be interpolated into a sink. ----------
const SECRET_IDENT =
  /(passphrase|passPhrase|mnemonic|seedPhrase|seed_phrase|privateKey|private_key|secretKey|rawKey|keyMaterial|vmk|kek|dek)/;
const SINK =
  /(console\.\w+|fetch|sendBeacon|JSON\.stringify|localStorage|sessionStorage|document\.cookie|\.setItem|URLSearchParams|new\s+Request|new\s+Headers|alert|captureException|captureMessage)/;

for (const file of allFiles) {
  if (/scripts\/check-crypto-leaks\.mjs$/.test(file.replace(/\\/g, '/'))) continue;
  lines(file).forEach((text, i) => {
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(text)) return; // JSDoc
    if (SINK.test(code) && SECRET_IDENT.test(code)) {
      // Tests legitimately assert that a serialised record does NOT contain the
      // phrase; that is the opposite of a leak, so allow an explicit waiver.
      if (/leak-check-ok:/.test(text)) return;
      report(file, i + 1, 'secret-into-sink', `a secret-shaped identifier reaches a sink: ${code.trim().slice(0, 100)}`);
    }
  });
}

// --- 3. The service-role key must be unreachable from client code. -----------
for (const file of clientFiles) {
  lines(file).forEach((text, i) => {
    if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(text) && !/^\s*(\*|\/\/)/.test(text)) {
      report(file, i + 1, 'service-role-in-client', 'service-role key referenced outside src/lib/server and /api');
    }
  });
}

// --- 4. No secret may be smuggled behind the NEXT_PUBLIC_ prefix. -----------
for (const file of allFiles) {
  lines(file).forEach((text, i) => {
    const m = text.match(/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE|PRIVATE|PASSPHRASE|TOKEN)[A-Z0-9_]*/);
    if (m) report(file, i + 1, 'secret-in-public-env', `${m[0]} is shipped to the browser`);
  });
}

// --- 5. The test-only cheap KDF profile must not escape the test suite. ------
for (const file of allFiles) {
  const p = file.replace(/\\/g, '/');
  if (/^.*\/tests\//.test(p)) continue;
  if (/scripts\/check-crypto-leaks\.mjs$/.test(p)) continue; // this file names the pattern
  if (/src\/lib\/crypto\/(constants|kdf|vault)\.ts$/.test(p)) continue; // where it is defined and guarded
  lines(file).forEach((text, i) => {
    if (/allowTestProfile|KDF_PROFILE_TEST/.test(text) && !/^\s*(\*|\/\/)/.test(text)) {
      report(file, i + 1, 'test-kdf-profile-outside-tests',
        'the cheap test KDF profile is referenced outside the test suite');
    }
  });
}

// --- 6. Argon2id parameters must not be weakened below OWASP guidance. ------
{
  const constants = readFileSync(join(ROOT, 'src/lib/crypto/constants.ts'), 'utf8');
  const profile = constants.match(/export const KDF_PROFILE_1[^}]+}/s)?.[0] ?? '';
  const memory = Number(profile.match(/memoryKib:\s*(\d+)/)?.[1] ?? 0);
  const iterations = Number(profile.match(/iterations:\s*(\d+)/)?.[1] ?? 0);
  if (memory < 19456) {
    report(join(ROOT, 'src/lib/crypto/constants.ts'), 0, 'weak-kdf',
      `Argon2id memory cost ${memory} KiB is below the OWASP minimum of 19456 KiB`);
  }
  if (iterations < 2) {
    report(join(ROOT, 'src/lib/crypto/constants.ts'), 0, 'weak-kdf',
      `Argon2id time cost ${iterations} is below the OWASP minimum of 2`);
  }
  if (!/argon2id/.test(constants)) {
    report(join(ROOT, 'src/lib/crypto/constants.ts'), 0, 'weak-kdf', 'Argon2id is no longer the KDF');
  }
}

// --- 7. AES-GCM IVs must come only from the one place that randomises them. --
{
  const aead = readFileSync(join(ROOT, 'src/lib/crypto/aead.ts'), 'utf8');
  if (!/const iv = randomBytes\(GCM_IV_BYTES\)/.test(aead)) {
    report(join(ROOT, 'src/lib/crypto/aead.ts'), 0, 'iv-generation',
      'seal() no longer generates its IV with randomBytes(GCM_IV_BYTES)');
  }
  for (const file of allFiles) {
    const p = file.replace(/\\/g, '/');
    if (/src\/lib\/crypto\/aead\.ts$/.test(p) || /\/tests\//.test(p)) continue;
    lines(file).forEach((text, i) => {
      if (/name:\s*['"]AES-GCM['"]/.test(text)) {
        report(file, i + 1, 'aes-gcm-outside-aead',
          'AES-GCM is used outside src/lib/crypto/aead.ts, bypassing the single IV source');
      }
    });
  }
}

// --- report ----------------------------------------------------------------
if (findings.length === 0) {
  console.log('✓ crypto leak check: no findings');
  process.exit(0);
}

console.error(`✗ crypto leak check: ${findings.length} finding(s)\n`);
for (const f of findings) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
  console.error(`    [${f.rule}] ${f.detail}\n`);
}
console.error('A finding here is a potential disclosure of key material. Do not suppress');
console.error('without understanding it; see SECURITY.md and spec §11.');
process.exit(1);
