/**
 * Spec §2.4: the disclaimer is persistent, not one-time-at-signup.
 *
 * It renders in the root layout, so it is on every page including the video
 * recorder and the document vault — the two surfaces the spec calls out
 * specifically, because they are where a user is most likely to believe they
 * have just done something legally operative.
 *
 * `no-print` keeps it off the Executor Letter, which carries its own, stronger
 * statement in the letter body where an executor will actually read it.
 */
export function PersistentDisclaimer() {
  return (
    <footer className="no-print border-t border-ink-line/30 bg-ink text-paper">
      <div className="mx-auto max-w-5xl px-4 py-5 text-xs leading-relaxed">
        <p className="font-semibold uppercase tracking-wide">Not a law firm. Not legal advice.</p>
        <p className="mt-1 text-paper/80">
          This service does not draft legal documents and does not provide legal advice. Using it
          creates no attorney–client relationship. Nothing here is a will, a trust, a codicil or a
          beneficiary designation. A recorded video is not a will in most states — it is evidence
          of intent and capacity, which is valuable in a dispute but does not transfer anything.
          Consult an attorney licensed in your state before relying on any arrangement you set up
          here, and ask them to confirm your will or trust contains the digital-asset
          authorisation your executor will need.
        </p>
        <p className="mt-2 text-paper/60">
          We also never hold, move, or have the technical ability to spend your cryptocurrency, and
          we cannot read anything you store. Releasing assets to your executor does not route around
          probate: what is released still belongs to the estate.
        </p>
      </div>
    </footer>
  );
}
