import { describe, expect, it } from 'vitest';

import {
  REVIEW_STALE_AFTER_DAYS,
  isReviewStale,
  reviewAgeInDays,
} from '@/lib/legal/staleness';

const NOW = Date.parse('2026-11-09T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('reviewAgeInDays', () => {
  it('counts whole days since the review', () => {
    expect(reviewAgeInDays(daysAgo(0), NOW)).toBe(0);
    expect(reviewAgeInDays(daysAgo(30), NOW)).toBe(30);
    expect(reviewAgeInDays(daysAgo(400), NOW)).toBe(400);
  });

  it('is null when there is no review date', () => {
    expect(reviewAgeInDays(null, NOW)).toBeNull();
  });

  it('is null for an unparseable date rather than NaN', () => {
    expect(reviewAgeInDays('sometime last year', NOW)).toBeNull();
  });
});

describe('isReviewStale', () => {
  it('is fresh inside a year', () => {
    expect(isReviewStale(daysAgo(1), NOW)).toBe(false);
    expect(isReviewStale(daysAgo(REVIEW_STALE_AFTER_DAYS), NOW)).toBe(false);
  });

  it('is stale beyond a year', () => {
    expect(isReviewStale(daysAgo(REVIEW_STALE_AFTER_DAYS + 1), NOW)).toBe(true);
    expect(isReviewStale(daysAgo(1000), NOW)).toBe(true);
  });

  it('fails safe: no review date is stale, not fresh', () => {
    // An unknown review date is not evidence of freshness, and legal content we
    // cannot date is exactly what spec §2.3 calls a liability.
    expect(isReviewStale(null, NOW)).toBe(true);
    expect(isReviewStale('not a date', NOW)).toBe(true);
    expect(isReviewStale('', NOW)).toBe(true);
  });
});
