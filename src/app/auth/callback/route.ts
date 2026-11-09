import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * OAuth callback. Exchanges the code for a session and sends the user on.
 *
 * Note what does NOT happen here: nothing is derived from the OAuth session for
 * cryptographic purposes. Spec §5.2 — if the vault passphrase were derivable
 * from a Google session, a compromised Google account would equal a drained
 * vault and the zero-knowledge claim would be false.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  // Only ever redirect within our own origin: an open redirect on an auth
  // callback is a phishing primitive.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return NextResponse.redirect(`${origin}${safeNext}`);
}
