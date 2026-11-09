import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';

import { createAdminClient, relyingParty } from '@/lib/server/admin';
import { mintChallenge } from '@/lib/server/passkeys';
import { createClient } from '@/lib/supabase/server';
import type { PasskeyRow } from '@/lib/supabase/types';

/**
 * Begin passkey registration. Spec §5.3: passkeys are mandatory on every account.
 *
 * The reason they are mandatory rather than encouraged is specific to this
 * product. The account layer protects metadata, not contents — but an attacker
 * with the account can see that a vault exists, read item names, and see the
 * custody plan's shape, and can start a death claim. SMS two-factor is defeated
 * by a SIM swap, which is a routine, cheap attack against anyone publicly known
 * to hold cryptocurrency. So: passkeys, with TOTP as the fallback, and no SMS
 * anywhere in the product.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { rpID, rpName } = relyingParty();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .schema('account')
    .from('passkeys')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email ?? user.id,
    userDisplayName: user.email ?? 'Vault owner',
    // Discourage re-registering an authenticator the account already has: it
    // produces a second credential that looks like redundancy but shares a
    // single physical failure mode.
    excludeCredentials: ((existing ?? []) as Pick<PasskeyRow, 'credential_id' | 'transports'>[]).map(
      (p) => ({
        id: p.credential_id,
        transports: p.transports as AuthenticatorTransport[] | undefined,
      }),
    ),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    // The attestation statement is not collected. We have no use for knowing
    // which make of authenticator a user owns, and collecting it would mean
    // storing a hardware identifier we do not need.
    attestationType: 'none',
  });

  await mintChallenge({ userId: user.id, purpose: 'register', challenge: options.challenge });

  return NextResponse.json(options);
}
