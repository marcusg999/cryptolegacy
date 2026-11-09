import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, relyingParty } from '@/lib/server/admin';
import { consumeChallenge } from '@/lib/server/passkeys';
import { createClient } from '@/lib/supabase/server';

const body = z.object({
  response: z.unknown(),
  deviceLabel: z.string().max(80).optional(),
});

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

  const challenge = await consumeChallenge(user.id, 'register');
  if (!challenge) {
    return NextResponse.json(
      { error: 'No pending registration, or it expired. Start again.' },
      { status: 400 },
    );
  }

  const { rpID, origin } = relyingParty();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Registration could not be verified.' },
      { status: 400 },
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Registration could not be verified.' }, { status: 400 });
  }

  const { credential, credentialBackedUp } = verification.registrationInfo;
  const admin = createAdminClient();

  const { error } = await admin.schema('account').from('passkeys').insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64'),
    sign_count: credential.counter,
    transports: credential.transports ?? [],
    backed_up: credentialBackedUp,
    ...(parsed.data.deviceLabel ? { device_label: parsed.data.deviceLabel } : {}),
  });
  if (error) {
    return NextResponse.json(
      { error: `The passkey could not be saved: ${error.message}` },
      { status: 500 },
    );
  }

  await admin
    .schema('account')
    .from('account_security')
    .upsert(
      { user_id: user.id, passkey_enrolled_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  return NextResponse.json({ verified: true });
}
