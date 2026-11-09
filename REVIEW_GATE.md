# The cryptographic review gate

Build specification §10:

> **Do not proceed past step 2 without an external review of the cryptographic
> implementation.** V1's crypto is deliberately small and standard — this review
> should be days, not weeks — but everything downstream depends on it being
> right, and cryptographic bugs are silent: the vault will encrypt, decrypt, and
> pass every test while being readable by someone who knows what to look for.

`npm run build` refuses to produce a production bundle until a review is
recorded. A sentence in a document does not stop a deploy.

## What is not blocked

Development continues normally:

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run ci
```

```bash
npm run db:test
```

## What the reviewer should look at

The whole of `src/lib/crypto` — about 900 lines, no novel constructions. In
rough order of consequence:

1. **`kdf.ts`** — does the passphrase reach anything other than Argon2id? Is the
   normalisation form stable? Is the derived key non-extractable from the moment
   it exists?
2. **`envelope.ts`** and **`aead.ts`** — is the AAD binding actually sufficient
   to prevent a ciphertext being moved between slots? Is there any path to IV
   reuse under one key? Is the sentinel an oracle for anything?
3. **`vault.ts`** — does the duress path leak which record matched in a way the
   duress design cannot tolerate? Is `VaultIntegrityError` distinguishable from
   `WrongPassphraseError` in a way that helps an attacker?
4. **`diceware.ts`** and **`random.ts`** — is the sampling uniform? Does
   `checkTranscription` leak the correct word for a wrong position?
5. **`src/lib/vault-session.ts`** — can the master key reach storage, a React
   tree, an error payload, or survive a lock?
6. **`src/lib/custody/entropy.ts`** — is the coalition-residual model the right
   one, and are the thresholds defensible?

`SECURITY.md` has the threat model, the key hierarchy and a list of known gaps.
Start there.

Worth reviewing alongside, though outside the strict cryptographic core:

- `supabase/migrations/` — the RLS posture and the service-role boundary.
- `src/lib/security/csp.ts` — the policy that keeps a passphrase from having
  anywhere to go.
- `scripts/check-crypto-leaks.mjs` — what the CI grep does and does not catch.

## Recording the result

Set this in the deployment environment:

```bash
CRYPTO_REVIEW_ATTESTATION="<reviewer or firm>|<YYYY-MM-DD>|<commit sha reviewed>"
```

For example:

```bash
CRYPTO_REVIEW_ATTESTATION="Example Security Ltd|2026-11-20|5079b46"
```

The build prints the attestation and warns if it is over a year old. The commit
sha records which tree was reviewed, so a later diff against it shows exactly
what has changed since.

## When to re-review

- Any change under `src/lib/crypto`.
- Any change to the Argon2id profile, the envelope version, or an AAD label.
- Before build-order step 5 (the media pipeline), which introduces chunked
  encryption and is the first place a new IV-handling bug could appear.
- Before any V2 work: Shamir sharding and trustee keypairs are a materially
  larger cryptographic surface and the spec requires a separate external
  cryptographic review for them regardless.

## What CI does with this

CI does not deploy, so it checks the gate rather than submitting to it:

- With no attestation configured, it asserts the gate **refuses** — both for an
  empty value and for a malformed one — and then runs `next build` directly to
  confirm the application still compiles.
- With `CRYPTO_REVIEW_ATTESTATION` set as a repository secret, it runs the real
  `npm run build`, gate included, exactly as a deploy would.

The alternative — letting the `build` job fail while no review exists — would
leave a permanently red check, and a genuine compilation regression would then
look identical to the gate working. Nobody would notice either.

The gate that actually stops a deploy is the one inside `npm run build`, which
Netlify runs. Nothing in CI bypasses it, and nothing in CI produces an artifact
that is deployed.

## Bypassing this gate

There is no flag. Setting the attestation to something untrue is possible and is
a decision someone makes with their name attached, which is the point.
