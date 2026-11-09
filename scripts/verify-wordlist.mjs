#!/usr/bin/env node
/**
 * CI gate: the vendored EFF wordlist must match its pinned digest, and the
 * generated TypeScript must still match the vendored list.
 *
 * A silently substituted wordlist is one of the nastiest attacks on this product:
 * swap in a list of 7776 words drawn from a 200-word vocabulary and every
 * passphrase generated afterwards is trivially guessable, while every test still
 * passes and the UI still says "155 bits".
 *
 * With --against-upstream, also fetches the canonical EFF copy and compares.
 * Requires unrestricted egress to eff.org; see data/WORDLIST_PROVENANCE.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PINNED_SHA256 =
  'addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e';
const UPSTREAM_URL = 'https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt';

const root = fileURLToPath(new URL('..', import.meta.url));
const fail = (msg) => {
  console.error(`✗ wordlist: ${msg}`);
  process.exitCode = 1;
};

const source = readFileSync(`${root}data/eff_large_wordlist.txt`, 'utf8');
const digest = createHash('sha256').update(source).digest('hex');

if (digest !== PINNED_SHA256) {
  fail(`digest mismatch\n  pinned:   ${PINNED_SHA256}\n  on disk:  ${digest}`);
} else {
  console.log(`✓ wordlist digest matches pin (${digest.slice(0, 16)}…)`);
}

const words = source
  .replace(/\r/g, '')
  .trim()
  .split('\n')
  .map((l) => l.split('\t')[1]);

if (words.length !== 7776) fail(`expected 7776 words, found ${words.length}`);
if (new Set(words).size !== words.length) fail('wordlist contains duplicates');

// Sanity floor on vocabulary richness — catches a padded or repeated-stem list
// even if someone also updates the pin.
const distinctPrefixes = new Set(words.map((w) => w.slice(0, 3))).size;
if (distinctPrefixes < 1000) {
  fail(`only ${distinctPrefixes} distinct 3-letter prefixes; list looks degenerate`);
} else {
  console.log(`✓ wordlist vocabulary looks healthy (${distinctPrefixes} distinct prefixes)`);
}

const generated = readFileSync(`${root}src/lib/crypto/wordlist.generated.ts`, 'utf8');
if (!generated.includes(`'${PINNED_SHA256}'`)) {
  fail('wordlist.generated.ts was not generated from the pinned source — run scripts/generate-wordlist.mjs');
}
const generatedWords = [...generated.matchAll(/^ {2}'([a-z-]+)',$/gm)].map((m) => m[1]);
if (generatedWords.length !== words.length || generatedWords.some((w, i) => w !== words[i])) {
  fail('wordlist.generated.ts does not match data/eff_large_wordlist.txt — run scripts/generate-wordlist.mjs');
} else {
  console.log('✓ generated wordlist matches vendored source');
}

if (process.argv.includes('--against-upstream')) {
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) fail(`upstream fetch failed: HTTP ${res.status}`);
  else {
    const upstream = await res.text();
    const upstreamDigest = createHash('sha256').update(upstream).digest('hex');
    const normalised = createHash('sha256')
      .update(upstream.replace(/\r/g, '').trim() + '\n')
      .digest('hex');
    if (upstreamDigest === PINNED_SHA256 || normalised === PINNED_SHA256) {
      console.log(`✓ matches canonical EFF copy at ${UPSTREAM_URL}`);
      console.log('  Record this in data/WORDLIST_PROVENANCE.md under "Open verification item".');
    } else {
      fail(`upstream digest ${upstreamDigest} does not match pin ${PINNED_SHA256}`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
