/**
 * A safety net for the one mistake that silently destroys the whole security model:
 * a user pasting their passphrase into a note inside the vault.
 *
 * The vault is encrypted *by* the passphrase. Storing the passphrase in it is not
 * merely redundant — it hands anyone who gets one of the custody copies, or who
 * compromises an unlocked session, both the lock and the key, and it puts the
 * phrase somewhere our backups retain. The spec's standing rule is that the
 * passphrase never leaves the browser; it must not take the long way round and
 * come back as content either.
 *
 * Detection is by run length: a sequence of consecutive EFF-long-list words is the
 * signature of a diceware phrase. Ordinary English prose does hit the list — it
 * contains "safe", "box", "office" and so on — so a short run means nothing and a
 * long one is unambiguous. Thresholds are deliberately far apart, and measured
 * against real custody-note prose in the tests rather than guessed.
 */

import { wordIndex } from '@/lib/crypto/wordlist';

/** At or above this many consecutive list words, warn the user. */
export const WARN_RUN_LENGTH = 5;
/** At or above this many, refuse to store the text at all. */
export const BLOCK_RUN_LENGTH = 8;

export interface PassphraseLikeScan {
  readonly longestRun: number;
  /** Index of the first word of the longest run, in the tokenised text. */
  readonly startIndex: number;
  readonly warn: boolean;
  readonly block: boolean;
}

/**
 * Tokenise text into candidate wordlist words.
 *
 * The hyphen needs care, because it plays two roles. Four of the EFF words
 * contain one (`t-shirt`, `yo-yo`, `drop-down`, `felt-tip`), so a hyphen inside a
 * word must be preserved. But people also *delimit* diceware phrases with
 * hyphens — `witch-collapse-practice-feed` and `witch - collapse - practice` are
 * both common — and treating the hyphen as part of the word there would hide a
 * pasted passphrase from this check entirely.
 *
 * So: keep a token whole if it is a list word (catching `t-shirt`), otherwise
 * break it on hyphens and consider the pieces (catching the delimiter case).
 * A token of nothing but hyphens is a separator and is dropped without breaking
 * the run — `a - b` must read as a run of two, not two runs of one.
 */
export function tokenise(text: string): string[] {
  const out: string[] = [];
  const raw = text.toLowerCase().normalize('NFKD').split(/[^a-z-]+/);

  for (const token of raw) {
    const trimmed = token.replace(/^-+|-+$/g, '');
    if (trimmed.length === 0) continue;
    if (wordIndex(trimmed) >= 0) {
      out.push(trimmed);
      continue;
    }
    const pieces = trimmed.split('-').filter((p) => p.length > 0);
    out.push(...pieces);
  }
  return out;
}

export function scanForPassphraseLikeRun(text: string): PassphraseLikeScan {
  const tokens = tokenise(text);

  let longestRun = 0;
  let startIndex = -1;
  let run = 0;
  let runStart = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    if (wordIndex(tokens[i] as string) >= 0) {
      if (run === 0) runStart = i;
      run += 1;
      if (run > longestRun) {
        longestRun = run;
        startIndex = runStart;
      }
    } else {
      run = 0;
    }
  }

  return {
    longestRun,
    startIndex,
    warn: longestRun >= WARN_RUN_LENGTH,
    block: longestRun >= BLOCK_RUN_LENGTH,
  };
}

export class PassphraseInContentError extends Error {
  readonly longestRun: number;
  constructor(longestRun: number, where: string) {
    super(
      `${where} contains ${longestRun} consecutive words from the passphrase wordlist. ` +
        'This looks like your vault passphrase. The passphrase must never be stored in the vault ' +
        'it unlocks, or anywhere this app can reach — it belongs only on paper, in the places ' +
        'your custody plan names. Remove it and try again.',
    );
    this.name = 'PassphraseInContentError';
    this.longestRun = longestRun;
  }
}

/**
 * Throw if the text looks like it contains a passphrase. Call this before sealing
 * any user-authored content into the vault.
 */
export function assertNoPassphraseInContent(text: string, where = 'This field'): void {
  const scan = scanForPassphraseLikeRun(text);
  if (scan.block) throw new PassphraseInContentError(scan.longestRun, where);
}
