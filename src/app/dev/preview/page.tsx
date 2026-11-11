import { notFound } from 'next/navigation';

import { CustodyModeChoicePreview, PassphrasePreview, UnlockPreview } from './previews';
import { TranscriptionSheet } from '@/components/TranscriptionSheet';
import {
  Button,
  Card,
  Eyebrow,
  Field,
  H1,
  H2,
  Hair,
  HardWarning,
  Lead,
  Page,
  StatusPill,
  inputClass,
} from '@/components/ui';

/**
 * Development-only component preview.
 *
 * Most of this app's surfaces sit behind authentication and a Supabase session,
 * which makes the visual layer the hardest part of it to review — exactly the
 * part where a regression is invisible to the test suite. This route renders
 * the real components so the design can be looked at.
 *
 * It returns 404 outside development. It renders fixed sample data only: no
 * vault, no key material, nothing fetched.
 */
export default function DevPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();

  return (
    <Page>
      <Eyebrow>development only · not reachable in production</Eyebrow>
      <H1>Component preview</H1>
      <Lead>
        Every element below is the component the app actually renders, with sample props. If this
        page looks right, the product surfaces look right.
      </Lead>

      <Hair className="my-14" />

      <H2>Type scale</H2>
      <div className="mt-6 space-y-6">
        <p className="t-display">Display</p>
        <p className="t-display-sm">Display small</p>
        <p className="t-say">
          Body copy sits at the display end of the contrast rule. <b>Bold is a weight axis shift</b>,
          not a different family.
        </p>
        <p className="t-mono">mono · captions and data only</p>
      </div>

      <Hair className="my-14" />

      <H2>Controls</H2>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="mt-8 max-w-md space-y-6">
        <Field label="Vault name" hint="Stored unencrypted, so we can show it to you before you unlock.">
          <input className={inputClass} defaultValue="Personal crypto" />
        </Field>
        <Field label="Contents" hint="Encrypted in this browser before it is sent.">
          <textarea className={`${inputClass} font-mono`} rows={3} defaultValue="Ledger Nano X, attorney safe." />
        </Field>
      </div>

      <Hair className="my-14" />

      <H2>Status</H2>
      <div className="mt-6 flex flex-wrap gap-3">
        <StatusPill tone="ok">Verified 2 months ago</StatusPill>
        <StatusPill tone="due">Due for a check</StatusPill>
        <StatusPill tone="risk">At risk — 24 months</StatusPill>
        <StatusPill tone="never">Never verified</StatusPill>
      </div>

      <Hair className="my-14" />

      <H2>Cards</H2>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Card><p className="t-say">Plain. The default surface.</p></Card>
        <Card tone="ok"><p className="t-say">Verified and intact.</p></Card>
        <Card tone="warn"><p className="t-say">Your Executor Letter is out of date.</p></Card>
        <Card tone="danger"><p className="t-say">No custody plan. This vault cannot be inherited.</p></Card>
      </div>

      <div className="mt-8">
        <HardWarning title="There is no password reset. There cannot be one.">
          <p>
            This passphrase is the only thing that can decrypt your vault. We do not have it, we
            never receive it, and we cannot derive it.
          </p>
        </HardWarning>
      </div>

      <Hair className="my-14" />

      <H2>Unlock gate</H2>
      <div className="mt-6"><UnlockPreview /></div>

      <Hair className="my-14" />

      <H2>Passphrase display</H2>
      <div className="mt-6"><PassphrasePreview /></div>

      <Hair className="my-14" />

      <H2>Custody mode choice</H2>
      <div className="mt-6"><CustodyModeChoicePreview /></div>

      <Hair className="my-14" />

      <H2>Transcription sheet — a printed artefact</H2>
      <p className="t-say mt-4 max-w-[62ch]">
        This one is paper. The warm tone is reserved for the physical channel, and the print rules
        in globals.css are its real output format.
      </p>
      <div className="mt-8"><TranscriptionSheet wordCount={12} vaultLabel="Personal crypto" /></div>
    </Page>
  );
}
