/**
 * Spec §2.4: persistent, not one-time-at-signup.
 *
 * It renders in the root layout, so it is on every page including the document
 * vault and the video recorder — the two surfaces the spec names, because they
 * are where a user is most likely to believe they have just done something
 * legally operative.
 *
 * `no-print` keeps it off the Executor Letter, which carries its own stronger
 * statement in the letter body where an executor will actually read it.
 */
export function PersistentDisclaimer() {
  return (
    <footer className="no-print border-t border-[#16222F] bg-[#06090F]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[.64rem] uppercase tracking-[.2em] text-muted">
          Not a law firm · Not legal advice
        </p>
        <p className="mt-4 max-w-[78ch] text-[.84rem] leading-relaxed text-muted">
          This service does not draft legal documents and does not provide legal advice. Using it
          creates no attorney&ndash;client relationship. Nothing here is a will, a trust, a codicil
          or a beneficiary designation. A recorded video is not a will in most states &mdash; it is
          evidence of intent and capacity, which is valuable in a dispute but does not transfer
          anything. Consult an attorney licensed in your state before relying on any arrangement
          you set up here, and ask them to confirm your will or trust contains the digital-asset
          authorisation your executor will need.
        </p>
        <p className="mt-4 max-w-[78ch] text-[.84rem] leading-relaxed text-muted/70">
          We also never hold, move, or have the technical ability to spend your cryptocurrency, and
          we cannot read anything you store. Releasing assets to your executor does not route
          around probate: what is released still belongs to the estate.
        </p>
      </div>
    </footer>
  );
}
