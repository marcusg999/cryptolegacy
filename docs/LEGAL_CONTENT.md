# Legal content intake

Build specification §2.3:

> Source this from a verified legal database or attorney review, stored as
> versioned, citation-bearing content records. **Do not generate this content
> from model knowledge.** Each state record carries `last_reviewed_at`,
> `reviewed_by`, and source citations, surfaced in the UI. Stale legal content is
> a liability, not a feature.

## Current state

`legal.state_requirements` and `legal.guidance_documents` ship with **zero rows**.
Every state page therefore renders an empty state explaining that we do not have
attorney-reviewed content for that state yet, and pointing the user at a licensed
attorney.

That is the intended behaviour, not an unfinished migration. A confidently wrong
answer to "what makes a will valid in Nevada" would not surface as an error. It
would surface in probate court, after the user died, when nobody could ask them
what they meant.

## Why engineering cannot fill this in

Publishing a row requires, at the database level, all of:

- `last_reviewed_at`
- `reviewed_by` (non-empty)
- `reviewer_jurisdiction` (non-empty)
- at least one entry in `source_citations`
- at least one checklist item

The `published_rows_are_reviewed` check constraint enforces this. There is no way
to publish a row without naming a human who reviewed it and a source. That makes
"do not generate this from model knowledge" an enforceable property rather than
an aspiration.

## Intake process

1. Engage an attorney admitted in the target state.
2. They complete the checklist for that state: execution formalities, witness
   requirements and whether a witness may be a beneficiary, holographic will
   recognition, self-proving affidavit availability, remote online notarisation,
   electronic-wills act adoption, the state's digital-assets act and its citation,
   and anything the probate court requires on filing.
3. Insert as `status = 'draft'`, with citations to the statute sections, not to
   secondary summaries.
4. Internal review, then `status = 'in_review'`, then `'published'`.
5. The UI surfaces the reviewer, the jurisdiction, the date and the citations on
   every state page, and warns the reader when a review is over a year old.

## Versioning

Rows are versioned per state. Publishing a new version retires the old one; the
partial unique index `state_requirements_published_idx` allows exactly one
published row per state. History is kept, because an executor may need to know
what the app said at the time the user relied on it.

## Review cadence

Annual at minimum, and immediately on any legislative change in a covered state.
The UI's staleness warning fires at one year. A state whose review has lapsed
should be retired back to `in_review` rather than left published — showing the
empty state is better than showing stale law.

## What engineering may write without an attorney

The distinction worth holding: describing *our own product* is not legal advice.

- "Your will needs to authorise your executor to access digital assets — ask your
  attorney to draft it" is a product instruction. It names the problem without
  supplying the clause.
- A sample clause, a template, or "copy this wording into your will" is drafting
  a legal document, which is the unauthorised practice of law and is forbidden by
  spec §1.1.

`/legal/rufadaa` is written to stay on the correct side of that line. It says
what to ask for and why; it supplies no language.
