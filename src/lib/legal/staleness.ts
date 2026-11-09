/**
 * How old a piece of attorney-reviewed legal content is, and whether to say so.
 *
 * Spec §2.3: "Stale legal content is a liability, not a feature." The threshold
 * and the arithmetic live here, as a pure function of an explicit clock, so they
 * can be tested rather than inspected.
 */

/** Beyond this, the UI warns the reader that the review may no longer be current. */
export const REVIEW_STALE_AFTER_DAYS = 365;

const DAY_MS = 86_400_000;

export function reviewAgeInDays(lastReviewedAt: string | null, now: number): number | null {
  if (!lastReviewedAt) return null;
  const reviewed = Date.parse(lastReviewedAt);
  if (Number.isNaN(reviewed)) return null;
  return Math.floor((now - reviewed) / DAY_MS);
}

/**
 * Fails safe: content with no review date, or an unparseable one, is treated as
 * stale. An unknown review date is not evidence of freshness.
 */
export function isReviewStale(lastReviewedAt: string | null, now: number): boolean {
  const age = reviewAgeInDays(lastReviewedAt, now);
  if (age === null) return true;
  return age > REVIEW_STALE_AFTER_DAYS;
}
