#!/usr/bin/env node
/**
 * Generates src/lib/crypto/wordlist.generated.ts from data/eff_large_wordlist.txt.
 *
 * Run after changing the vendored list (which should essentially never happen).
 * CI does not run this; it runs verify-wordlist.mjs, which checks the digest and
 * that the generated file still matches the source.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}data/eff_large_wordlist.txt`, 'utf8');
const digest = createHash('sha256').update(source).digest('hex');

const rows = source.replace(/\r/g, '').trim().split('\n');
if (rows.length !== 7776) throw new Error(`Expected 7776 rows, got ${rows.length}`);

const words = rows.map((line, i) => {
  const [roll, word] = line.split('\t');
  if (!/^[1-6]{5}$/.test(roll ?? '')) throw new Error(`Row ${i}: bad dice roll ${roll}`);
  if (!/^[a-z][a-z-]*[a-z]$/.test(word ?? '')) throw new Error(`Row ${i}: bad word ${word}`);
  return word;
});
if (new Set(words).size !== words.length) throw new Error('Duplicate words in list');

const body = `/**
 * GENERATED FILE — do not edit by hand.
 * Source: data/eff_large_wordlist.txt (SHA-256 ${digest})
 * Regenerate with: node scripts/generate-wordlist.mjs
 *
 * EFF long wordlist, CC-BY 3.0 US, Electronic Frontier Foundation.
 * Index i corresponds to dice roll ${rows[0].split('\t')[0]}..${rows.at(-1).split('\t')[0]} in order.
 */

export const EFF_LONG_WORDLIST_SHA256 =
  '${digest}';

export const EFF_LONG_WORDLIST: readonly string[] = Object.freeze([
${words.map((w) => `  '${w}',`).join('\n')}
]);
`;

writeFileSync(`${root}src/lib/crypto/wordlist.generated.ts`, body);
console.log(`Wrote src/lib/crypto/wordlist.generated.ts (${words.length} words, sha256 ${digest})`);
