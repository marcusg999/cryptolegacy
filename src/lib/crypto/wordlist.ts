/**
 * The EFF long wordlist, as a frozen array of 7776 words indexed 0..7775.
 *
 * The list is vendored at `data/eff_large_wordlist.txt` and its SHA-256 is pinned
 * in `scripts/verify-wordlist.mjs`, which CI runs. See `data/WORDLIST_PROVENANCE.md`.
 *
 * It is generated into TypeScript rather than fetched at runtime so that no page
 * which generates a passphrase has to make a network request while doing it.
 */

import { WORDLIST_SIZE } from './constants';
import { EFF_LONG_WORDLIST } from './wordlist.generated';

if (EFF_LONG_WORDLIST.length !== WORDLIST_SIZE) {
  throw new Error(
    `Wordlist has ${EFF_LONG_WORDLIST.length} entries, expected ${WORDLIST_SIZE}. Refusing to generate passphrases.`,
  );
}

export const wordlist: readonly string[] = EFF_LONG_WORDLIST;

/** Index of a word, or -1. Used to validate a transcription. */
export function wordIndex(word: string): number {
  return indexMap.get(word) ?? -1;
}

const indexMap: ReadonlyMap<string, number> = new Map(
  EFF_LONG_WORDLIST.map((w, i) => [w, i] as const),
);

/**
 * Words that share a prefix with the given fragment. Used only by the
 * transcription-confirmation field to catch a typo while the user re-enters the
 * phrase from paper — it never suggests words for a phrase being *created*,
 * which would be a hint system (spec §1.1).
 */
export function wordsWithPrefix(prefix: string, limit = 8): readonly string[] {
  if (prefix.length < 2) return [];
  const out: string[] = [];
  for (const w of EFF_LONG_WORDLIST) {
    if (w.startsWith(prefix)) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}
