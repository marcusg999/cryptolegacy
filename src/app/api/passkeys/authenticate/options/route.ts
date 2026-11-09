import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, relyingParty } from '@/lib/server/admin';
import { mintChallenge } from '@/lib/server/passkeys';
import { createClient } from '@/lib/supabase/server';
import type { PasskeyRow } from '@/lib/supabase/types';

const STEP_UP_PURPOSES = [
  'edit_custody_plan',
  'manage_custody_point',
  'manage_executor',
  'manage_attestor',
  'initiate_death_claim',
  'attest_death_claim',
  'export_data',
  'enrol_duress_passphrase',
] as const;

const body = z.object({
  /**
   * Present when this assertion is for step-up re-authentication (spec §5.3),
   * absent when it is an ordinary sign-in challenge.
   */
  stepUpPurpose: z.enum(STEP_UP_PURPOSES).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unknown step-up purpose.' }, { status: 400 });
  }

  const { rpID } = relyingParty();
  const admin = createAdminClient();

  const { data: passkeys } = await admin
    .schema('account')
    .from('passkeys')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  const rows = (passkeys ?? []) as Pick<PasskeyRow, 'credential_id' | 'transports'>[];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No passkey is registered on this account.' },
      { status: 400 },
    );
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: rows.map((p) => ({
      id: p.credential_id,
      transports: p.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: 'required',
  });

  await mintChallenge({
    userId: user.id,
    purpose: parsed.data.stepUpPurpose ? 'step_up' : 'authenticate',
    challenge: options.challenge,
    ...(parsed.data.stepUpPurpose ? { stepUpPurpose: parsed.data.stepUpPurpose } : {}),
  });

  return NextResponse.json(options);
}
