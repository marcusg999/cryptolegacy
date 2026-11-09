/**
 * Diceware passphrase generation and entropy accounting.
 *
 * Spec §3.2: generated client-side, EFF long list, minimum 12 words, and users do
 * not get to invent their own. The "invent your own" case is not a UI toggle we
 * hid — there is no code path here that accepts a user-authored phrase as the
 * vault passphrase at all.
 */

import {
  BITS_PER_WORD,
  DEFAULT_PASSPHRASE_WORDS,
  MAX_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  WORDLIST_SIZE,
  WORD_SEPARATOR,
} from './constants';
import { randomInt } from './random';
import { wordIndex, wordlist } from './wordlist';

export interface GeneratedPassphrase {
  readonly words: readonly string[];
  /** Canonical single-string form: words joined by a single space. */
  readonly phrase: string;
  readonly wordCount: number;
  readonly entropyBits: number;
}

/**
 * Generate a passphrase of `wordCount` independently sampled words.
 *
 * Sampling is WITH replacement. That is deliberate and it is the difference
 * between a phrase whose entropy is exactly `n · log2(7776)` and one whose entropy
 * is slightly less and annoying to state precisely. A repeated word looks odd on
 * paper but costs the user nothing, and we would rather print an honest number.
 */
export function generatePassphrase(
  wordCount: number = DEFAULT_PASSPHRASE_WORDS,
): GeneratedPassphrase {
  if (!Number.isInteger(wordCount)) {
    throw new Error('Word count must be an integer.');
  }
  if (wordCount < MIN_PASSPHRASE_WORDS) {
    throw new Error(
      `Refusing to generate a passphrase shorter than ${MIN_PASSPHRASE_WORDS} words.`,
    );
  }
  if (wordCount > MAX_PASSPHRASE_WORDS) {
    throw new Error(`Word count may not exceed ${MAX_PASSPHRASE_WORDS}.`);
  }

  const words: string[] = [];
  for (let i = 0; i < wordCount; i += 1) {
    words.push(wordlist[randomInt(WORDLIST_SIZE)] as string);
  }

  return {
    words,
    phrase: words.join(WORD_SEPARATOR),
    wordCount,
    entropyBits: entropyBitsForWordCount(wordCount),
  };
}

/** Exact entropy of an `n`-word independently sampled EFF-long phrase. */
export function entropyBitsForWordCount(wordCount: number): number {
  return wordCount * BITS_PER_WORD;
}

/** Smallest word count reaching at least `bits` of entropy. */
export function wordCountForEntropyBits(bits: number): number {
  return Math.ceil(bits / BITS_PER_WORD);
}

/**
 * Normalise a transcription the user typed back from paper.
 *
 * Forgiving about everything that does not change the phrase — case, runs of
 * whitespace, leading/trailing space, newlines from a wrapped print-out, and the
 * numbering some people add ("1. abacus") — and unforgiving about everything that
 * does.
 */
export function normalisePassphraseInput(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/gm, '')
    .replace(/[‐-―−]/g, '-')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(WORD_SEPARATOR);
}

export interface TranscriptionCheck {
  readonly matches: boolean;
  /** Indices (0-based) of words that differ from the original. */
  readonly mismatchedIndices: readonly number[];
  /** Words the user typed that are not in the EFF list at all. */
  readonly unknownWords: readonly string[];
  readonly expectedWordCount: number;
  readonly actualWordCount: number;
}

/**
 * Compare a transcription against the generated phrase (spec §3.2: the user must
 * re-enter the phrase from their written copy before the vault is created).
 *
 * This runs entirely in the browser against the phrase still held in memory from
 * generation. It reports *which positions* are wrong, because the alternative —
 * "something is wrong, start again" — pushes people toward screenshotting the
 * phrase, which is the thing we are trying to prevent. It never reveals the
 * correct word for a wrong position.
 */
export function checkTranscription(
  original: readonly string[],
  typed: string,
): TranscriptionCheck {
  const typedWords = normalisePassphraseInput(typed).split(WORD_SEPARATOR).filter(Boolean);
  const mismatched: number[] = [];
  const unknown: string[] = [];

  for (let i = 0; i < Math.max(original.length, typedWords.length); i += 1) {
    const expected = original[i];
    const actual = typedWords[i];
    if (actual !== undefined && wordIndex(actual) === -1 && !unknown.includes(actual)) {
      unknown.push(actual);
    }
    if (expected !== actual) mismatched.push(i);
  }

  return {
    matches: mismatched.length === 0 && typedWords.length === original.length,
    mismatchedIndices: mismatched,
    unknownWords: unknown,
    expectedWordCount: original.length,
    actualWordCount: typedWords.length,
  };
}
