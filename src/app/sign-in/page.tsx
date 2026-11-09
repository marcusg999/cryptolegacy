'use client';

import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, H1, Lead, Page } from '@/components/ui';

/**
 * Identity only. Spec §5.2: "OAuth authenticates. It must never derive or unlock
 * encryption keys."
 *
 * Signing in gets you as far as seeing that a vault exists and what its items
 * are called. It does not decrypt anything, which is why a compromised Google
 * account is not a drained vault.
 */
export default function SignInPage() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: 'google' | 'apple') {
    setPending(provider);
    setError(null);
    try {
      const supabase = createClient();
      const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${origin}/auth/callback` },
      });
      if (oauthError) throw oauthError;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      setPending(null);
    }
  }

  return (
    <Page>
      <H1>Sign in</H1>
      <Lead>
        This signs you in to your account. It does not unlock your vault — that needs your
        passphrase, which we never receive and cannot derive from your Google or Apple session.
      </Lead>

      <div className="mt-8 max-w-md space-y-4">
        <Card>
          <div className="space-y-3">
            <Button
              onClick={() => signIn('google')}
              disabled={pending !== null}
              className="w-full"
            >
              {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </Button>
            <Button
              onClick={() => signIn('apple')}
              disabled={pending !== null}
              variant="secondary"
              className="w-full"
            >
              {pending === 'apple' ? 'Redirecting…' : 'Continue with Apple'}
            </Button>
          </div>

          {error ? (
            <p className="mt-4 rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
              {error}
            </p>
          ) : null}
        </Card>

        <Card tone="plain">
          <p className="text-xs leading-relaxed text-ink/70">
            After signing in you will be asked to register a passkey. That is not optional on this
            product — a password or an SMS code is a weaker secret than the thing it protects, and
            SMS in particular is defeated by a SIM swap, which is a routine attack on anyone known
            to hold cryptocurrency. We do not offer SMS two-factor anywhere.
          </p>
        </Card>
      </div>
    </Page>
  );
}
