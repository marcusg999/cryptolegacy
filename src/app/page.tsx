import Link from 'next/link';

import { Card, H1, H2, Lead, Page } from '@/components/ui';

export default function LandingPage() {
  return (
    <Page>
      <H1>Your crypto should not die with you</H1>
      <Lead>
        A house does not vanish because nobody knew about it — the county recorder knows. An
        unclaimed bank account escheats to the state and waits. Four bitcoin behind a forgotten
        passphrase is gone forever, and no court, lawyer or exchange can retrieve it. That
        irreversibility is the whole reason this exists.
      </Lead>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <Card>
          <H2>Two channels, neither sufficient alone</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            We hold the encrypted vault, the account access, the death verification and the audit
            log. You decide where the passphrase itself lives — a safe deposit box, your
            attorney&rsquo;s safe, a steel plate, a trusted person.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            An executor with the passphrase but no account access has ciphertext they cannot
            reach. A custodian holding the sealed envelope cannot log in. Someone who compromises
            our entire infrastructure gets encrypted blobs.
          </p>
        </Card>

        <Card>
          <H2>We cannot read your vault</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            There is no server-side decryption path. Not for support, not for law enforcement, not
            for us. Your passphrase is generated in your browser, stretched with Argon2id in your
            browser, and never transmitted in any form — not the phrase, not a hash of it, not a
            verifier.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            The consequence is not negotiable and we would rather you hear it now: there is no
            password reset, and there never will be.
          </p>
        </Card>

        <Card>
          <H2>We check that it still works</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            Untested inheritance is not inheritance. Every year we ask you to confirm each custody
            point is still reachable and intact, and we send you a dated report saying so. Anything
            unverified for eighteen months gets flagged, loudly.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            Nearly every product in this category fails silently years after setup, and nobody
            finds out until it is too late to fix.
          </p>
        </Card>

        <Card>
          <H2>What we are not</H2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink/75">
            <li>
              <strong>Not a will generator.</strong> We store and organise documents you obtain
              elsewhere. We never draft them.
            </li>
            <li>
              <strong>Not a custodian.</strong> We never hold, move, or have the technical ability
              to spend your cryptocurrency.
            </li>
            <li>
              <strong>Not a probate workaround.</strong> Released assets still belong to the
              estate. We help your executor do their job; we do not route around them.
            </li>
            <li>
              <strong>Not a hint system.</strong> No riddles, no partial phrases, no memory
              prompts. We protect with cryptography, not obscurity.
            </li>
          </ul>
        </Card>
      </div>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/sign-in"
          className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink-soft"
        >
          Sign in
        </Link>
        <Link
          href="/legal/rufadaa"
          className="inline-flex items-center justify-center rounded-md border border-ink/25 bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-ink/5"
        >
          What your will needs to say first
        </Link>
      </div>
    </Page>
  );
}
