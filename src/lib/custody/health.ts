/**
 * The custody verification cycle. Spec §4.3.
 *
 * "Untested inheritance is not inheritance." The dashboard has to be able to say
 * what is stale and what is at risk *while the vault is locked*, which is why this
 * module takes only plaintext metadata and no decrypted detail.
 */

import {
  AT_RISK_AFTER_MONTHS,
  type CustodyPlanMeta,
  type CustodyPointMeta,
} from './types';

export type PointStatus = 'never_verified' | 'at_risk' | 'due' | 'ok';

export interface PointHealth {
  readonly pointId: string;
  readonly status: PointStatus;
  readonly lastVerifiedAt: string | null;
  readonly monthsSinceVerified: number | null;
  readonly nextDueAt: string | null;
}

export interface CustodyHealth {
  readonly pointCount: number;
  readonly okCount: number;
  readonly dueCount: number;
  readonly atRiskCount: number;
  readonly neverVerifiedCount: number;
  readonly points: readonly PointHealth[];
  /** True when the dashboard must show a prominent warning. Spec §4.3. */
  readonly needsAttention: boolean;
  /** Spec §4.4: the Executor Letter is out of date relative to the plan. */
  readonly letterOutOfDate: boolean;
  readonly letterNeverGenerated: boolean;
}

function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // Only count a month once its day-of-month has been reached.
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export function assessPoint(
  point: CustodyPointMeta,
  intervalMonths: number,
  now: Date,
): PointHealth {
  if (!point.lastVerifiedAt) {
    return {
      pointId: point.id,
      status: 'never_verified',
      lastVerifiedAt: null,
      monthsSinceVerified: null,
      nextDueAt: null,
    };
  }

  const verified = new Date(point.lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) {
    throw new Error(`Custody point ${point.id} has an unparseable lastVerifiedAt.`);
  }

  const months = monthsBetween(verified, now);
  const status: PointStatus =
    months >= AT_RISK_AFTER_MONTHS ? 'at_risk' : months >= intervalMonths ? 'due' : 'ok';

  return {
    pointId: point.id,
    status,
    lastVerifiedAt: point.lastVerifiedAt,
    monthsSinceVerified: months,
    nextDueAt: addMonths(verified, intervalMonths).toISOString(),
  };
}

export function assessCustodyHealth(
  plan: Pick<CustodyPlanMeta, 'verificationIntervalMonths' | 'planLastModifiedAt' | 'letterLastGeneratedAt'>,
  points: readonly CustodyPointMeta[],
  now: Date = new Date(),
): CustodyHealth {
  const assessed = points.map((p) => assessPoint(p, plan.verificationIntervalMonths, now));

  const count = (status: PointStatus) => assessed.filter((p) => p.status === status).length;
  const atRiskCount = count('at_risk');
  const neverVerifiedCount = count('never_verified');
  const dueCount = count('due');

  const letterNeverGenerated = !plan.letterLastGeneratedAt;
  const letterOutOfDate = isLetterOutOfDate(
    plan.letterLastGeneratedAt,
    plan.planLastModifiedAt,
  );

  return {
    pointCount: points.length,
    okCount: count('ok'),
    dueCount,
    atRiskCount,
    neverVerifiedCount,
    points: assessed,
    needsAttention:
      atRiskCount > 0 ||
      neverVerifiedCount > 0 ||
      dueCount > 0 ||
      points.length === 0 ||
      letterNeverGenerated ||
      letterOutOfDate,
    letterOutOfDate,
    letterNeverGenerated,
  };
}

/**
 * Spec §4.4: track `letter_last_generated_at` against `custody_plan_last_modified_at`
 * and warn on drift. An Executor Letter describing an arrangement that no longer
 * exists is worse than no letter — it sends the executor to a custodian who gave
 * the envelope back two years ago.
 */
export function isLetterOutOfDate(
  letterLastGeneratedAt: string | null,
  planLastModifiedAt: string | null,
): boolean {
  if (!letterLastGeneratedAt) return true;
  if (!planLastModifiedAt) return false;
  const letter = new Date(letterLastGeneratedAt).getTime();
  const plan = new Date(planLastModifiedAt).getTime();
  if (Number.isNaN(letter) || Number.isNaN(plan)) return true;
  return plan > letter;
}

/**
 * The annual custody health report (spec §4.3). Returned as a data structure; the
 * email transport belongs to build-order step 6 and is not implemented.
 *
 * The spec is right that this is the differentiator, so the shape is worth getting
 * down now: a dated statement that the arrangement was checked and is intact.
 */
export interface CustodyHealthReport {
  readonly generatedAt: string;
  readonly vaultId: string;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly health: CustodyHealth;
}

export function buildCustodyHealthReport(
  plan: CustodyPlanMeta,
  points: readonly CustodyPointMeta[],
  now: Date = new Date(),
): CustodyHealthReport {
  const health = assessCustodyHealth(plan, points, now);
  const lines: string[] = [];

  lines.push(`Custody points on record: ${health.pointCount}`);
  lines.push(`Arrangement: ${describeMode(plan)}`);
  lines.push(`Verification interval: every ${plan.verificationIntervalMonths} months`);

  for (const p of health.points) {
    const point = points.find((x) => x.id === p.pointId);
    const which =
      point?.holding === 'split_part' ? `part ${point.partIndex} of ${plan.partCount}` : 'full copy';
    switch (p.status) {
      case 'never_verified':
        lines.push(`• ${point?.pointType ?? 'point'} (${which}) — never verified`);
        break;
      case 'at_risk':
        lines.push(
          `• ${point?.pointType ?? 'point'} (${which}) — AT RISK, last verified ${p.monthsSinceVerified} months ago`,
        );
        break;
      case 'due':
        lines.push(
          `• ${point?.pointType ?? 'point'} (${which}) — due, last verified ${p.monthsSinceVerified} months ago`,
        );
        break;
      default:
        lines.push(
          `• ${point?.pointType ?? 'point'} (${which}) — verified ${p.monthsSinceVerified} months ago`,
        );
    }
  }

  if (health.letterNeverGenerated) {
    lines.push('• Executor Letter has never been generated. An executor has nothing to follow.');
  } else if (health.letterOutOfDate) {
    lines.push('• Executor Letter is older than the custody plan. Regenerate and reprint it.');
  }

  const headline = health.needsAttention
    ? `Your inheritance arrangement needs attention (${
        health.atRiskCount + health.neverVerifiedCount
      } point(s) at risk or unverified).`
    : 'Your inheritance arrangement was checked and is intact.';

  return { generatedAt: now.toISOString(), vaultId: plan.vaultId, headline, lines, health };
}

function describeMode(plan: CustodyPlanMeta): string {
  switch (plan.mode) {
    case 'split':
      return `passphrase split into ${plan.partCount} parts, all required`;
    case 'hybrid':
      return 'full copies in locations with different failure modes';
    default:
      return 'full copies (any one opens the vault)';
  }
}
