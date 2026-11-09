# Security

This document is the threat model, the key hierarchy, and an honest account of
what this system does and does not protect against. Spec §11 requires it to
exist; it is written to be useful to the external reviewer the build gate is
waiting on, not to reassure anyone.

**Reporting a vulnerability:** `security@` the project domain. Please do not open
a public issue for anything affecting key handling.

---

## 1. The property we are claiming

The server cannot read user vault contents. There is no decryption path on the
server — not for support, not for law enforcement, not for an administrator with
full database access.

That claim rests on one thing: **the vault passphrase never leaves the browser**,
in any form. Not the phrase, not a hash of it, not a verifier, not a strength
score computed server-side. If that is ever false, everything below is theatre.

What the server does hold, and what an attacker with a full dump therefore gets:

| Stored | What it is |
|---|---|
| `kdf_salt` | 128-bit random salt. Public by design. |
| `wrapped_vmk` | The 256-bit vault master key, sealed under Argon2id(passphrase). |
| `sentinel` | A known plaintext sealed under the same key. Used to verify a passphrase client-side. |
| `wrapped_dek`, `content` | Per-item key and payload, AES-256-GCM. |
| `points.detail` | Custody labels, custodian names, addresses — encrypted. |
| Item names, byte counts, timestamps | **Plaintext.** See §6. |
| Custody point type, full-copy-or-part, verification dates | **Plaintext.** See §6. |

The wrapped master key is offline-attackable by anyone holding that row. What
defends it is the passphrase entropy (≥155 bits), not the secrecy of the blob.
The Argon2id cost is a second line, and an honest statement of its value is in
§3.

---

## 2. Threat model

Per spec §5, every one of these is assumed to happen:

| Adversary | Outcome |
|---|---|
| Full database exfiltration | Ciphertext, salts, IVs, item names, custody shape. No plaintext contents. |
| Full object-storage exfiltration | Ciphertext only; media is encrypted before upload. |
| A malicious engineer with production access | Same as above. Cannot re-wrap a key (§4), cannot read vault or custody rows at all (§5), cannot alter the audit log (§7). |
| A malicious custodian | Holds one copy or one part of the passphrase. Cannot reach the account, so cannot reach the ciphertext. |
| A compromised Google/Apple account | Session access: sees that a vault exists, item names, custody shape. Decrypts nothing. Can start a death claim — which is why passkeys are mandatory and the waiting period exists. |
| Physical coercion of the owner | Duress passphrase (crypto and schema shipped; workflow is build-order step 7). |
| A hostile network position | TLS, HSTS preload, strict CSP with no off-origin `connect-src`. |

### Explicitly out of scope

- **A compromised user device.** Malware in the browser that runs on the unlock
  page sees the passphrase as it is typed. No web application can prevent this.
  The mitigations are a short vault-lock timeout, locking on tab hide, and a
  CSP that denies every off-origin script and connection. Not a solution.
- **A malicious first-party deploy.** If our own build pipeline ships a modified
  bundle that exfiltrates the passphrase, every claim here fails. This is the
  structural weakness of browser-delivered cryptography and it should be stated
  plainly rather than glossed. Subresource Integrity does not help, because the
  attacker controls the hashes. Mitigation worth building: reproducible builds
  and a published bundle digest users (or a watchdog) can verify.
- **Rubber-hose attacks on a custodian**, beyond what a split arrangement gives.

---

## 3. Key hierarchy

```
passphrase (12+ EFF diceware words, ≥155 bits, never transmitted)
  │
  └─ Argon2id(salt, m=47104 KiB, t=2, p=1, 32 bytes)  →  KEK
       │                                    [profile 1, versioned per key record]
       ├─ AES-256-GCM  →  sentinel          [proves the passphrase, client-side]
       │
       └─ AES-256-GCM  →  wrapped VMK
            │
            └─ VMK (non-extractable CryptoKey, browser memory only)
                 │
                 └─ AES-256-GCM  →  wrapped DEK   [one per item]
                      │
                      └─ DEK  →  AES-256-GCM  →  item payload
```

Every seal/open call takes domain-separated additional authenticated data
binding the blob to its slot — `vault=<id>|item=<id>|chunk=<n>` and similar. A
ciphertext moved between items, vaults, key records or chunk positions fails its
GCM tag rather than decrypting to the wrong thing. This is tested in both
directions (`tests/crypto/envelope.test.ts`).

### On the Argon2id parameters

Profile 1 is m=46 MiB, t=2, p=1, which exceeds every configuration listed in the
OWASP Password Storage Cheat Sheet's Argon2id guidance. Measured ≈570 ms in
Chromium on the build machine; budget 1.5–4 s on a mid-range phone.

Be clear about what that buys. Against a correctly generated 12-word passphrase,
the KDF is irrelevant — 2^155 is not searchable at any cost factor. The KDF
matters for the cases the design does not intend but reality produces: a user
who transcribes only part of the phrase and reconstructs the rest, a future mode
with a weaker secret, or a split arrangement where a coalition of custodians is
searching a reduced space (§8). In that last case the cost factor is doing real
work, which is why it is set above the minimum rather than at it.

Profiles are versioned and the id is stored per key record, so raising the cost
later does not orphan existing vaults.

### No novel cryptography

Argon2id (RFC 9106) via `@noble/hashes`, verified against the RFC test vector in
CI. AES-256-GCM via the platform WebCrypto. CSPRNG via
`crypto.getRandomValues`, with rejection sampling for uniform word selection.
Nothing else. There is no custom construction anywhere in `src/lib/crypto`, and
`scripts/check-crypto-leaks.mjs` fails the build if AES-GCM is used outside the
single module that generates IVs.

---

## 4. There is no password reset

This is enforced in three places, because one is not enough:

1. **Mathematically.** The master key is sealed under a key derived from the
   passphrase. Re-wrapping it requires unwrapping it first, which requires the
   passphrase. Nothing in this system has it.
2. **In the database.** `vault.vault_keys` has no `UPDATE` policy, and a trigger
   refuses any change to its cryptographic columns. The trigger binds the table
   owner and `service_role`, which RLS does not.
3. **In the UI.** The consequence is stated at creation time in terms that do
   not soften, and the user must confirm a written copy exists before the vault
   is created.

A support engineer who wants to "reset a user's vault" can delete it. They
cannot open it.

---

## 5. Database authorisation

- RLS enabled on **every** table in `account`, `vault`, `custody`, `legal`.
  Asserted structurally in `supabase/tests/01_rls_default_deny.sql`, so a new
  table with RLS forgotten fails CI automatically.
- `PUBLIC` holds no privileges on any application schema.
- `anon` reaches only the published legal library, and is denied `vault` and
  `custody` at the **schema** level — it cannot name the tables.
- Every policy is proven in the negative direction: a second user cannot read or
  write the first user's rows (`02_rls_cross_tenant.sql`).
- Every `SECURITY DEFINER` function pins an empty `search_path`. An unpinned one
  is a privilege-escalation hole, so this is asserted across all four schemas
  rather than checked by eye.

### The service role is not granted the vault

`service_role` carries `BYPASSRLS`, so no policy restrains it. What restrains it
is that the grant was never made: migration `0006` grants it `account` and
`legal`, and explicitly revokes `vault` and `custody`. An exfiltrated
service-role key therefore does not reach the ciphertext, let alone the
plaintext.

If a future feature appears to need service-role access to `vault` or `custody`,
treat that as a design smell worth arguing about before adding the grant. It
almost certainly means work is being done on the server that belongs in the
client, where the keys are.

---

## 6. What is deliberately in plaintext

Three disclosures are made knowingly. Each is recorded here rather than left for
a reviewer to discover.

1. **Item names, byte counts and timestamps.** Spec §5.2 requires a locked
   session to show these, and an executor needs to see that a vault exists
   before they have the passphrase. The UI warns against putting anything
   sensitive in a name. *Leak:* an attacker with the database learns that a user
   has an item called "Ledger recovery", and the size and edit history of
   everything.

2. **Custody point type, full-copy-or-part, and verification dates.** The
   dashboard must be able to flag a stale or dangerous arrangement *while
   locked*, because the users most at risk are the ones who set this up years
   ago and have not opened it since. Labels, custodian identities and locations
   are encrypted (spec §4.1). *Leak:* an attacker learns that a user keeps three
   copies with an institution, a person and at a location, and when each was
   last checked. Not where or who.

3. **Passphrase word count.** Stored on the custody plan so the entropy
   arithmetic in §8 can run while locked. *Leak:* narrows the search space from
   2^155 to 2^155. Negligible, but stated.

A fourth is a known limitation rather than a decision: **the `kind` column on
`vault_keys` distinguishes a duress record from a primary one.** The database
therefore knows a duress passphrase exists. Moving that behind the master key is
a worthwhile hardening step and is not done.

---

## 7. Audit log

Append-only, enforced by a trigger that binds every role including
`service_role` — RLS alone would not, since that is the role an inside attacker
would use.

Audit metadata is restricted at the database level: a row whose `metadata`
contains a key named `passphrase`, `content`, `custodian`, `location`, `label`,
`seed` and similar is rejected outright. Spec §11 forbids plaintext user content
in logs, and that rule erodes one well-meaning debug field at a time unless
something refuses.

---

## 8. Custody splitting

When a user splits the passphrase across custodians, two different residual
entropies matter and they are not the same number:

- **One treacherous holder** must still guess everything they do not hold. Worst
  case over all holders: `(n − largest part) × log2(7776)`.
- **A coalition of every holder but one** must still guess the one part they
  lack. Worst case: `smallest part × log2(7776)`.

The second is always smaller and is the one the app governs by. "All but one" is
not far-fetched — it is a house fire plus a cooperative relative, or a burglar
who visits two of three locations.

| Arrangement | Coalition residual | Verdict |
|---|---|---|
| 12 words / 2 parts | 77.5 bits | acceptable |
| 12 words / 3 parts | 51.7 bits | marginal, allowed with warning |
| 12 words / 4 parts | 38.8 bits | **refused** |
| 15 words / 3 parts | 64.6 bits | acceptable |
| 24 words / 3 parts | 103.4 bits | strong |

Thresholds: refuse below 40 bits, warn below 64, comfortable at 80+. The UI
shows the arithmetic rather than asserting the conclusion (spec §4.2).

---

## 9. Browser hardening

- **CSP** built per request with a nonce, `default-src 'none'`, `strict-dynamic`
  for scripts, and `connect-src` limited to this origin and the Supabase project.
  A script that somehow got onto the page has nowhere to send anything.
  `'unsafe-eval'` is allowed in development only (React's dev build needs it)
  and `tests/security/csp.test.ts` asserts it is absent otherwise.
- **No third-party scripts anywhere.** No analytics, no error reporter, no font
  CDN, no PDF library. The Executor Letter and the transcription sheet print
  through the browser's own pipeline for exactly this reason.
- `style-src` retains `'unsafe-inline'` because Next and React inject runtime
  styles with no nonce hook. With `script-src` locked down there is no
  attacker-controlled script to author a style, and the exfiltration channels
  are closed by `connect-src`, `img-src` and `font-src`.
- HSTS with preload, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  a `Permissions-Policy` that denies camera, microphone and geolocation until the
  media pipeline needs them.

### Session handling

- The vault master key is a **non-extractable** `CryptoKey` in a module-scoped
  variable. Not in React state, not in a context value, not in `localStorage`,
  `sessionStorage`, IndexedDB or a cookie. Dropping the reference is what removes
  it — the bytes live inside the browser's crypto implementation and were never
  in a JavaScript buffer.
- Separate, shorter vault-lock timeout (5 min default) than the auth session
  (15 min), plus immediate lock on tab hide — backgrounding is where a phone
  gets handed to someone else.
- Zeroization of intermediate buffers is best-effort and is described as such in
  the code. JavaScript gives no guarantee that a copy has not survived in a GC'd
  intermediate, a `String`, or swap. Keeping keys as non-extractable
  `CryptoKey`s is the stronger protection; zeroizing shortens the window.

---

## 10. Library audit history

| Library | Version | Role | Status |
|---|---|---|---|
| `@noble/hashes` | 2.4.0 | Argon2id | Verified against the RFC 9106 test vector in CI. Audited upstream; confirm the current audit report at review time. |
| WebCrypto (platform) | — | AES-256-GCM, CSPRNG | Browser-provided. |
| `@simplewebauthn/server` / `browser` | 14.1.0 / 14.0.0 | Passkeys | Not security-critical to vault confidentiality — passkeys guard the account layer only. |
| `@supabase/ssr`, `supabase-js` | 0.12.7, 2.119.0 | Transport, auth | Never sees plaintext. |
| EFF long wordlist | pinned SHA-256 | Diceware | Digest verified in CI against two independent redistributors; see `data/WORDLIST_PROVENANCE.md` for the open upstream-verification item. |

Dependencies are pinned exactly (no `^`) and the lockfile is enforced in CI.
This is a supply-chain target: a wordlist substituted for 7776 words drawn from
a 200-word vocabulary would make every passphrase trivially guessable while
every test still passed and the UI still said "155 bits". `scripts/verify-wordlist.mjs`
checks the digest *and* a vocabulary-richness floor for that reason.

---

## 11. CI controls

| Check | What it prevents |
|---|---|
| `scripts/check-crypto-leaks.mjs` | `console.log`, `fetch`, telemetry or storage in the crypto module; a secret-shaped identifier reaching a sink; the service-role key in client code; a secret behind `NEXT_PUBLIC_`; the test KDF profile outside tests; weakened Argon2id parameters; AES-GCM used outside the one module that generates IVs. |
| `scripts/verify-wordlist.mjs` | A substituted or degenerate wordlist. |
| `scripts/check-review-gate.mjs` | A production build before the cryptographic review is recorded. |
| `npm test` | 212 assertions including the adversarial crypto cases. |
| `scripts/test-db.sh` | 80 pgTAP assertions; every RLS policy with its negative case. |

A finding from the leak check is a potential disclosure of key material. Do not
suppress one without understanding it.

---

## 12. Known gaps

Listed because a security document that only lists strengths is marketing.

1. **No external cryptographic review yet.** Production builds are blocked until
   one is recorded. See `REVIEW_GATE.md`.
2. **Duress is visible to the database** (§6).
3. **No reproducible builds / published bundle digest**, so a malicious
   first-party deploy is undetectable by users (§2).
4. **Rate limiting on unlock attempts is client-side only.** Against an attacker
   with the database it is worth nothing, and that is the attacker who matters;
   it exists to slow someone at an unlocked laptop. Server-side attempt limiting
   on the key-record fetch is worth adding.
5. **Encrypted backups with keys held outside Supabase** (spec §5.5) are not
   implemented. The schema and the application do not control this; it is a
   deployment task and it is not done.
6. **Storage policies and signed-URL lifetimes** (spec §5.5) are not implemented,
   because the media pipeline is build-order step 5 and has not been built.
7. **No Trusted Types.** Would further harden against DOM XSS; deferred as React
   19 compatibility was not verified.
