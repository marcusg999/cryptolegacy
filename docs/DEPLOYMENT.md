# Deployment

Everything here is configuration that lives outside the repository. Each item is
listed because the app fails without it, and several fail in ways that are not
obvious from the error.

---

## 1. Expose the custom schemas to the Supabase API

**The app does not work without this and the failure is confusing.**

This project uses four schemas — `account`, `vault`, `custody`, `legal` — and
nothing in `public`. PostgREST only serves schemas it has been told to expose,
and `public` is the only one exposed by default. Without this change, every
query returns `PGRST106: The schema must be one of the following: public`, which
reads like an application bug rather than a configuration one.

In the Supabase dashboard: **Project Settings → API → Exposed schemas**, add
`account`, `vault`, `custody`, `legal`.

Or in `supabase/config.toml` for local development:

```toml
[api]
schemas = ["public", "account", "vault", "custody", "legal"]
```

Exposing a schema does not grant access to it — RLS and the table grants still
apply, and `anon` still reaches only the published legal content.

---

## 2. Environment variables

See `.env.example`. The ones that bite:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_ORIGIN` | The WebAuthn origin. Must match **exactly**: scheme, host and port. `https://example.com` and `https://www.example.com` are different origins and a passkey registered against one will not assert against the other. |
| `NEXT_PUBLIC_WEBAUTHN_RP_ID` | The registrable domain, no scheme and no port. `example.com`, not `https://example.com:443`. Changing it after users have enrolled invalidates every existing passkey — there is no migration. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Must not be prefixed `NEXT_PUBLIC_`. `scripts/check-crypto-leaks.mjs` fails the build if it becomes reachable from client code. |
| `CRYPTO_REVIEW_ATTESTATION` | The build refuses to run without it. See `REVIEW_GATE.md`. |

---

## 3. OAuth providers

Google and Apple, configured in **Authentication → Providers**. The redirect URL
is `<NEXT_PUBLIC_APP_ORIGIN>/auth/callback` and must be registered with each
provider as well as with Supabase.

Spec §5.2: OAuth authenticates and must never derive or unlock encryption keys.
Nothing in `src/app/auth/callback` touches the crypto layer, and nothing should
be added that does.

---

## 4. Auth settings

- **Disable email/password sign-in** unless there is a reason to keep it. OAuth
  plus a mandatory passkey is the intended posture.
- **Do not enable phone/SMS auth or SMS MFA.** Spec §5.3: no SMS anywhere in
  this product. It is defeated by a SIM swap, which is a routine attack against
  anyone publicly known to hold cryptocurrency.
- JWT expiry should align with the 15-minute idle session in
  `account.account_security.session_timeout_seconds`.

---

## 5. Migrations

```bash
supabase db push
```

Order matters and the filenames encode it. `0001` creates the schemas and the
shared helpers; `0003` creates `vault.vaults` and then the ownership helper that
reads it (PostgreSQL validates a SQL function body at creation, so the helper
cannot precede its table); `0006` draws the service-role boundary and must run
after the tables it revokes.

Verify the policies after any migration:

```bash
npm run db:test
```

---

## 6. Encrypted backups — not implemented, and required

Spec §5.5 calls for **encrypted backups with keys held outside Supabase**, so
that a Supabase compromise does not include the backups. This repository does
not and cannot implement that: it is a deployment concern.

What this means concretely: Supabase's own backups are encrypted with keys
Supabase holds. An attacker who compromises the Supabase account reaches both
the database and its backups. Set up an independent `pg_dump` to storage you
control, encrypted with a key held elsewhere (a cloud KMS in a different
provider, or an offline key).

Note what a backup does and does not expose. Vault contents stay encrypted under
the users' passphrases, which are not in the database. A backup leaks the same
things the live database leaks and nothing more — see `SECURITY.md` §6.

**This is tracked as a known gap in `SECURITY.md` §12 and is not done.**

---

## 7. Storage

Not configured, because the media pipeline is build-order step 5 and does not
exist. When it is built, spec §5.5 requires storage policies mirroring RLS and
signed URLs that are short-lived (60 s) and single-use.

---

## 8. Netlify

`netlify.toml` runs `npm run ci && npm run build`. The build fails without
`CRYPTO_REVIEW_ATTESTATION`, by design.

Set every variable from `.env.example` in **Site settings → Environment
variables**. The service-role key must be present only at runtime, not in the
build environment, and must never appear in a build artefact.

---

## 9. After deploying

Check, in this order:

1. `/` renders and the response carries a `Content-Security-Policy` header with
   a nonce and no `unsafe-eval`.
2. Sign-in completes and lands on `/onboarding/passkey`.
3. A passkey registers, and signing out and back in asserts it.
4. A vault can be created end to end: sheet, passphrase, transcription, unlock.
   The Argon2id step should take roughly 0.5–4 seconds depending on device.
5. `vault.audit_log` has rows, and `metadata` contains no user content.
6. A second account cannot see the first account's vault. The pgTAP suite proves
   this against the schema; confirm it holds against the deployed API too, since
   exposed-schema misconfiguration is the one way it could differ.
