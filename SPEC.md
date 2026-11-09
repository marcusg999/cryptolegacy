# Crypto Inheritance Vault — Build Specification (V1)

> Drop this at repo root. Read it fully before writing code.
> This document is the source of truth for scope, architecture, and the things we deliberately refuse to build.

---

## 1. What this product is

A **zero-knowledge vault** that ensures a person's cryptocurrency does not die with them.

The primary feature is the release of **cryptocurrency assets and wallet access**. Everything else — wills, video messages, non-crypto asset inventory — is secondary context around that one problem.

**Why crypto-first is the correct wedge:** crypto is the only asset class where death means permanent, total, unrecoverable loss. A house doesn't vanish because nobody knew about it — the county recorder knows. An unclaimed bank account escheats to the state and waits. 4 BTC behind a forgotten passphrase is gone forever, and no court, lawyer, or exchange can retrieve it. That irreversibility is the entire product.

### 1.1 What this product is NOT — enforce these as hard constraints

Each row maps to a specific legal or security exposure. Do not build past them, and do not let a later feature request erode them.

| Non-goal | Why |
|---|---|
| **Not a will generator.** The app never drafts legal documents. | Unauthorized practice of law. We store and organize documents the user obtains elsewhere. |
| **Not a custodian.** The app never holds, moves, or has the technical ability to spend crypto. | Money transmitter licensing, MSB registration, state custody rules. |
| **Not a "clue" or hint system.** No riddles, no partial seed phrases, no memory prompts. | A hint that narrows a seed phrase is a theft target and is discoverable in litigation. We protect with cryptography, not obscurity. |
| **Not able to read user content.** No server-side decryption path exists, for support, for law enforcement, for anyone. | This is the entire security model. If an admin can decrypt, we are a honeypot. |
| **Not a probate workaround.** Released assets still belong to the estate. | Creditor claims, elective share, basis step-up at death. We help the executor do their job; we do not route around them. |
| **Not a passphrase holder.** The app never sees, stores, transmits, or escrows the vault passphrase, in any form. | See §3. This is the defining architectural decision of V1. |

If a requested feature requires violating any row, stop and flag it rather than implementing it.

---

## 2. Legal posture

### 2.1 The actual legal hook: RUFADAA

The Revised Uniform Fiduciary Access to Digital Assets Act has been adopted in nearly every US state. It governs whether a fiduciary may lawfully access a decedent's digital assets. **This is the statute the product is built around.**

Practical consequence: the app must prompt the user to ensure their will or trust contains explicit RUFADAA authorization empowering their executor to access digital assets. Without it, an executor using our vault may be acting outside their authority — and arguably in violation of computer fraud statutes.

The app must **tell the user this language is required and that their attorney must draft it.** The app must not draft it.

### 2.2 Recorded video is evidence, not a will

Most US states require a will to be written, signed, and witnessed. A minority have adopted electronic-will legislation. Recorded video is generally admissible as *evidence of testamentary intent and capacity* — valuable in a contest — but it is **not the instrument**.

Every surface touching video must make this unmissable. A user who believes they made a will by talking into a camera has been harmed by our product.

Video's real value, and how the app should frame it:
- Proof of capacity and absence of duress at the time of recording (defeats the most common will contest)
- Explaining *why* a distribution is uneven — this prevents litigation far more effectively than the distribution clause itself
- Teaching a non-technical beneficiary how to use what they inherited
- The human message, which is often what the user actually came for

### 2.3 State-aware guidance layer, not a rules engine

Because we don't draft documents, we don't need a 50-state drafting engine. We need a **checklist layer**: for the user's state, what makes a valid will, is a holographic will recognized, is remote online notarization available, what does the probate court require.

**Build requirement:** source this from a verified legal database or attorney review, stored as versioned, citation-bearing content records. **Do not generate this content from model knowledge.** Each state record carries `last_reviewed_at`, `reviewed_by`, and source citations, surfaced in the UI. Stale legal content is a liability, not a feature.

### 2.4 Disclaimers

Persistent, not one-time-at-signup: not a law firm, not legal advice, no attorney-client relationship, consult an attorney licensed in your state. Surface at every point a user might mistake the product for counsel — especially the video recorder and the document vault.

---

## 3. The two-channel architecture — read this section twice

V1 deliberately removes all cryptographic key-splitting machinery. Inheritance of the passphrase happens **in the physical world**, by whatever arrangement the user chooses.

```
CHANNEL 1 — THE APP                    CHANNEL 2 — THE PHYSICAL WORLD
  Encrypted vault (ciphertext)           The passphrase itself
  Account access control                 Held wherever and by whomever
  Death verification                       the user chooses
  Audit log                              Safe deposit box, attorney,
  Education module                         home safe, a trusted person,
  Asset inventory metadata                 a steel plate, split across
                                           several of these
```

**Neither channel alone opens anything.** An executor with the passphrase but no account access has ciphertext they cannot reach. A custodian who holds the sealed envelope cannot log in. A person who compromises our entire infrastructure gets encrypted blobs. This separation is a stronger safety property than the sharding scheme it replaces, and it costs almost nothing to build.

### 3.1 What this means in code

- The passphrase is entered **client-side only**, derived via **Argon2id** into a key-encryption key, and **never transmitted in any form** — not the passphrase, not a hash, not a verifier, not a "strength score" computed server-side.
- There is **no password reset.** There cannot be one. The UI must make this consequence brutally clear at creation time and never soften it.
- Verification that a passphrase is correct happens by attempting decryption of a known sentinel blob client-side. The server learns only success or failure, and rate-limits attempts.

### 3.2 Passphrase generation

- Generate client-side using **diceware** (minimum 12 words from the EFF long list). Do not let users invent their own — human-chosen passphrases of this importance are predictably weak.
- Display once, full screen, with screenshot discouraged and clipboard access disabled.
- **Require physical transcription confirmation:** the user must re-enter the phrase from their written copy before the vault is created. This forces the physical artifact to exist before anything depends on it.
- Offer a printable, high-contrast transcription sheet sized for a safe deposit box, with checkboxes for each custody location.

---

## 4. The custody plan — the core V1 feature

The user decides where the passphrase lives and who holds it. The app's job is to help them **design, record, and periodically verify** that arrangement without ever learning its contents.

### 4.1 Custody point types

Let the user define any number of custody points, each typed:

- **Person** — attorney, spouse, sibling, friend, accountant
- **Institution** — safe deposit box, attorney's firm safe, registered agent
- **Location** — home safe, fireproof box, buried capsule, a second property
- **Other** — free-form

Each custody point records: a label, type, the user's own notes, a `last_verified_at` date, and whether it holds a full copy or a split part. **Locations and custodian identities are stored inside the encrypted vault, not as plaintext metadata** — see §4.4 for how the executor learns where to look.

### 4.2 Redundancy vs. split — make the user choose explicitly

This is the single most important decision in the user's setup, and most people get it wrong by default. Present it as a deliberate fork with honest tradeoffs:

**Full copies in N locations (redundancy).**
Survives loss. Any one copy opens the vault. More copies means more theft surface and more people who could act alone. Right answer for most users, because *loss is overwhelmingly more likely than betrayal*.

**Split across N locations (all parts required).**
Survives betrayal. No single holder can act alone. But losing any one part destroys access permanently — and that makes it strictly more fragile than doing nothing. Right answer only for high-value vaults with genuinely untrusted custodians.

**If the user chooses split, enforce this:** the passphrase must be long enough that a single part doesn't meaningfully weaken the remainder. A 12-word diceware phrase split into three 4-word parts still leaves roughly 50 bits unknown to any single holder — acceptable. Splitting a short passphrase is dangerous and the app must refuse it. Recommend 15+ words whenever split mode is selected, and do the entropy arithmetic in the UI rather than asserting it.

**Hybrid, and the one most people should pick:** two full copies in two independent locations with different failure modes — e.g. attorney's safe plus a bank safe deposit box. Survives a house fire, survives one custodian going dark, requires no coordination.

### 4.3 Custody verification cycle

Untested inheritance is not inheritance. The app runs a periodic **custody check** (default annual, configurable quarterly):

- Prompt the user to confirm each custody point is still reachable and intact
- Optional **custodian attestation**: email a named custodian asking them to confirm they still hold a sealed envelope on the user's behalf. The custodian confirms possession only — they never open it, and the app never asks what's inside.
- Flag any custody point unverified for over 18 months as **at risk**, prominently, on the dashboard
- Flag custodians who have not responded to two consecutive attestation requests
- Email the user an annual **custody health report**: how many points, when each was last verified, what's at risk

This is the differentiator. Nearly every product in this category fails silently years after setup, and nobody discovers it until it's too late to fix. A dated report saying "your arrangement was verified and is intact" is the strongest trust signal this product can send, and almost nobody ships it.

### 4.4 The Executor Letter — resolving the bootstrap problem

There is a circular dependency to solve: the executor needs to know *where the passphrase is*, but that information is itself sensitive, and storing it in plaintext would hand our database a treasure map.

**Solution: the app generates it, the user prints it, the app does not retain it.**

- The app generates a printable **Executor Letter** from the user's custody plan: who holds what, where, and in what order to contact them.
- The user prints it and stores it **physically with their will**, which is where executors already look. This matches existing estate practice rather than fighting it.
- The app retains the custody plan only inside the passphrase-encrypted vault — useless to an executor, by design, and therefore safe.
- What the app shows an executor after death verification is **metadata only**: that a vault exists, that N custody points were designated, when each was last verified, and instructions to locate the Executor Letter with the will.
- Re-prompt the user to regenerate and re-print the letter whenever the custody plan changes. Track `letter_last_generated_at` against `custody_plan_last_modified_at` and warn on drift.

---

## 5. Security architecture

**Threat model.** Assume: our database is fully exfiltrated; our object storage is fully exfiltrated; one of our engineers is malicious; a custodian is malicious; a user's Google account is compromised. In every scenario, user secrets must remain unreadable.

### 5.1 Envelope encryption

```
Vault item (video, document, text instruction, custody plan)
  └─ encrypted with a per-item Data Encryption Key (DEK)
       AES-256-GCM, DEK randomly generated per item
       └─ DEK wrapped by the Vault Master Key (VMK)
            └─ VMK wrapped by a key derived from the passphrase
                 Argon2id, parameters per current OWASP guidance
```

The VMK exists only in browser memory during an unlocked session. Zero it on lock, tab close, and timeout.

**No novel cryptography anywhere in this build.** Standard constructions only. The audit bill and the risk both scale with how much we invented; the correct amount is nothing.

### 5.2 The OAuth / encryption separation — do not get this wrong

**OAuth authenticates. It must never derive or unlock encryption keys.**

If the vault passphrase were derivable from a Google or Apple session, a compromised Google account would equal a drained vault and our zero-knowledge claim would be false.

- **Identity layer:** Supabase Auth, OAuth (Google, Apple). Governs *who can log in and see that a vault exists.*
- **Crypto layer:** passphrase → Argon2id → key-wrapping key, computed in the browser, never transmitted. Governs *who can read anything.*

A logged-in session without the passphrase sees metadata only: item names, sizes, dates, custody point count. Never content.

### 5.3 Authentication requirements

- Supabase Auth with OAuth: Google and Apple minimum
- **Passkeys (WebAuthn) mandatory** for every account. TOTP as fallback. **No SMS 2FA anywhere in this product.**
- Step-up re-authentication for: editing the custody plan, adding/removing an executor or attestor, initiating or attesting a death claim, any export
- Aggressive session timeout (15 min idle default), and a separate, shorter vault-unlock timeout
- Immutable audit log of every access, attestation, and configuration change — visible to the user, exportable for probate

### 5.4 Client-side encryption of media

Video and audio are encrypted **in the browser before upload**. Storage receives ciphertext only.

- WebCrypto, AES-256-GCM
- Chunked encryption with streaming upload; a 20-minute 1080p recording cannot be buffered whole in memory on a mobile browser
- Resumable uploads with per-chunk integrity verification
- Strip or explicitly surface EXIF/geolocation before encryption
- Encrypted thumbnail and duration marker so the vault list is usable without decrypting payloads

### 5.5 Supabase specifics

- Row Level Security on **every** table, default deny, no exceptions
- Service-role key never reaches the client, never appears in a Netlify build artifact
- Storage policies mirror RLS; signed URLs short-lived (60s) and single-use
- Separate schemas for vault data, custody/attestation data, and the legal content library
- **Encrypted backups with keys held outside Supabase**, so a Supabase compromise doesn't include backups
- RLS policy tests are a first-class suite. Every policy gets a test proving the negative case: a different user cannot read this row.

---

## 6. Death verification and release

The highest-stakes path in the product. A false positive hands an executor the ciphertext of someone's entire financial life while they are alive in a hospital bed. **Design every ambiguity to fail closed.**

Note that the physical-passphrase design already limits the blast radius: a premature release exposes encrypted data, not plaintext. That is a meaningful safety margin, and it is not a reason to weaken anything below.

### 6.1 Required sequence

1. **Claim initiated** by the named executor or any attestor, with a stated basis
2. **Death certificate uploaded** — certified copy, reviewed by a human for facial validity. We verify we received a plausible document; we are not a fraud-detection service, and we say so plainly.
3. **Attestor confirmation** — m-of-n named attestors independently confirm, each with step-up auth, each attestation individually logged and timestamped. Default 2-of-3. Attestors hold **no key material** in V1 — they are witnesses, not custodians, and the roles may or may not overlap at the user's discretion.
4. **Mandatory waiting period — 30 days default, minimum 14, user-configurable upward.** The single most important safety feature in the product.
5. **Escalating contact attempts to the owner** throughout: email, SMS, push, and physical mail for high-value vaults. Any response from the owner **immediately voids the claim and locks the vault**, notifying every attestor of the attempt.
6. **Executor access granted** to the encrypted vault and the staged disclosure flow
7. **Executor obtains the passphrase physically**, following the Executor Letter stored with the will
8. **Executor unlocks client-side** and content decrypts in their browser

### 6.2 Staged disclosure, not a single dump

Once unlocked, reveal in this order — do not dump everything at once:

1. Personal messages and letters to beneficiaries
2. Asset inventory and the education module — what exists, what it is, roughly what it's worth
3. Legal documents and the probate packet
4. Wallet access instructions and key location — **last**, optionally behind a further timer

A grieving, non-technical beneficiary handed a seed phrase in the first five minutes is a phishing victim waiting to happen. Teach first, disclose last.

### 6.3 Owner veto and duress

- The owner can abort a claim at any point in the waiting period, from any device, in one action
- **Duress passphrase:** a second passphrase that appears to unlock normally, reveals a decoy inventory, and silently alerts attestors. This product category has a physical-coercion attack vector — "give me your phrase" — and this is the standard mitigation.

---

## 7. Beneficiary education module

The user specifically wants heirs to be able to *use* what they inherit. This is a product surface, not a help page. Per-asset content, unsealed at stage 2:

- What this asset is, in plain language, no jargon
- What the hardware wallet or exchange account physically looks like and where it is
- Step-by-step recovery walkthrough for that specific wallet type
- **Scam and phishing warnings, prominently.** Newly-inheriting crypto holders are heavily targeted, and fake "support" scams spike around publicly known deaths.
- Tax posture: assets generally receive a basis step-up at death; consult a CPA before any sale. Compute nothing.
- Explicit "do not rush, do not move these assets today" guidance

---

## 8. Additional features worth building

- **Attorney/probate export packet** — one PDF with asset inventory, audit log, attestation records, custody health history, and the death-verification chain, formatted for filing. Makes the executor's job dramatically easier and makes estate attorneys want to recommend us.
- **Asset inventory without key material** — that a Ledger exists, its model, where it's stored, approximate value, last-verified date. Useful to an executor even if the vault is never opened.
- **Scheduled future messages** — birthday and milestone videos released on a timer post-death. High emotional value, nearly free on infrastructure we already need.
- **Dormancy check-ins** — not a release trigger, just a nudge: six months idle, confirm the vault and custody plan are still current.
- **Attorney collaboration seat** — read-limited role so the user's estate attorney can confirm the vault matches the actual will. Also the best distribution channel we have.
- **Version history on everything** — wills get amended, wallets get migrated, custodians get divorced. Flag anything untouched for two years.
- **Multiple vaults per user** — personal, business, and trust assets often have different beneficiaries and different executors.

---

## 9. V2 and V3 — roadmap only, no code in V1

### V2: cryptographic key inheritance

Reintroduce Shamir m-of-n sharding so the passphrase itself can be split cryptographically across trustee accounts, removing the physical-custody dependency for users who want that. Requires: audited Shamir library, trustee keypair infrastructure, shard reconstruction flow, rehearsal/drill mode, and an external cryptographic review before launch.

### V2b: on-chain release

Two unsolved problems to design around honestly:

**The oracle problem.** There is no trustworthy on-chain source of truth for "this person is dead." Any oracle is a trusted third party — reintroducing exactly what the contract was meant to remove, and becoming the highest-value attack surface in the system.

**The probate problem.** Auto-transferring assets may bypass creditor claims and elective share rights. An heir receiving assets this way may be receiving property that was not legally theirs, and may incur personal liability.

**Recommended direction instead of a naive death oracle:** a **time-locked multisig with social recovery** — a Safe-style smart account where beneficiaries and trustees hold a recovery quorum that can rotate control after a long inactivity window, with an owner override that resets the clock. Gets the practical benefit, keeps a human in the loop, stays compatible with probate. Account abstraction (ERC-4337) makes this materially easier than it was a few years ago. Architecture should stay chain-agnostic at the data layer; note that Cardano's eUTxO model handles time-locked and threshold conditions very differently from EVM account-based patterns, and the spike should evaluate both.

**Gate:** no on-chain release ships without an external smart contract audit and a written opinion from an estate attorney in each target state.

### V3: asset tokenization — flagged, not designed

Tokenizing real property, art collections, or other physical assets. **Do not let this influence the V1 data model.** Fractionalizing an asset almost certainly creates a security under Howey, implying registration or an exemption and likely broker-dealer questions. Separately, a token is not a deed — county recorders do not recognize on-chain transfer, so the token would track a legal interest that still transfers conventionally, and title insurance would not cover it. This is a larger regulatory lift than V1 and V2 combined and is arguably a different company.

**The ladder V1 → V2 → V3 is ordered by increasing regulatory burden, and each rung should fund the next.**

---

## 10. Build order

1. **Foundation** — Next.js, Supabase schema with RLS and full policy test suite, Netlify deploy, OAuth, mandatory passkeys
2. **Crypto core** — Argon2id derivation, envelope encryption, diceware generation, sentinel-based unlock verification. Round-trip and adversarial tests: wrong passphrase, corrupted ciphertext, truncated blobs, tampered GCM tags.
3. **Vault CRUD** — client-side encrypted text and document storage
4. **Custody planning** — custody points, redundancy/split choice with entropy math, Executor Letter generation
5. **Media pipeline** — chunked client-side encrypted video/audio capture and playback
6. **Custody verification cycle** — periodic checks, custodian attestation, health report, at-risk flagging
7. **Death claim workflow** — full state machine: waiting period, contact cascade, owner veto, staged disclosure
8. **Legal content layer** — state checklists, RUFADAA guidance, attorney-reviewed and versioned
9. **Education module and probate export**

**Do not proceed past step 2 without an external review of the cryptographic implementation.** V1's crypto is deliberately small and standard — this review should be days, not weeks — but everything downstream depends on it being right, and cryptographic bugs are silent: the vault will encrypt, decrypt, and pass every test while being readable by someone who knows what to look for.

---

## 11. Standing engineering rules

- **The passphrase never leaves the browser.** Not in logs, analytics, error reports, Sentry breadcrumbs, LLM calls, or any network request. Add a CI check that greps for leak patterns in anything touching the crypto module.
- No plaintext user content in logs or telemetry. Ever.
- No third-party script on any page that touches decrypted content. Strict CSP, Subresource Integrity on everything.
- Dependency pinning and lockfile integrity enforced in CI — this is a supply-chain target.
- Every cryptographic operation gets a test proving both the positive and the negative case.
- `SECURITY.md` documents the full threat model, key hierarchy, and library audit history.
- When a requirement is legally ambiguous, **stop and surface it** rather than implementing an interpretation.
