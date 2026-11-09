'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button, Card, Field, H1, H2, Lead, Page, inputClass } from '@/components/ui';

/**
 * Passkey enrolment. Spec §5.3: mandatory for every account.
 *
 * Middleware sends every signed-in user here until a passkey exists, and the
 * only way out is to register one. That is a deliberate piece of friction: this
 * product's account layer guards the ability to start a death claim, and a
 * password-only account is a weaker secret than the thing it guards.
 */
export default function PasskeyOnboardingPage() {
  return (
    <Suspense fallback={null}>
      <PasskeyOnboarding />
    </Suspense>
  );
}

function PasskeyOnboarding() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/dashboard';

  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch('/api/passkeys/register/options', { method: 'POST' });
      if (!optionsRes.ok) throw new Error((await optionsRes.json()).error ?? 'Could not start.');
      const options = await optionsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/passkeys/register/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response: attestation,
          ...(label.trim() ? { deviceLabel: label.trim() } : {}),
        }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.verified) {
        throw new Error(result.error ?? 'The passkey could not be verified.');
      }

      router.push(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.name === 'NotAllowedError'
            ? 'The request was dismissed or timed out. Try again when you are ready to use your device unlock.'
            : e.message
          : 'Registration failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <H1>Register a passkey</H1>
      <Lead>
        Required before you can use the vault. A passkey is a key held by your phone, laptop or
        security key, unlocked by your fingerprint, face or device PIN. It never leaves the device
        and there is nothing to phish.
      </Lead>

      <div className="mt-8 max-w-xl space-y-5">
        <Card>
          <div className="space-y-4">
            <Field
              label="Name this device (optional)"
              hint="So you can tell your passkeys apart later. Stored unencrypted."
            >
              <input
                className={inputClass}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                placeholder="Work laptop"
              />
            </Field>

            <Button onClick={register} disabled={busy}>
              {busy ? 'Waiting for your device…' : 'Register a passkey'}
            </Button>

            {error ? (
              <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
                {error}
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <H2>Why this is not optional here</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            Signing in does not decrypt your vault — that needs your passphrase, which we never
            receive. But an attacker with your account can see that a vault exists, read the names
            of what is in it, see the shape of your custody plan, and{' '}
            <strong>start a death claim against you</strong>. That last one is why we are strict.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            We do not offer SMS codes anywhere in this product. A SIM swap defeats them, it is
            cheap, and people publicly known to hold cryptocurrency are a standard target for it.
            Offering SMS would be offering a control we know does not hold.
          </p>
        </Card>

        <Card>
          <H2>Register a second one soon</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            One passkey on one device is a single point of failure for your account. Add a second
            from another device, or a hardware security key, once you are set up. We will not let
            you remove your last passkey — the database refuses it.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            Note that losing account access is recoverable through our support, unlike losing your
            vault passphrase. The two are different in kind, and that is the point of keeping them
            separate.
          </p>
        </Card>
      </div>
    </Page>
  );
}
