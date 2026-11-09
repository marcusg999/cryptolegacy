import Link from 'next/link';

import { Card, H1, H2, Lead, Page } from '@/components/ui';

/**
 * Spec §2.1: the app must tell the user their will needs explicit digital-asset
 * authorisation, and that their attorney must draft it. It must not draft it.
 *
 * So this page contains no sample clause, no fill-in-the-blanks template and no
 * "copy this wording". Supplying language for a will is drafting a will, which
 * is the unauthorised practice of law, and a clause we wrote that turned out to
 * be defective in the user's state would be a harm we caused.
 *
 * What it does instead is tell the user what to ask for, why their executor is
 * stuck without it, and what to take to the appointment. That is the useful part
 * and it is squarely within what a non-lawyer may say.
 */
export default function RufadaaPage() {
  return (
    <Page>
      <H1>What your will needs to say before any of this works</H1>
      <Lead>
        Encrypting your vault and arranging custody of the passphrase solves the technical problem.
        It does not, on its own, give your executor the legal authority to use what you have
        arranged. That part happens in your will or trust, and it has to be drafted by an attorney.
      </Lead>

      <div className="mt-8 space-y-6">
        <Card tone="warn">
          <H2>The problem, plainly</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            Nearly every US state has adopted a version of the Revised Uniform Fiduciary Access to
            Digital Assets Act. It governs whether someone acting as your fiduciary — your
            executor, your trustee, your agent under a power of attorney — may lawfully access your
            digital assets and accounts after your death or incapacity.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            The practical consequence is uncomfortable: if your will does not contain explicit
            authorisation covering digital assets, an executor who signs into this vault and reads
            your records may be acting outside their authority. Depending on the facts and the
            state, that can be argued to run afoul of computer-misuse statutes — the same body of
            law aimed at unauthorised account access generally.
          </p>
          <p className="mt-2 text-sm font-medium text-ink">
            In other words, the person you are relying on could be put in a position where doing
            what you wanted exposes them to a risk you did not intend. The fix is cheap and it
            happens at your attorney&rsquo;s desk, not here.
          </p>
        </Card>

        <Card>
          <H2>What to ask your attorney for</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            We are not a law firm and we will not draft this for you — language that is right in one
            state can be defective in another, and a clause supplied by a software company is
            exactly the kind of thing that gets litigated. Ask your attorney to address, in your
            will or trust:
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink/80">
            <li>
              — Express fiduciary authority over your <strong>digital assets</strong> and the
              <strong> content of electronic communications</strong>, under your state&rsquo;s
              digital-assets act. Those are treated differently from one another in the statute, and
              the broader one is the one that is easy to omit.
            </li>
            <li>
              — Whether the authority should extend to your <strong>agent under a power of
              attorney</strong> during incapacity, not only to your executor after death. An
              incapacity that lasts years is a more common scenario than a sudden death.
            </li>
            <li>
              — How the authority interacts with any{' '}
              <strong>online tool</strong> you have used to direct what happens to an account.
              Under the act, a provider&rsquo;s own tool can override what your will says.
            </li>
            <li>
              — Whether your fiduciary is authorised to take possession of{' '}
              <strong>cryptographic keys, hardware wallets and recovery material</strong>{' '}
              specifically, rather than only &ldquo;accounts&rdquo;. A hardware wallet in a drawer is
              not an account with a provider.
            </li>
            <li>
              — Whether your state has adopted an <strong>electronic wills</strong> act, and what
              that means for the formalities your will must satisfy.
            </li>
          </ul>
        </Card>

        <Card>
          <H2>What to bring to the appointment</H2>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/80">
            <li>
              — Your asset inventory from this vault. It lists what exists and roughly what it is
              worth, with no key material in it, so it is safe to hand to an attorney.
            </li>
            <li>
              — Your Executor Letter, so your attorney can confirm it matches the will and will be
              stored with it.
            </li>
            <li>
              — The names of your executor and any attestors, and whether they are the same people
              who hold your passphrase. Often they should not be.
            </li>
          </ul>
        </Card>

        <Card>
          <H2>A recorded video is not a will</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            Most states require a will to be written, signed and witnessed. A minority have adopted
            electronic-will legislation. A video of you saying what you want is generally admissible
            as <strong>evidence of testamentary intent and capacity</strong> — which is genuinely
            valuable, because the most common way a will gets attacked is a claim that you lacked
            capacity or were under someone&rsquo;s influence when you signed it.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            But it is evidence about the instrument, not the instrument. If you record a video and
            skip the will, you have most likely died intestate with a very clear film of what you
            wanted and no legal mechanism to deliver it.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            Where video earns its place: explaining <em>why</em> a distribution is uneven. That
            prevents litigation far more effectively than the distribution clause itself, because
            most contests are started by someone who felt blindsided rather than cheated.
          </p>
        </Card>

        <Card>
          <H2>State-specific requirements</H2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            We maintain a checklist of what makes a will valid in each state — witnessing
            requirements, whether a handwritten will is recognised, whether remote online
            notarisation is available, what the probate court expects. Every entry carries its
            source citations, the date it was last reviewed and who reviewed it.
          </p>
          <p className="mt-3 text-sm">
            <Link href="/legal/CA" className="underline">
              Look up your state
            </Link>
          </p>
        </Card>
      </div>
    </Page>
  );
}
