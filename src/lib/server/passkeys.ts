import 'server-only';

import { createAdminClient } from '@/lib/server/admin';

/**
 * Challenge lifecycle helpers.
 *
 * A challenge is minted here, stored, and deleted the moment it is consumed.
 * Single-use is enforced by the delete rather than by a flag, so a replayed
 * response finds nothing to match against.
 */

export type ChallengePurpose = 'register' | 'authenticate' | 'step_up';

export async function mintChallenge(params: {
  userId: string;
  purpose: ChallengePurpose;
  challenge: string;
  stepUpPurpose?: string;
}): Promise<void> {
  const admin = createAdminClient();

  // Opportunistic sweep: expired challenges are useless, and clearing them when
  // a new one is minted avoids needing a scheduled job for the whole table.
  await admin
    .schema('account')
    .from('webauthn_challenges' as never)
    .delete()
    .lt('expires_at', new Date().toISOString());

  const { error } = await admin
    .schema('account')
    .from('webauthn_challenges' as never)
    .insert({
      user_id: params.userId,
      purpose: params.purpose,
      challenge: params.challenge,
      ...(params.stepUpPurpose ? { step_up_purpose: params.stepUpPurpose } : {}),
    } as never);
  if (error) throw new Error(`Could not store the WebAuthn challenge: ${error.message}`);
}

export interface ConsumedChallenge {
  readonly challenge: string;
  readonly stepUpPurpose: string | null;
}

/**
 * Take the most recent unexpired challenge for this user and purpose, and delete
 * it. Returns null when there is none, which the caller must treat as a failure
 * rather than as "no challenge required".
 */
export async function consumeChallenge(
  userId: string,
  purpose: ChallengePurpose,
): Promise<ConsumedChallenge | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .schema('account')
    .from('webauthn_challenges' as never)
    .select('id, challenge, step_up_purpose, expires_at')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    challenge: string;
    step_up_purpose: string | null;
  };

  // Delete before returning: if anything downstream throws, the challenge is
  // still spent, which is the safe direction to fail in.
  await admin
    .schema('account')
    .from('webauthn_challenges' as never)
    .delete()
    .eq('id', row.id);

  return { challenge: row.challenge, stepUpPurpose: row.step_up_purpose };
}
