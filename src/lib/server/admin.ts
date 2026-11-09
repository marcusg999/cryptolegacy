import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/types';

/**
 * The service-role client.
 *
 * `import 'server-only'` makes importing this from a client component a build
 * error rather than a runtime surprise, and `scripts/check-crypto-leaks.mjs`
 * fails CI if the key is referenced outside `src/lib/server` and `/api`.
 *
 * What this client can reach is deliberately small. Migration 0007 grants the
 * service role the `account` and `legal` schemas and explicitly revokes `vault`
 * and `custody`, so even though the role carries BYPASSRLS it cannot read a byte
 * of vault ciphertext. The only reason it exists is WebAuthn: verifying a
 * registration or an assertion has to happen somewhere the user cannot forge the
 * result, and that means the server.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for passkey routes.',
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Relying-party configuration, read once so a misconfiguration fails loudly. */
export function relyingParty() {
  const rpID = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID;
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  const rpName = process.env.NEXT_PUBLIC_WEBAUTHN_RP_NAME ?? 'Crypto Inheritance Vault';
  if (!rpID || !origin) {
    throw new Error(
      'NEXT_PUBLIC_WEBAUTHN_RP_ID and NEXT_PUBLIC_APP_ORIGIN must be set. ' +
        'The origin must match exactly, scheme and port included, or every assertion will fail.',
    );
  }
  return { rpID, origin, rpName };
}
