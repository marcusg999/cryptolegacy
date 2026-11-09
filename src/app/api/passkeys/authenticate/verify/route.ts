import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, relyingParty } from '@/lib/server/admin';
import { consumeChallenge } from '@/lib/server/passkeys';
import { createClient } from '@/lib/supabase/server';
import type { PasskeyRow } from '@/lib/supabase/types';

const body = z.object({
  response: z.object({ id: z.string() }).passthrough(),
  stepUp: z.boolean().optional(),
});

/**
 * Verify an assertion, and — when it was a step-up challenge — mint the
 * single-use grant that authorises one privileged action.
 *
 * Spec §5.3 requires step-up for editing the custody plan, changing an executor
 * or attestor, initiating or attesting a death claim, and any export. The grant
 * is created here, server-side, after verification: a client that could mint its
 * own grant would make the whole mechanism decorative.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const isStepUp = parsed.data.stepUp === true;
  const challenge = await consumeChallenge(user.id, isStepUp ? 'step_up' : 'authenticate');
  if (!challenge) {
    return NextResponse.json(
      { error: 'No pending challenge, or it expired. Start again.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: passkey } = await admin
    .schema('account')
    .from('passkeys')
    .select('*')
    .eq('user_id', user.id)
    .eq('credential_id', parsed.data.response.id)
    .maybeSingle();

  if (!passkey) {
    return NextResponse.json({ error: 'Unknown credential.' }, { status: 400 });
  }
  const row = passkey as PasskeyRow;
  const { rpID, origin } = relyingParty();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64')),
        counter: row.sign_count,
        transports: row.transports as AuthenticatorTransport[] | undefined,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Assertion could not be verified.' },
      { status: 400 },
    );
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Assertion could not be verified.' }, { status: 400 });
  }

  // A counter that fails to advance is the signature of a cloned authenticator.
  // Not every authenticator maintains one (a passkey synced across a vendor's
  // cloud reports zero), so a zero counter is normal and only a *regression*
  // from a non-zero value is suspicious.
  const newCounter = verification.authenticationInfo.newCounter;
  if (row.sign_count > 0 && newCounter <= row.sign_count) {
    return NextResponse.json(
      {
        error:
          'This passkey reported a signature counter that did not advance, which can indicate a ' +
          'cloned authenticator. The attempt was refused. Register a new passkey and remove this one.',
      },
      { status: 400 },
    );
  }

  await admin
    .schema('account')
    .from('passkeys')
    .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', row.id);

  if (isStepUp && challenge.stepUpPurpose) {
    const { error } = await admin
      .schema('account')
      .from('step_up_grants' as never)
      .insert({
        user_id: user.id,
        purpose: challenge.stepUpPurpose,
        passkey_id: row.id,
        // Short enough that walking away does not leave an open authorisation.
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      } as never);
    if (error) {
      return NextResponse.json(
        { error: `The authorisation could not be recorded: ${error.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    verified: true,
    ...(isStepUp ? { purpose: challenge.stepUpPurpose } : {}),
  });
}
