#!/usr/bin/env node
/**
 * Build-order step 2 gate.
 *
 * Spec §10: "Do not proceed past step 2 without an external review of the
 * cryptographic implementation."
 *
 * A sentence in a document does not stop a deploy. This does. `npm run build`
 * refuses to produce a production bundle until a review attestation is present,
 * so shipping to real users requires a deliberate, recorded act by a human.
 *
 * It does not block development: `npm run dev`, `npm test` and `npm run ci` all
 * work untouched. Only the production build is gated.
 *
 * See REVIEW_GATE.md for how to record an attestation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const attestation = (process.env.CRYPTO_REVIEW_ATTESTATION ?? '').trim();

if (attestation) {
  // Shape: "<reviewer or firm>|<ISO date>|<commit sha of the reviewed tree>"
  const parts = attestation.split('|').map((p) => p.trim());
  const [reviewer, date, commit] = parts;
  const problems = [];
  if (parts.length !== 3) problems.push('expected three |-separated fields');
  if (!reviewer) problems.push('reviewer is empty');
  if (!date || Number.isNaN(Date.parse(date))) problems.push('review date is not a parseable date');
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) problems.push('commit is not a hex sha');

  if (problems.length > 0) {
    console.error('✗ CRYPTO_REVIEW_ATTESTATION is malformed:');
    for (const p of problems) console.error(`    - ${p}`);
    console.error('\n  Expected: "<reviewer>|<YYYY-MM-DD>|<commit-sha>"');
    console.error('  See REVIEW_GATE.md');
    process.exit(1);
  }

  const reviewedAt = new Date(date);
  const ageDays = Math.floor((Date.now() - reviewedAt.getTime()) / 86_400_000);
  console.log(`✓ cryptographic review on record: ${reviewer}, ${date} (${ageDays} days ago), commit ${commit}`);
  if (ageDays > 365) {
    console.warn(
      `  Warning: the review is ${ageDays} days old. The crypto core should be re-reviewed after a year ` +
        'or after any change to src/lib/crypto.',
    );
  }
  process.exit(0);
}

let gateText = '';
try {
  gateText = readFileSync(`${ROOT}REVIEW_GATE.md`, 'utf8');
} catch {
  /* the message below stands on its own */
}

console.error(`
┌──────────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION BUILD BLOCKED — cryptographic review not on record               │
└──────────────────────────────────────────────────────────────────────────────┘

The build specification (§10) says, in terms:

    "Do not proceed past step 2 without an external review of the cryptographic
     implementation. [...] cryptographic bugs are silent: the vault will encrypt,
     decrypt, and pass every test while being readable by someone who knows what
     to look for."

Every test in this repository passes. That is exactly the condition the spec
warns about, so passing tests is not the thing being waited on.

What to do:
  1. Have src/lib/crypto reviewed externally. SECURITY.md documents the key
     hierarchy and threat model; the review scope is in REVIEW_GATE.md.
  2. Record the result by setting, in the deployment environment:

       CRYPTO_REVIEW_ATTESTATION="<reviewer>|<YYYY-MM-DD>|<commit-sha>"

Development is not blocked. These all work now:
     npm run dev        npm test        npm run ci        npm run db:test
${gateText ? '\nSee REVIEW_GATE.md in the repository root.\n' : ''}`);
process.exit(1);
