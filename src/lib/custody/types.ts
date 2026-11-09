/**
 * The custody plan: where the passphrase lives and who holds it. Spec §4.
 *
 * Note which half of each type is encrypted. Spec §4.1 is explicit that
 * "locations and custodian identities are stored inside the encrypted vault, not
 * as plaintext metadata", so the split here is load-bearing:
 *
 *   CustodyPointDetail  — label, custodian, address, notes.  ENCRYPTED. The server
 *                         stores one opaque blob and could not produce a treasure
 *                         map if it tried.
 *   CustodyPointMeta    — type, full-copy-or-part, dates.    PLAINTEXT. Enough to
 *                         flag an at-risk arrangement on the dashboard without an
 *                         unlock, and enough to tell an executor "a vault exists,
 *                         there were three custody points" after death
 *                         verification (spec §4.4).
 */

export const CUSTODY_POINT_TYPES = ['person', 'institution', 'location', 'other'] as const;
export type CustodyPointType = (typeof CUSTODY_POINT_TYPES)[number];

export const CUSTODY_HOLDINGS = ['full_copy', 'split_part'] as const;
export type CustodyHolding = (typeof CUSTODY_HOLDINGS)[number];

/** Spec §4.2. `hybrid` is full copies in locations with different failure modes. */
export const CUSTODY_MODES = ['redundancy', 'split', 'hybrid'] as const;
export type CustodyMode = (typeof CUSTODY_MODES)[number];

/** ENCRYPTED. Lives in the vault, wrapped by the master key. */
export interface CustodyPointDetail {
  readonly label: string;
  readonly custodianName?: string;
  readonly contact?: string;
  readonly locationNotes?: string;
  readonly notes?: string;
}

/** PLAINTEXT. Server-visible metadata. */
export interface CustodyPointMeta {
  readonly id: string;
  readonly pointType: CustodyPointType;
  readonly holding: CustodyHolding;
  /** 1-based part number when `holding === 'split_part'`, else null. */
  readonly partIndex: number | null;
  /** ISO 8601, or null if never verified. */
  readonly lastVerifiedAt: string | null;
  readonly displayOrder: number;
}

export interface CustodyPoint {
  readonly meta: CustodyPointMeta;
  readonly detail: CustodyPointDetail;
}

/** PLAINTEXT. One per vault. */
export interface CustodyPlanMeta {
  readonly vaultId: string;
  readonly mode: CustodyMode;
  /**
   * Words in the vault passphrase. This is metadata about the *shape* of the
   * secret, not the secret: it is the number the entropy arithmetic in the UI is
   * computed from, and it has to be readable while the vault is locked so the
   * dashboard can warn about a dangerous split. It narrows an attacker's search
   * space by nothing meaningful (12 vs 15 words), and SECURITY.md records it as a
   * deliberate, bounded disclosure rather than leaving it unstated.
   */
  readonly passphraseWordCount: number;
  /** Number of parts the phrase is split into. 1 when every point holds a full copy. */
  readonly partCount: number;
  /** Spec §4.3: default annual, configurable quarterly. */
  readonly verificationIntervalMonths: number;
  readonly planLastModifiedAt: string | null;
  readonly letterLastGeneratedAt: string | null;
}

export const DEFAULT_VERIFICATION_INTERVAL_MONTHS = 12;
export const ALLOWED_VERIFICATION_INTERVALS_MONTHS = [3, 6, 12] as const;

/** Spec §4.3: anything unverified for over 18 months is flagged at risk. */
export const AT_RISK_AFTER_MONTHS = 18;
