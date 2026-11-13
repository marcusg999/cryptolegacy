import Link from 'next/link';

import { Descent, type Stratum } from '@/components/Descent';
import { Card, Eyebrow, H2, Hair, Page } from '@/components/ui';

/**
 * The landing page carries the full treatment from design/CONTRACT.md,
 * because its job is to make the argument. Every other surface gets the
 * language without the pinned descent.
 */

const STRATA: Stratum[] = [
  {
    window: [0.19, 0.34],
    depth: '0 m · the surface',
    body: (
      <>
        A house does not vanish because nobody knew about it.{' '}
<b>The county recorder knows.</b>
      </>
    ),
  },
  {
    window: [0.37, 0.52],
    depth: '340 m · below the light',
    align: 'right',
    body: (
      <>
        An unclaimed bank account escheats to the state and waits.{' '}
<b>It is patient.</b>
      </>
    ),
  },
  {
    window: [0.56, 0.72],
    depth: '2 900 m · the unconformity',
    body: (
      <>
        Crypto is the only asset class where death means{' '}
<b>permanent, total, unrecoverable loss.</b>
      </>
    ),
  },
];

export default function LandingPage() {
  return (
    <>
      <Descent
        hero={
          <>
            The record
            <br />
            outlasts
            <br />
            you
          </>
        }
        strata={STRATA}
        floor={
          <>
            <p className="t-mono text-glow">4 850 m · the floor · contact</p>
            <p className="t-display-sm mt-3 whitespace-nowrap text-ink">Still down here</p>
            <p className="t-say mt-4 max-w-[34ch]">
              One light, still burning, where a record was left for whoever came looking.
            </p>
            <Link
              href="/sign-in"
              className="mt-8 inline-flex bg-glow px-6 py-3 font-mono text-[.7rem] uppercase tracking-[.16em] text-abyss transition-colors hover:bg-[#5CFADF]"
            >
              Open a vault
            </Link>
          </>
        }
      />

      {/* ------------------------------------------------------- two channels */}
      <section className="edge-cut relative -mt-1 bg-abyss px-5 pb-24 pt-[max(7rem,9vw)] sm:px-[6vw]" style={{ ['--tilt' as string]: '-2.6deg' }}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>I · the arrangement</Eyebrow>
          <h2 className="t-display-sm tilted mt-10 text-ink" data-reveal>
            Two channels.
            <br />
            Neither opens
            <br />
            anything alone.
          </h2>

          <Hair className="my-12" />

          <div className="grid gap-10 sm:grid-cols-2 sm:pl-[3vw]">
            <div data-reveal>
              <p className="t-mono text-glow">channel one · held by us</p>
              <p className="t-say mt-4">
                The encrypted vault. Account access. Death verification. The audit log. All of it
                ciphertext, and none of it any use on its own.
              </p>
            </div>
            <div data-reveal style={{ transitionDelay: '.1s' }}>
              <p className="t-mono text-abyss">channel two · held by you</p>
              <p className="t-say mt-4">
                The passphrase. On paper, in a safe deposit box, your attorney&rsquo;s safe, a steel
                plate. Wherever you decide &mdash; we are never told.
              </p>
            </div>
          </div>

          <p className="t-say mt-14 max-w-[70ch] sm:pl-[7vw]" data-reveal>
            An executor with the passphrase and no account access holds ciphertext they cannot
            reach. A custodian with the sealed envelope cannot log in.{' '}
            <b>Someone who compromises our entire infrastructure gets encrypted blobs.</b>
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------- paper */}
      <section
        className="edge-cut relative -mt-1 px-5 pb-24 pt-[max(7rem,9vw)] sm:px-[6vw]"
        style={{ ['--tilt' as string]: '-4deg', background: 'linear-gradient(to bottom, #04070C, #060B13 60%, #04070C)' }}
      >
        <div className="mx-auto max-w-5xl">
          <Eyebrow>II · what survives</Eyebrow>
          <h2 className="t-display-sm tilted mt-10 max-w-[18ch] text-ink" data-reveal>
            The pressure
            <br />
            did not reach
            <br />
            the paper
          </h2>
        </div>

        {/* The one unrotated, warm object in the design. See the contract. */}
        <div className="level mt-16 flex justify-center">
          <article className="relative w-[min(560px,88vw)] bg-paper p-7 text-[#2A2419] shadow-[0_2px_0_rgba(0,0,0,.25),0_40px_120px_-30px_rgba(0,0,0,.95),0_0_90px_-20px_rgba(233,223,203,.18)] sm:p-10" data-reveal>
            <p className="font-mono text-[.6rem] uppercase tracking-[.18em] text-[#2A2419]/55">
              Vault passphrase &mdash; written copy
            </p>
            <p className="mt-3 font-display text-2xl leading-tight" style={{ fontVariationSettings: "'wght' 680, 'wdth' 102" }}>
              Twelve words. Written by hand.
            </p>
            <ol className="mt-6 grid list-none grid-cols-2 gap-x-5 gap-y-2.5 p-0 sm:grid-cols-3">
              {['witch','collapse','practice','feed','shame','open','despair','creek','road','again','ice','least']
                .map((w, i) => (
                  <li key={w} className="flex gap-2 border-b border-[#2A2419]/30 pb-1 font-mono text-[.9rem]">
                    <span className="min-w-[1.3em] text-[.68rem] text-[#2A2419]/40">{i + 1}</span>
                    {w}
                  </li>
                ))}
            </ol>
            <p className="mt-7 font-mono text-[.58rem] leading-[1.75] tracking-wide text-[#2A2419]/65">
              The sheet prints blank. You fill it in by hand, then type it back before the vault is
              created &mdash; so the paper provably exists first. Printing the words would push them
              through a spooler and onto a disk.
            </p>
          </article>
        </div>

        <div className="mx-auto mt-14 max-w-5xl">
          <p className="t-say ml-auto max-w-[52ch] text-right" data-reveal>
            Everything else on this page is tilted, because everything else is under load.{' '}
            <b>The paper is level.</b>
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- arithmetic */}
      <section className="edge-cut relative -mt-1 bg-abyss px-5 pb-24 pt-[max(7rem,9vw)] sm:px-[6vw]" style={{ ['--tilt' as string]: '-5.2deg' }}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>III · redundancy or split</Eyebrow>
          <h2 className="t-display-sm tilted mt-10 max-w-[20ch] text-ink" data-reveal>
            We show the arithmetic
          </h2>
          <p className="t-say mt-9 max-w-[72ch]" data-reveal>
            Split the phrase across custodians and two different numbers matter. The one that
            governs is what a coalition of <b>every holder but one</b> would still have to guess
            &mdash; because that is a house fire plus one cooperative relative.
          </p>

          <div className="mt-12 max-w-3xl border border-[#1B2A3C] sm:ml-[3vw]" data-reveal>
            {[
              ['12 words ÷ 2 parts', '77.5 bits · acceptable', ''],
              ['12 words ÷ 3 parts', '51.7 bits · marginal', 'text-warn'],
              ['12 words ÷ 4 parts', '38.8 bits · refused', 'text-danger'],
              ['15 words ÷ 3 parts', '64.6 bits · acceptable', ''],
              ['24 words ÷ 3 parts', '103.4 bits · strong', 'text-glow'],
            ].map(([label, value, tone]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#1B2A3C] px-5 py-4 last:border-b-0">
                <span className="text-[.95rem] text-ink/85">{label}</span>
                <span className={`font-mono text-[.8rem] tabular-nums ${tone || 'text-ink'}`}>{value}</span>
              </div>
            ))}
          </div>

          <p className="t-say mt-10 max-w-[72ch] sm:ml-[7vw]" data-reveal>
            Below forty bits the app <b>refuses</b> rather than warns. Splitting also means losing
            one part destroys access permanently &mdash; which makes it strictly more fragile than
            doing nothing.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- refusals */}
      <section className="relative -mt-1 bg-abyss px-5 pb-24 pt-[max(7rem,9vw)] sm:px-[6vw]" style={{ ['--tilt' as string]: '-6.4deg', clipPath: 'polygon(0 0, 100% 2.6vw, 100% 100%, 0 100%)' }}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>IV · the refusals</Eyebrow>
          <h2 className="t-display-sm tilted mt-10 text-ink" data-reveal>
            What we will
            <br />
            not build
          </h2>

          <div className="mt-12 max-w-3xl sm:ml-[3vw]">
            <Hair />
            {[
              ['Not a will generator.', 'We store what your attorney drafts. We never draft it.'],
              ['Not a custodian.', 'We cannot hold, move or spend your cryptocurrency.'],
              ['Not a hint system.', 'No riddles, no partial phrases. Cryptography, not obscurity.'],
              ['Not able to read your vault.', 'No server-side decryption path exists. Not for support, not for law enforcement, not for us.'],
              ['Not a password reset.', 'There cannot be one. Lose the paper and the vault is unreadable by anyone, permanently.'],
            ].map(([head, rest]) => (
              <div key={head}>
                <p className="t-say py-6" data-reveal>
                  <b>{head}</b> {rest}
                </p>
                <Hair />
              </div>
            ))}
          </div>
        </div>
      </section>

      <Page>
        <Card>
          <H2>We check that it still works</H2>
          <p className="t-say mt-4 max-w-[58ch]">
            Untested inheritance is not inheritance. Every year we ask you to confirm each custody
            point is reachable, and send you a dated report saying so. Anything unverified for
            eighteen months gets flagged, loudly.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" className="inline-flex bg-glow px-5 py-2.5 font-mono text-[.7rem] uppercase tracking-[.16em] text-abyss hover:bg-[#5CFADF]">
              Sign in
            </Link>
            <Link href="/legal/rufadaa" className="inline-flex border border-[#2A3B4F] px-5 py-2.5 font-mono text-[.7rem] uppercase tracking-[.16em] text-ink hover:border-glow/60 hover:text-glow">
              What your will needs to say first
            </Link>
          </div>
        </Card>
      </Page>
    </>
  );
}
