# Architecture notes

Decisions that are not obvious from the code, with the reasoning that produced
them. Where this disagrees with `SPEC.md`, the spec wins.

---

## Why the custody split is governed by the coalition residual

Spec §4.2 says a 12-word phrase split into three 4-word parts "still leaves
roughly 50 bits unknown to any single holder". Taken literally that is wrong — a
single holder with 4 words is missing 8 words, which is 103 bits. The number
that comes out at ~51.7 bits is the entropy a coalition of *all but one* holder
still faces, which equals the smallest part.

The spec's figure is the right one to design around even though its label is
imprecise, because the coalition case is both strictly weaker and entirely
realistic: a house fire plus one cooperative relative, or a burglar who visits
two of three locations. The implementation computes both figures, shows both,
and governs by the coalition one.

Thresholds (`src/lib/custody/entropy.ts`): refuse below 40 bits, warn below 64,
comfortable at 80+. The 64-bit line is what makes the spec's "recommend 15+
words whenever split mode is selected" fall out of the arithmetic rather than
being asserted — 15 words in 3 parts is 5 words per part, which is 64.6 bits.

## Why sampling is with replacement

A diceware phrase sampled *without* replacement has slightly less entropy than
`n · log2(7776)` and the exact figure is awkward to state. Sampling each word
independently makes the number exact and the UI honest. The cost is that a
phrase can contain a repeated word, which looks odd on paper and costs the user
nothing.

## Why the KDF profile is stored per key record

Raising the Argon2id cost later must not orphan existing vaults. The profile id
lives on the key record, `resolveKdfProfile` looks it up, and a vault created
under profile 1 keeps opening after profile 2 exists. Re-wrapping under a higher
profile on a successful unlock is possible and is not implemented.

## Why there are two timeouts

The auth session (15 min) and the vault lock (5 min) are separate, and the vault
lock is the shorter one. Walking away from a desk should drop the master key
before it drops the session — relocking the vault costs an Argon2id derivation,
whereas re-authenticating costs an OAuth round trip, and the cheaper one should
not be the one that protects the keys.

The vault also locks immediately on tab hide. On a phone, backgrounding the tab
is the moment the device gets handed to someone else.

## Why the master key is a CryptoKey and not bytes

A non-extractable `CryptoKey` cannot be read back by JavaScript. The bytes live
inside the browser's crypto implementation, so they do not appear in a heap
snapshot, an error payload, or a `JSON.stringify` of some state object. Dropping
the reference removes the key, which is a stronger guarantee than zeroizing an
array would be — JavaScript cannot promise a buffer has not been copied.

The places where raw bytes unavoidably exist (between generating a key and
wrapping it) are zeroized in a `finally` block, and the code says plainly that
this is best-effort.

## Why item names are plaintext but custody labels are not

Spec §5.2 requires a locked session to show item names, and an executor needs to
see that a vault exists before they have the passphrase. Spec §4.1 separately
requires custody locations and custodian identities to live inside the encrypted
vault.

Those are different requirements and the schema honours both. Items have a
plaintext `name` with a UI warning. Custody points have an encrypted `detail`
blob and a plaintext type, holding and verification date — enough to warn about
a stale or correlated arrangement on the dashboard without an unlock, which is
the whole point of §4.3.

## Why verification does not invalidate the Executor Letter

Confirming an envelope is still in the bank updates `last_verified_at`, which is
a line the letter prints. Triggering "reprint your letter" on every routine check
would show the warning every time the user did the right thing, and they would
learn to ignore it — including the one time it mattered. The drift trigger fires
only on changes to what the letter *tells the executor to do*: type, holding,
part number, display order and the encrypted detail.

## Why `clock_timestamp()` and not `now()`

`now()` is the transaction start time and is identical for every statement in a
transaction. A plan edit and a letter generation in the same transaction would
tie, and the drift comparison would call a stale letter current.
`clock_timestamp()` advances within a transaction, so the ordering is real.

## Why the audit log rejects certain metadata keys

Spec §11 forbids plaintext user content in logs. That rule erodes one
well-meaning debug field at a time, so the database refuses a `metadata` object
containing a key named `passphrase`, `content`, `custodian`, `location`, `label`,
`seed` and similar. A developer who tries fails loudly in development rather
than silently logging a secret in production.

## Why the service role has no vault access

`service_role` carries `BYPASSRLS`, so no policy restrains it — it is exactly
the credential a malicious insider or an attacker with server access would use.
The only thing that restrains it is the absence of a grant, so migration 0006
grants it `account` and `legal` and explicitly revokes `vault` and `custody`.

Nothing on the server needs to read vault ciphertext: all vault I/O happens in
the browser under the user's own JWT, through RLS. A future feature that appears
to need the grant is almost certainly doing client work on the server.

## Why there is no PDF library

Spec §11 forbids a third-party script on any page that touches decrypted
content. The Executor Letter page shows custodian names and addresses in the
clear, so it qualifies. The browser's print pipeline produces the paper, and the
`@media print` rules in `globals.css` are the real output format — which is also
why they are commented as such rather than treated as styling.

## Why the transcription sheet prints blank

Printing the passphrase would send it through a print spooler, onto a disk, and
possibly into a shared printer's job history. Handwriting also produces the one
artefact a compromised machine cannot have captured. The sheet's job is to give
the handwriting structure: numbered slots so a word cannot land in the wrong
position, and a custody table.

## Why a separate `WrongPassphraseError` and `VaultIntegrityError`

If the sentinel verifies but the wrapped master key does not open, the
passphrase is right and the stored blob is wrong — corruption, a bad restore, or
tampering. Telling that user "wrong passphrase" would send them hunting for a
transcription error that does not exist, and might push them into re-creating
the vault, which destroys the recoverable state. The remedies are completely
different, so the errors are.

## Why the local database harness exists

`supabase test db` needs Docker. CI runs `scripts/test-db.sh`, which prefers the
Supabase CLI when it is available and otherwise applies the migrations to a
plain PostgreSQL 16 with `scripts/local-auth-harness.sql` standing in for
`auth.users`, `auth.uid()` and the three roles.

The stand-in is kept deliberately small and explicit: if Supabase changes any of
those, the suite starts disagreeing with production, and a small file makes that
obvious rather than mysterious.

## What build-order step 7 will need, and what is already there

The death-claim workflow is not implemented. Two pieces of it exist already
because retrofitting them would have meant a migration and another crypto
review:

- **Duress key records.** `vault.vault_keys.kind` distinguishes `primary` from
  `duress`, `unlockVault` reports which record opened, and `buildDuressKeyRecord`
  wraps a decoy master key. The alerting workflow does not exist.
- **Disclosure stages.** `vault.items.disclosure_stage` records which of the four
  stages in spec §6.2 an item belongs to, and the item composer asks at authoring
  time. Asking the user while they are writing is far more reliable than
  inferring it years later.

`vault.vaults.waiting_period_days` is likewise present with the spec's floor of
14 days enforced by a check constraint.
