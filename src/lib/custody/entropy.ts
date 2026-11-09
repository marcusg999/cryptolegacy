/**
 * The redundancy-vs-split decision, with the arithmetic done rather than asserted.
 *
 * Spec §4.2 is the requirement and it is unusually specific, so the reasoning is
 * worth writing down once, here, where the numbers are produced.
 *
 * Splitting an n-word phrase into k parts gives each holder one part. Two
 * different attackers matter, and they are not the same number:
 *
 *   - A SINGLE holder who goes bad knows their own part. What they still have to
 *     guess is everything else: (n − their part) words. The worst case over all
 *     holders is the one holding the *largest* part.
 *
 *   - A COALITION of every holder but one — k−1 people, or one person who robs
 *     k−1 of the locations — knows all but one part. What they still have to guess
 *     is that one part, and the worst case is the *smallest* part.
 *
 * The coalition number is the one that governs, because it is always the smaller
 * of the two, and because "all but one" is exactly what a house fire plus a
 * cooperative relative looks like. For the spec's example — 12 words in three
 * 4-word parts — it is 4 × log2(7776) ≈ 51.7 bits, which is where the spec's
 * "roughly 50 bits unknown to any single holder" comes from.
 *
 * Splitting a short phrase is the failure this module exists to prevent: 12 words
 * into four parts leaves a coalition guessing 3 words ≈ 38.8 bits, which is
 * crackable, and the app refuses it.
 */

import { BITS_PER_WORD, RECOMMENDED_SPLIT_WORDS } from '@/lib/crypto/constants';

import type { CustodyMode, CustodyPointMeta } from './types';

/** Below this, the app refuses the split outright. */
export const REFUSE_BELOW_BITS = 40;
/** Below this, the split is allowed but called out as marginal. */
export const MARGINAL_BELOW_BITS = 64;
/** At or above this, the split is comfortable. */
export const STRONG_AT_OR_ABOVE_BITS = 80;

export type SplitVerdict = 'refused' | 'marginal' | 'acceptable' | 'strong';

export interface SplitAnalysis {
  readonly wordCount: number;
  readonly partCount: number;
  /** Words in each part, largest first. */
  readonly partSizes: readonly number[];
  readonly totalEntropyBits: number;
  /** Bits a coalition of every holder but one must still guess. The governing number. */
  readonly residualAgainstCoalitionBits: number;
  /** Bits the single worst-placed holder must still guess. */
  readonly residualAgainstSingleHolderBits: number;
  readonly verdict: SplitVerdict;
  /** True when the app must block the user from proceeding. */
  readonly refused: boolean;
  readonly findings: readonly string[];
  /** Smallest word count that would make this part count comfortable. */
  readonly wordsNeededForStrongSplit: number;
}

/**
 * Split `wordCount` words into `partCount` parts as evenly as possible.
 * Remainder words go to the earlier parts, so sizes are returned largest first.
 */
export function partSizes(wordCount: number, partCount: number): number[] {
  if (!Number.isInteger(wordCount) || wordCount <= 0) {
    throw new Error('Word count must be a positive integer.');
  }
  if (!Number.isInteger(partCount) || partCount <= 0) {
    throw new Error('Part count must be a positive integer.');
  }
  if (partCount > wordCount) {
    throw new Error(
      `Cannot split ${wordCount} words into ${partCount} parts — a part would be empty.`,
    );
  }
  const base = Math.floor(wordCount / partCount);
  const remainder = wordCount % partCount;
  return Array.from({ length: partCount }, (_, i) => (i < remainder ? base + 1 : base));
}

export function analyseSplit(wordCount: number, partCount: number): SplitAnalysis {
  const sizes = partSizes(wordCount, partCount);
  const smallest = Math.min(...sizes);
  const largest = Math.max(...sizes);

  const total = wordCount * BITS_PER_WORD;
  const coalition = smallest * BITS_PER_WORD;
  const singleHolder = (wordCount - largest) * BITS_PER_WORD;

  const findings: string[] = [];
  let verdict: SplitVerdict;

  if (partCount === 1) {
    verdict = 'strong';
    findings.push(
      'One part is not a split. Every holder of this part can open the vault alone.',
    );
  } else if (coalition < REFUSE_BELOW_BITS) {
    verdict = 'refused';
    findings.push(
      `Refused: ${partCount - 1} of these ${partCount} holders acting together would have to ` +
        `guess only ${smallest} word${smallest === 1 ? '' : 's'} — about ${coalition.toFixed(0)} bits. ` +
        `That is inside reach of an attacker with a GPU and your encrypted vault.`,
    );
  } else if (coalition < MARGINAL_BELOW_BITS) {
    verdict = 'marginal';
    findings.push(
      `Marginal: ${partCount - 1} holders acting together would face about ${coalition.toFixed(0)} bits. ` +
        `Expensive to break, but not comfortable. Use ${RECOMMENDED_SPLIT_WORDS} or more words.`,
    );
  } else if (coalition < STRONG_AT_OR_ABOVE_BITS) {
    verdict = 'acceptable';
    findings.push(
      `Acceptable: the worst case — every holder but one — still faces about ${coalition.toFixed(0)} bits.`,
    );
  } else {
    verdict = 'strong';
    findings.push(
      `Strong: even ${partCount - 1} holders acting together face about ${coalition.toFixed(0)} bits, ` +
        `which is not brute-forceable.`,
    );
  }

  if (partCount > 1) {
    findings.push(
      `Losing any one of the ${partCount} parts destroys access permanently. ` +
        `A split arrangement is more fragile than doing nothing at all if a part goes missing.`,
    );
    if (wordCount < RECOMMENDED_SPLIT_WORDS) {
      findings.push(
        `Recommended minimum for a split arrangement is ${RECOMMENDED_SPLIT_WORDS} words; ` +
          `this phrase has ${wordCount}.`,
      );
    }
    if (smallest !== largest) {
      findings.push(
        `Parts are uneven (${sizes.join(' / ')} words). The ${smallest}-word part is the weak link, ` +
          `because it is what remains unknown once the others are collected.`,
      );
    }
  }

  return {
    wordCount,
    partCount,
    partSizes: sizes,
    totalEntropyBits: total,
    residualAgainstCoalitionBits: coalition,
    residualAgainstSingleHolderBits: singleHolder,
    verdict,
    refused: verdict === 'refused',
    findings,
    // Round up the per-part word count FIRST, then multiply. Rounding the product
    // instead yields a count whose smallest part still falls short of the target.
    wordsNeededForStrongSplit: minimumWordsForSplit(partCount, STRONG_AT_OR_ABOVE_BITS),
  };
}

/** Smallest word count whose split into `partCount` parts clears `minBits` in the worst case. */
export function minimumWordsForSplit(
  partCount: number,
  minBits = MARGINAL_BELOW_BITS,
): number {
  const wordsPerPart = Math.ceil(minBits / BITS_PER_WORD);
  return wordsPerPart * partCount;
}

// ---------------------------------------------------------------------------
// Whole-plan review
// ---------------------------------------------------------------------------

export type PlanIssueSeverity = 'blocker' | 'warning' | 'note';

export interface PlanIssue {
  readonly severity: PlanIssueSeverity;
  readonly code: string;
  readonly message: string;
}

export interface PlanReview {
  readonly mode: CustodyMode;
  readonly issues: readonly PlanIssue[];
  readonly blocked: boolean;
  readonly split: SplitAnalysis | null;
}

export interface ReviewPlanInput {
  readonly mode: CustodyMode;
  readonly passphraseWordCount: number;
  readonly partCount: number;
  readonly points: readonly CustodyPointMeta[];
}

/**
 * Review a whole custody arrangement, not just the arithmetic.
 *
 * The checks that matter most are the boring structural ones: a split plan whose
 * parts do not add up, a "redundant" plan whose two copies are in the same
 * building, a plan with one custody point and nothing else. Those are the
 * arrangements that fail silently years later, which §4.3 identifies as the thing
 * every product in this category gets wrong.
 */
export function reviewPlan(input: ReviewPlanInput): PlanReview {
  const issues: PlanIssue[] = [];
  const { mode, points, partCount, passphraseWordCount } = input;

  const fullCopies = points.filter((p) => p.holding === 'full_copy');
  const parts = points.filter((p) => p.holding === 'split_part');

  if (points.length === 0) {
    issues.push({
      severity: 'blocker',
      code: 'no_points',
      message:
        'No custody points. Nobody and nowhere holds the passphrase, so this vault cannot be inherited.',
    });
  }

  let split: SplitAnalysis | null = null;

  if (mode === 'split') {
    if (partCount < 2) {
      issues.push({
        severity: 'blocker',
        code: 'split_needs_two_parts',
        message: 'A split arrangement needs at least two parts.',
      });
    } else if (partCount > passphraseWordCount) {
      issues.push({
        severity: 'blocker',
        code: 'more_parts_than_words',
        message: `Cannot split ${passphraseWordCount} words into ${partCount} parts — a part would be empty.`,
      });
    } else {
      split = analyseSplit(passphraseWordCount, partCount);
      if (split.refused) {
        issues.push({
          severity: 'blocker',
          code: 'split_entropy_too_low',
          message: split.findings[0] as string,
        });
      } else if (split.verdict === 'marginal') {
        issues.push({ severity: 'warning', code: 'split_entropy_marginal', message: split.findings[0] as string });
      }
    }

    if (fullCopies.length > 0) {
      issues.push({
        severity: 'blocker',
        code: 'split_has_full_copy',
        message:
          `${fullCopies.length} custody point(s) hold a full copy in a split arrangement. ` +
          'A single full copy defeats the entire point of splitting — that holder can act alone.',
      });
    }

    const covered = new Set(parts.map((p) => p.partIndex).filter((i): i is number => i !== null));
    const expected = Array.from({ length: partCount }, (_, i) => i + 1);
    const missing = expected.filter((i) => !covered.has(i));
    if (missing.length > 0) {
      issues.push({
        severity: 'blocker',
        code: 'parts_unassigned',
        message: `Part${missing.length === 1 ? '' : 's'} ${missing.join(', ')} of ${partCount} ${
          missing.length === 1 ? 'has' : 'have'
        } no custody point. The vault cannot be opened as planned.`,
      });
    }
    if (parts.some((p) => p.partIndex === null)) {
      issues.push({
        severity: 'blocker',
        code: 'part_without_index',
        message: 'A custody point is marked as holding a part but has no part number.',
      });
    }
    const duplicated = expected.filter(
      (i) => parts.filter((p) => p.partIndex === i).length > 1,
    );
    if (duplicated.length > 0) {
      issues.push({
        severity: 'note',
        code: 'part_duplicated',
        message:
          `Part${duplicated.length === 1 ? '' : 's'} ${duplicated.join(', ')} ${
            duplicated.length === 1 ? 'is' : 'are'
          } held in more than one place. ` +
          'That protects against losing the part, and it means those holders are interchangeable.',
      });
    }
  }

  if (mode === 'redundancy' || mode === 'hybrid') {
    if (parts.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'redundancy_has_parts',
        message:
          `${parts.length} custody point(s) hold only a part of the passphrase in a full-copy ` +
          'arrangement. Those points cannot open the vault on their own, so they do not protect against loss.',
      });
    }
    if (fullCopies.length === 1) {
      issues.push({
        severity: 'warning',
        code: 'single_copy',
        message:
          'Only one full copy exists. A fire, a flood, a lost key or a bank closing the box ends ' +
          'access permanently. Loss is far more likely than betrayal — add a second location.',
      });
    }
    if (fullCopies.length >= 4) {
      issues.push({
        severity: 'note',
        code: 'many_copies',
        message:
          `${fullCopies.length} full copies exist. Each one is a place the passphrase can be stolen ` +
          'from and a person who could act alone. Two in independent locations is usually the right number.',
      });
    }
  }

  // Correlated failure: copies that all die in the same event.
  if (fullCopies.length >= 2) {
    const types = new Set(fullCopies.map((p) => p.pointType));
    if (types.size === 1 && fullCopies[0]?.pointType === 'location') {
      issues.push({
        severity: 'warning',
        code: 'correlated_failure_modes',
        message:
          'Every full copy is at a physical location you control. A house fire or a burglary can ' +
          'take all of them at once. Pair one with an independent institution — a bank box or an ' +
          "attorney's safe — so the two fail for different reasons.",
      });
    }
  }

  if (mode === 'hybrid' && fullCopies.length >= 2) {
    const types = new Set(fullCopies.map((p) => p.pointType));
    if (types.size >= 2) {
      issues.push({
        severity: 'note',
        code: 'hybrid_ok',
        message:
          'Two or more full copies with different failure modes. This survives a house fire, ' +
          'survives one custodian going dark, and needs no coordination to use.',
      });
    }
  }

  return {
    mode,
    issues,
    blocked: issues.some((i) => i.severity === 'blocker'),
    split,
  };
}
