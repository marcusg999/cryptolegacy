import { describe, expect, it } from 'vitest';

import {
  MARGINAL_BELOW_BITS,
  REFUSE_BELOW_BITS,
  analyseSplit,
  minimumWordsForSplit,
  partSizes,
  reviewPlan,
} from '@/lib/custody/entropy';
import type { CustodyPointMeta } from '@/lib/custody/types';

const point = (over: Partial<CustodyPointMeta> = {}): CustodyPointMeta => ({
  id: over.id ?? crypto.randomUUID(),
  pointType: over.pointType ?? 'institution',
  holding: over.holding ?? 'full_copy',
  partIndex: over.partIndex ?? null,
  lastVerifiedAt: over.lastVerifiedAt ?? null,
  displayOrder: over.displayOrder ?? 0,
});

describe('partSizes', () => {
  it('splits evenly when it divides', () => {
    expect(partSizes(12, 3)).toEqual([4, 4, 4]);
    expect(partSizes(15, 3)).toEqual([5, 5, 5]);
    expect(partSizes(24, 2)).toEqual([12, 12]);
  });

  it('gives the remainder to the earlier parts', () => {
    expect(partSizes(13, 3)).toEqual([5, 4, 4]);
    expect(partSizes(14, 3)).toEqual([5, 5, 4]);
    expect(partSizes(12, 5)).toEqual([3, 3, 2, 2, 2]);
  });

  it('refuses to create an empty part', () => {
    expect(() => partSizes(3, 4)).toThrow(/a part would be empty/);
  });

  it('refuses nonsense inputs', () => {
    expect(() => partSizes(0, 1)).toThrow(/positive integer/);
    expect(() => partSizes(12, 0)).toThrow(/positive integer/);
    expect(() => partSizes(12.5, 2)).toThrow(/positive integer/);
  });
});

describe('analyseSplit — the arithmetic the spec asks to be shown, not asserted', () => {
  it('reproduces the specs worked example: 12 words in 3 parts leaves ~50 bits', () => {
    const a = analyseSplit(12, 3);
    expect(a.partSizes).toEqual([4, 4, 4]);
    expect(a.totalEntropyBits).toBeCloseTo(155.1, 1);
    // Two of three holders together still face 4 words.
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(51.7, 1);
    // One holder alone still faces 8 words.
    expect(a.residualAgainstSingleHolderBits).toBeCloseTo(103.4, 1);
    expect(a.verdict).toBe('marginal');
    expect(a.refused).toBe(false);
  });

  it('refuses 12 words in 4 parts — 3 words is crackable', () => {
    const a = analyseSplit(12, 4);
    expect(a.partSizes).toEqual([3, 3, 3, 3]);
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(38.8, 1);
    expect(a.residualAgainstCoalitionBits).toBeLessThan(REFUSE_BELOW_BITS);
    expect(a.verdict).toBe('refused');
    expect(a.refused).toBe(true);
    expect(a.findings[0]).toMatch(/Refused/);
  });

  it('refuses any split whose weakest part falls below the floor', () => {
    for (const [words, parts] of [
      [12, 5],
      [12, 6],
      [15, 6],
      [20, 8],
      [36, 15],
    ] as const) {
      const a = analyseSplit(words, parts);
      if (a.residualAgainstCoalitionBits < REFUSE_BELOW_BITS) {
        expect(a.refused).toBe(true);
      }
    }
  });

  it('accepts the specs recommended 15 words in 3 parts', () => {
    const a = analyseSplit(15, 3);
    expect(a.partSizes).toEqual([5, 5, 5]);
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(64.6, 1);
    expect(a.residualAgainstCoalitionBits).toBeGreaterThanOrEqual(MARGINAL_BELOW_BITS);
    expect(a.verdict).toBe('acceptable');
    expect(a.refused).toBe(false);
  });

  it('calls a generous split strong', () => {
    const a = analyseSplit(24, 2);
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(155.1, 1);
    expect(a.verdict).toBe('strong');
  });

  it('always warns that losing one part is permanent', () => {
    for (const parts of [2, 3, 4]) {
      const a = analyseSplit(24, parts);
      expect(a.findings.join(' ')).toMatch(/destroys access permanently/);
    }
  });

  it('recommends 15+ words whenever a split is chosen with fewer', () => {
    expect(analyseSplit(12, 2).findings.join(' ')).toMatch(/Recommended minimum for a split/);
    expect(analyseSplit(15, 3).findings.join(' ')).not.toMatch(/Recommended minimum for a split/);
  });

  it('identifies the weak link when parts are uneven', () => {
    const a = analyseSplit(16, 3);
    expect(a.partSizes).toEqual([6, 5, 5]);
    // The coalition case is governed by the smallest part, not the average.
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(5 * 12.9248, 2);
    expect(a.findings.join(' ')).toMatch(/weak link/);
  });

  it('treats a one-part "split" as no split and says so plainly', () => {
    const a = analyseSplit(12, 1);
    expect(a.findings[0]).toMatch(/One part is not a split/);
    expect(a.residualAgainstCoalitionBits).toBeCloseTo(155.1, 1);
  });

  it('is monotonic: more parts never increases the governing residual', () => {
    let previous = Infinity;
    for (let parts = 1; parts <= 12; parts += 1) {
      const a = analyseSplit(24, parts);
      expect(a.residualAgainstCoalitionBits).toBeLessThanOrEqual(previous);
      previous = a.residualAgainstCoalitionBits;
    }
  });

  it('reports the word count that would make the split strong', () => {
    const a = analyseSplit(12, 3);
    expect(a.wordsNeededForStrongSplit).toBe(21);
    expect(analyseSplit(21, 3).residualAgainstCoalitionBits).toBeGreaterThanOrEqual(80);
  });

  it('wordsNeededForStrongSplit actually produces a strong split for every part count', () => {
    // Guards the rounding bug: ceil(bits/word * parts) gives a count whose
    // smallest part is still short, because the remainder lands on other parts.
    for (let parts = 2; parts <= 12; parts += 1) {
      const needed = analyseSplit(parts * 2, parts).wordsNeededForStrongSplit;
      const check = analyseSplit(needed, parts);
      expect(check.residualAgainstCoalitionBits).toBeGreaterThanOrEqual(80);
      expect(check.verdict).toBe('strong');
    }
  });
});

describe('minimumWordsForSplit', () => {
  it('gives the smallest word count clearing the marginal threshold', () => {
    expect(minimumWordsForSplit(2)).toBe(10);
    expect(minimumWordsForSplit(3)).toBe(15);
    expect(minimumWordsForSplit(4)).toBe(20);
    for (const parts of [2, 3, 4, 5]) {
      const words = minimumWordsForSplit(parts);
      expect(analyseSplit(words, parts).refused).toBe(false);
      expect(analyseSplit(words, parts).residualAgainstCoalitionBits).toBeGreaterThanOrEqual(64);
    }
  });
});

describe('reviewPlan — split mode', () => {
  const splitPoints = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      point({ holding: 'split_part', partIndex: i + 1, displayOrder: i }),
    );

  it('passes a well-formed 15-word, 3-part plan', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 3,
      points: splitPoints(3),
    });
    expect(r.blocked).toBe(false);
    expect(r.split?.verdict).toBe('acceptable');
  });

  it('blocks a split with an unassigned part', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 3,
      points: splitPoints(2),
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('parts_unassigned');
    expect(r.issues.find((i) => i.code === 'parts_unassigned')?.message).toMatch(/Part 3 of 3/);
  });

  it('blocks a split containing a full copy — one holder could act alone', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 3,
      points: [...splitPoints(3), point({ holding: 'full_copy' })],
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('split_has_full_copy');
  });

  it('blocks a split whose entropy is too low', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 12,
      partCount: 4,
      points: splitPoints(4),
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('split_entropy_too_low');
  });

  it('blocks more parts than words', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 3,
      partCount: 4,
      points: splitPoints(4),
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('more_parts_than_words');
  });

  it('blocks a one-part split', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 12,
      partCount: 1,
      points: splitPoints(1),
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('split_needs_two_parts');
  });

  it('blocks a part-holding point with no part number', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 2,
      points: [
        point({ holding: 'split_part', partIndex: 1 }),
        point({ holding: 'split_part', partIndex: 2 }),
        point({ holding: 'split_part', partIndex: null }),
      ],
    });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('part_without_index');
  });

  it('notes, without blocking, a part held in two places', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 2,
      points: [
        point({ holding: 'split_part', partIndex: 1 }),
        point({ holding: 'split_part', partIndex: 1 }),
        point({ holding: 'split_part', partIndex: 2 }),
      ],
    });
    expect(r.blocked).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('part_duplicated');
  });

  it('flags a marginal split as a warning rather than a block', () => {
    const r = reviewPlan({
      mode: 'split',
      passphraseWordCount: 12,
      partCount: 3,
      points: splitPoints(3),
    });
    expect(r.blocked).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('split_entropy_marginal');
  });
});

describe('reviewPlan — redundancy and hybrid', () => {
  it('warns about a single copy, because loss beats betrayal on probability', () => {
    const r = reviewPlan({
      mode: 'redundancy',
      passphraseWordCount: 12,
      partCount: 1,
      points: [point({ holding: 'full_copy' })],
    });
    expect(r.blocked).toBe(false);
    const issue = r.issues.find((i) => i.code === 'single_copy');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toMatch(/Loss is far more likely than betrayal/);
  });

  it('passes two copies without complaint', () => {
    const r = reviewPlan({
      mode: 'redundancy',
      passphraseWordCount: 12,
      partCount: 1,
      points: [
        point({ holding: 'full_copy', pointType: 'institution' }),
        point({ holding: 'full_copy', pointType: 'person' }),
      ],
    });
    expect(r.blocked).toBe(false);
    expect(r.issues.map((i) => i.code)).not.toContain('single_copy');
  });

  it('notes the growing theft surface at four or more copies', () => {
    const r = reviewPlan({
      mode: 'redundancy',
      passphraseWordCount: 12,
      partCount: 1,
      points: Array.from({ length: 4 }, () => point({ holding: 'full_copy' })),
    });
    expect(r.issues.map((i) => i.code)).toContain('many_copies');
  });

  it('warns when every copy is somewhere the same fire could reach', () => {
    const r = reviewPlan({
      mode: 'redundancy',
      passphraseWordCount: 12,
      partCount: 1,
      points: [
        point({ holding: 'full_copy', pointType: 'location' }),
        point({ holding: 'full_copy', pointType: 'location' }),
      ],
    });
    expect(r.issues.map((i) => i.code)).toContain('correlated_failure_modes');
  });

  it('endorses the hybrid the spec recommends', () => {
    const r = reviewPlan({
      mode: 'hybrid',
      passphraseWordCount: 12,
      partCount: 1,
      points: [
        point({ holding: 'full_copy', pointType: 'person' }),
        point({ holding: 'full_copy', pointType: 'institution' }),
      ],
    });
    expect(r.blocked).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('hybrid_ok');
  });

  it('warns when a full-copy plan contains a stray part', () => {
    const r = reviewPlan({
      mode: 'redundancy',
      passphraseWordCount: 12,
      partCount: 1,
      points: [
        point({ holding: 'full_copy' }),
        point({ holding: 'full_copy' }),
        point({ holding: 'split_part', partIndex: 1 }),
      ],
    });
    expect(r.issues.map((i) => i.code)).toContain('redundancy_has_parts');
  });

  it('blocks an empty plan in every mode', () => {
    for (const mode of ['redundancy', 'split', 'hybrid'] as const) {
      const r = reviewPlan({ mode, passphraseWordCount: 12, partCount: 1, points: [] });
      expect(r.blocked).toBe(true);
      expect(r.issues.map((i) => i.code)).toContain('no_points');
    }
  });
});
