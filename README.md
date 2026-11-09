# Crypto Inheritance Vault

A zero-knowledge vault so that a person's cryptocurrency does not die with them.

Crypto is the only asset class where death means permanent, total, unrecoverable
loss. A house does not vanish because nobody knew about it — the county recorder
knows. An unclaimed bank account escheats to the state and waits. Four bitcoin
behind a forgotten passphrase is gone forever, and no court, lawyer or exchange
can retrieve it. That irreversibility is the entire product.

`SPEC.md` is the source of truth for scope and architecture. Read it before
changing anything here.

---

## The one thing to understand first

**The passphrase never leaves the browser.** Not the phrase, not a hash of it,
not a verifier, not a strength score computed server-side. There is no
server-side decryption path, for support, for law enforcement, or for us.

The consequence is not negotiable: **there is no password reset, and there
cannot be one.** This is enforced mathematically (the master key is sealed under
a key derived from the passphrase), in the database (key records are immutable by
trigger, binding even the service role), and in the UI.

Inheritance of the passphrase happens in the physical world:

```
CHANNEL 1 — THE APP                    CHANNEL 2 — THE PHYSICAL WORLD
  Encrypted vault (ciphertext)           The passphrase itself
  Account access control                 Safe deposit box, attorney's safe,
  Death verification                       home safe, a trusted person,
  Audit log                                a steel plate, or split across
  Custody plan metadata                    several of those
```

Neither channel alone opens anything.

---

## Status

Built against the specification's build order (§10):

| # | Step | State |
|---|---|---|
| 1 | Foundation — Next.js, Supabase schema with RLS and policy tests, OAuth, mandatory passkeys | **Done** |
| 2 | Crypto core — Argon2id, envelope encryption, diceware, sentinel unlock | **Done** |
| 3 | Vault CRUD — client-side encrypted text and document storage | **Done** |
| 4 | Custody planning — custody points, redundancy/split with entropy maths, Executor Letter | **Done** |
| 5 | Media pipeline — chunked client-side encrypted video/audio | Not started |
| 6 | Custody verification cycle — custodian attestation, emailed health report | Partly: in-app checks, at-risk flagging and the report model exist; email and custodian attestation do not |
| 7 | Death claim workflow — waiting period, contact cascade, owner veto, staged disclosure | Not started. Duress crypto and the disclosure-stage column exist so step 7 needs no migration |
| 8 | Legal content layer — state checklists, attorney-reviewed and versioned | Schema and UI done; **ships with zero rows by design** (see below) |
| 9 | Education module and probate export | Not started |

> **Production builds are blocked** until an external review of the
> cryptographic implementation is recorded, per spec §10. Development, tests and
> CI are unaffected. See `REVIEW_GATE.md`.

### Why the legal content library is empty

Spec §2.3 forbids generating legal content from model knowledge. The tables, the
constraints and the UI exist; there are no rows. A published row is impossible
without a named reviewer, a review date and a citation — the check constraint
enforces it. Every state page therefore renders an honest empty state rather
than a plausible-sounding answer to "what makes a will valid in Nevada".
See `docs/LEGAL_CONTENT.md`.

---

## Getting started

```bash
npm ci
```

```bash
cp .env.example .env.local
```

Fill in your Supabase project URL and anon key, then:

```bash
npm run dev
```

### Checks

```bash
npm run ci
```

That runs the wordlist digest check, the crypto leak grep, the type check and
218 unit assertions. The database suite is separate because it needs PostgreSQL:

```bash
npm run db:test
```

It uses the Supabase CLI when Docker is available, and otherwise falls back to a
plain PostgreSQL 16 instance plus `scripts/local-auth-harness.sql` — no Docker
required, and every policy is still exercised. 80 pgTAP assertions.

---

## Layout

```
src/lib/crypto/      The cryptographic core. ~900 lines, no novel constructions.
                     Everything downstream depends on this being right.
src/lib/custody/     Custody planning: entropy maths, plan review, Executor
                     Letter generation, the passphrase-in-content guard.
src/lib/security/    The Content-Security-Policy, as a tested pure function.
src/lib/legal/       Legal-content staleness rules.
src/lib/server/      Service-role client and WebAuthn helpers. Server only.
src/app/             Routes. Every page that touches decrypted content sits
                     behind UnlockGate.
supabase/migrations/ Four schemas, RLS on every table, default deny.
supabase/tests/      pgTAP. Every policy has its negative case proven.
scripts/             CI gates: leak grep, wordlist verification, review gate.
data/                The EFF long wordlist and its provenance record.
```

---

## Design decisions worth knowing before you change something

**Argon2id runs for ~0.6 s in a browser and that is intentional.** Profile 1 is
m=46 MiB, t=2, p=1, above every OWASP minimum. Profiles are versioned per key
record so the cost can be raised without orphaning existing vaults.

**Every ciphertext is bound to its slot.** Seal and open take domain-separated
AAD naming the vault, the item and the chunk. A blob moved between items or
vaults fails its GCM tag instead of decrypting to the wrong thing.

**The service role cannot read the vault.** It is granted `account` and `legal`
and explicitly revoked on `vault` and `custody`, so an exfiltrated server key
does not reach the ciphertext. If a feature seems to need that grant, it is
probably doing work on the server that belongs in the client.

**The custody split refuses dangerous configurations rather than warning.** The
governing number is the entropy a coalition of every holder but one would still
have to guess — the smallest part. 12 words in 4 parts leaves 38.8 bits and is
blocked; 12 in 3 leaves 51.7 and is allowed with a warning; 15 in 3 leaves 64.6
and is fine. The UI shows the arithmetic rather than asserting the conclusion.

**The transcription sheet prints blank.** Printing the passphrase would send it
through a spooler and onto a disk. The user writes it by hand, and then types it
back before the vault is created, so the paper artefact provably exists first.

**The Executor Letter is never stored.** It is generated in the browser from the
decrypted custody plan and printed. The database keeps only the date it was last
generated, so the app can warn when the plan has drifted ahead of the paper.

**No third-party scripts anywhere.** No analytics, no error reporter, no font
CDN, no PDF library — which is why both printable artefacts go through the
browser's own print pipeline and `globals.css` is their actual output format.

**Nothing may store a passphrase inside the vault it unlocks.** Any text with
eight or more consecutive wordlist words is refused, with the reason given.
Measured against realistic custody prose, which tops out at two.

---

## Security

`SECURITY.md` has the threat model, the key hierarchy, the three deliberate
plaintext disclosures and a list of known gaps. It is written for the external
reviewer, not for reassurance.

Report vulnerabilities privately rather than in a public issue.

---

## Not what this is

| Not | Why |
|---|---|
| A will generator | Unauthorised practice of law. We store documents you obtain elsewhere. |
| A custodian | We never hold, move, or can spend cryptocurrency. |
| A hint system | No riddles, no partial phrases. Cryptography, not obscurity. |
| Able to read your content | No server-side decryption path exists. |
| A probate workaround | Released assets still belong to the estate. |
| A passphrase holder | We never see, store, transmit or escrow it. |

If a feature request requires breaking one of these, stop and flag it rather
than implementing it.
