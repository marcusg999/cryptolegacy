import { describe, expect, it } from 'vitest';

import {
  assessCustodyHealth,
  assessPoint,
  buildCustodyHealthReport,
  isLetterOutOfDate,
} from '@/lib/custody/health';
import { AT_RISK_AFTER_MONTHS, type CustodyPlanMeta, type CustodyPointMeta } from '@/lib/custody/types';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const monthsAgo = (n: number) => {
  const d = new Date(NOW.getTime());
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString();
};

const point = (over: Partial<CustodyPointMeta> = {}): CustodyPointMeta => ({
  id: crypto.randomUUID(),
  pointType: 'institution',
  holding: 'full_copy',
  partIndex: null,
  lastVerifiedAt: null,
  displayOrder: 0,
  ...over,
});

// Spread AFTER the defaults, so an explicit `null` override survives instead of
// being swallowed by `??`.
const plan = (over: Partial<CustodyPlanMeta> = {}): CustodyPlanMeta => ({
  vaultId: 'vault-1',
  mode: 'redundancy',
  passphraseWordCount: 12,
  partCount: 1,
  verificationIntervalMonths: 12,
  planLastModifiedAt: monthsAgo(10),
  letterLastGeneratedAt: monthsAgo(9),
  ...over,
});

describe('assessPoint', () => {
  it('reports a never-verified point', () => {
    const h = assessPoint(point({ lastVerifiedAt: null }), 12, NOW);
    expect(h.status).toBe('never_verified');
    expect(h.monthsSinceVerified).toBeNull();
    expect(h.nextDueAt).toBeNull();
  });

  it('is ok inside the interval', () => {
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(3) }), 12, NOW).status).toBe('ok');
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(11) }), 12, NOW).status).toBe('ok');
  });

  it('is due at the interval boundary', () => {
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(12) }), 12, NOW).status).toBe('due');
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(2) }), 3, NOW).status).toBe('ok');
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(3) }), 3, NOW).status).toBe('due');
  });

  it(`flags at risk beyond ${AT_RISK_AFTER_MONTHS} months regardless of interval`, () => {
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(17) }), 12, NOW).status).toBe('due');
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(18) }), 12, NOW).status).toBe('at_risk');
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(40) }), 12, NOW).status).toBe('at_risk');
    // Even a quarterly schedule only escalates to at-risk at 18 months.
    expect(assessPoint(point({ lastVerifiedAt: monthsAgo(18) }), 3, NOW).status).toBe('at_risk');
  });

  it('does not count a month until its day of month is reached', () => {
    const verified = '2025-06-20T00:00:00.000Z'; // 11 months + 26 days before NOW
    expect(assessPoint(point({ lastVerifiedAt: verified }), 12, NOW).monthsSinceVerified).toBe(11);
  });

  it('computes the next due date from the last verification', () => {
    const h = assessPoint(point({ lastVerifiedAt: '2026-01-10T00:00:00.000Z' }), 12, NOW);
    expect(h.nextDueAt?.slice(0, 10)).toBe('2027-01-10');
  });

  it('refuses an unparseable timestamp rather than silently treating it as fresh', () => {
    expect(() => assessPoint(point({ lastVerifiedAt: 'not a date' }), 12, NOW)).toThrow(
      /unparseable lastVerifiedAt/,
    );
  });
});

describe('assessCustodyHealth', () => {
  it('counts each status and stays quiet when everything is current', () => {
    const h = assessCustodyHealth(plan(), [
      point({ lastVerifiedAt: monthsAgo(2) }),
      point({ lastVerifiedAt: monthsAgo(5) }),
    ], NOW);
    expect(h.pointCount).toBe(2);
    expect(h.okCount).toBe(2);
    expect(h.needsAttention).toBe(false);
  });

  it('needs attention when any point is at risk', () => {
    const h = assessCustodyHealth(plan(), [
      point({ lastVerifiedAt: monthsAgo(2) }),
      point({ lastVerifiedAt: monthsAgo(24) }),
    ], NOW);
    expect(h.atRiskCount).toBe(1);
    expect(h.needsAttention).toBe(true);
  });

  it('needs attention when a point has never been verified', () => {
    const h = assessCustodyHealth(plan(), [point({ lastVerifiedAt: null })], NOW);
    expect(h.neverVerifiedCount).toBe(1);
    expect(h.needsAttention).toBe(true);
  });

  it('needs attention when there are no custody points at all', () => {
    const h = assessCustodyHealth(plan(), [], NOW);
    expect(h.pointCount).toBe(0);
    expect(h.needsAttention).toBe(true);
  });

  it('needs attention when the letter has never been generated', () => {
    const h = assessCustodyHealth(plan({ letterLastGeneratedAt: null }), [
      point({ lastVerifiedAt: monthsAgo(1) }),
    ], NOW);
    expect(h.letterNeverGenerated).toBe(true);
    expect(h.needsAttention).toBe(true);
  });

  it('needs attention when the plan has drifted ahead of the letter', () => {
    const h = assessCustodyHealth(
      plan({ planLastModifiedAt: monthsAgo(1), letterLastGeneratedAt: monthsAgo(6) }),
      [point({ lastVerifiedAt: monthsAgo(1) })],
      NOW,
    );
    expect(h.letterOutOfDate).toBe(true);
    expect(h.needsAttention).toBe(true);
  });
});

describe('isLetterOutOfDate', () => {
  it('is out of date when never generated', () => {
    expect(isLetterOutOfDate(null, monthsAgo(1))).toBe(true);
    expect(isLetterOutOfDate(null, null)).toBe(true);
  });

  it('is current when generated after the last plan change', () => {
    expect(isLetterOutOfDate(monthsAgo(1), monthsAgo(2))).toBe(false);
  });

  it('is out of date when the plan changed after it was generated', () => {
    expect(isLetterOutOfDate(monthsAgo(2), monthsAgo(1))).toBe(true);
  });

  it('treats a letter generated in the same instant as current', () => {
    const t = monthsAgo(1);
    expect(isLetterOutOfDate(t, t)).toBe(false);
  });

  it('fails safe on an unparseable timestamp', () => {
    expect(isLetterOutOfDate('nonsense', monthsAgo(1))).toBe(true);
    expect(isLetterOutOfDate(monthsAgo(1), 'nonsense')).toBe(true);
  });
});

describe('buildCustodyHealthReport', () => {
  it('sends the reassuring headline the spec wants when all is well', () => {
    const r = buildCustodyHealthReport(
      plan(),
      [point({ lastVerifiedAt: monthsAgo(1) }), point({ lastVerifiedAt: monthsAgo(2) })],
      NOW,
    );
    expect(r.headline).toBe('Your inheritance arrangement was checked and is intact.');
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.lines.join('\n')).toMatch(/Custody points on record: 2/);
    expect(r.lines.join('\n')).toMatch(/Verification interval: every 12 months/);
  });

  it('names what is at risk when something is', () => {
    const r = buildCustodyHealthReport(
      plan(),
      [point({ lastVerifiedAt: monthsAgo(30), pointType: 'person' })],
      NOW,
    );
    expect(r.headline).toMatch(/needs attention/);
    expect(r.lines.join('\n')).toMatch(/AT RISK, last verified 30 months ago/);
  });

  it('describes a split arrangement and which part each point holds', () => {
    const r = buildCustodyHealthReport(
      plan({ mode: 'split', partCount: 3, passphraseWordCount: 15 }),
      [
        point({ holding: 'split_part', partIndex: 1, lastVerifiedAt: monthsAgo(1) }),
        point({ holding: 'split_part', partIndex: 2, lastVerifiedAt: monthsAgo(1) }),
        point({ holding: 'split_part', partIndex: 3, lastVerifiedAt: monthsAgo(1) }),
      ],
      NOW,
    );
    const text = r.lines.join('\n');
    expect(text).toMatch(/passphrase split into 3 parts, all required/);
    expect(text).toMatch(/part 1 of 3/);
    expect(text).toMatch(/part 3 of 3/);
  });

  it('calls out a stale Executor Letter', () => {
    const r = buildCustodyHealthReport(
      plan({ planLastModifiedAt: monthsAgo(1), letterLastGeneratedAt: monthsAgo(5) }),
      [point({ lastVerifiedAt: monthsAgo(1) })],
      NOW,
    );
    expect(r.lines.join('\n')).toMatch(/Executor Letter is older than the custody plan/);
  });

  it('calls out a letter that was never generated', () => {
    const r = buildCustodyHealthReport(
      plan({ letterLastGeneratedAt: null }),
      [point({ lastVerifiedAt: monthsAgo(1) })],
      NOW,
    );
    expect(r.lines.join('\n')).toMatch(/never been generated/);
  });
});
