import { describe, expect, it } from 'vitest';

import {
  checkTranscription,
  entropyBitsForWordCount,
  generatePassphrase,
  normalisePassphraseInput,
  wordCountForEntropyBits,
} from '@/lib/crypto/diceware';
import { randomInt } from '@/lib/crypto/random';
import { wordIndex, wordlist, wordsWithPrefix } from '@/lib/crypto/wordlist';
import { EFF_LONG_WORDLIST_SHA256 } from '@/lib/crypto/wordlist.generated';
import { MIN_PASSPHRASE_WORDS, WORDLIST_SIZE } from '@/lib/crypto/constants';

describe('wordlist integrity', () => {
  it('has exactly 7776 unique lowercase words', () => {
    expect(wordlist.length).toBe(WORDLIST_SIZE);
    expect(new Set(wordlist).size).toBe(WORDLIST_SIZE);
    for (const w of wordlist) expect(w).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });

  it('carries the pinned digest of the vendored EFF list', () => {
    expect(EFF_LONG_WORDLIST_SHA256).toBe(
      'addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e',
    );
  });

  it('includes the four hyphenated EFF entries, which identify the authentic list', () => {
    for (const w of ['drop-down', 'felt-tip', 't-shirt', 'yo-yo']) {
      expect(wordIndex(w)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is frozen, so no runtime code can substitute a word', () => {
    expect(Object.isFrozen(wordlist)).toBe(true);
  });

  it('resolves indices and reports unknown words as -1', () => {
    expect(wordlist[wordIndex('abacus')]).toBe('abacus');
    expect(wordIndex('notanefftword')).toBe(-1);
    expect(wordIndex('')).toBe(-1);
  });
});

describe('generatePassphrase', () => {
  it('generates the requested number of words from the list', () => {
    const p = generatePassphrase(12);
    expect(p.words.length).toBe(12);
    expect(p.wordCount).toBe(12);
    for (const w of p.words) expect(wordIndex(w)).toBeGreaterThanOrEqual(0);
    expect(p.phrase).toBe(p.words.join(' '));
  });

  it('reports exact entropy: n · log2(7776)', () => {
    expect(generatePassphrase(12).entropyBits).toBeCloseTo(155.0978, 3);
    expect(generatePassphrase(15).entropyBits).toBeCloseTo(193.8722, 3);
    expect(entropyBitsForWordCount(1)).toBeCloseTo(12.925, 3);
  });

  it(`refuses fewer than ${MIN_PASSPHRASE_WORDS} words`, () => {
    expect(() => generatePassphrase(11)).toThrow(/Refusing to generate/);
    expect(() => generatePassphrase(1)).toThrow(/Refusing to generate/);
    expect(() => generatePassphrase(0)).toThrow(/Refusing to generate/);
    expect(() => generatePassphrase(-5)).toThrow(/Refusing to generate/);
  });

  it('refuses a non-integer or oversized word count', () => {
    expect(() => generatePassphrase(12.5)).toThrow(/must be an integer/);
    expect(() => generatePassphrase(1000)).toThrow(/may not exceed/);
  });

  it('defaults to 12 words', () => {
    expect(generatePassphrase().wordCount).toBe(12);
  });

  it('never repeats a phrase across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) seen.add(generatePassphrase(12).phrase);
    expect(seen.size).toBe(300);
  });

  it('draws from across the whole list, not a prefix of it', () => {
    const indices: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      for (const w of generatePassphrase(12).words) indices.push(wordIndex(w));
    }
    expect(Math.max(...indices)).toBeGreaterThan(WORDLIST_SIZE * 0.95);
    expect(Math.min(...indices)).toBeLessThan(WORDLIST_SIZE * 0.05);
    const mean = indices.reduce((a, b) => a + b, 0) / indices.length;
    // Uniform mean is 3887.5; allow a generous band for 2400 samples.
    expect(mean).toBeGreaterThan(WORDLIST_SIZE * 0.42);
    expect(mean).toBeLessThan(WORDLIST_SIZE * 0.58);
  });
});

describe('randomInt — uniformity', () => {
  it('stays in range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const v = randomInt(7776);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7776);
    }
  });

  it('is not detectably biased across buckets (chi-square, 36 buckets)', () => {
    const buckets = 36;
    const draws = 72_000;
    const counts = new Array<number>(buckets).fill(0);
    for (let i = 0; i < draws; i += 1) {
      counts[Math.floor(randomInt(WORDLIST_SIZE) / (WORDLIST_SIZE / buckets))] += 1;
    }
    const expected = draws / buckets;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // 35 df: the 0.999 critical value is ~66.6; a biased modulo generator blows past this.
    expect(chi2).toBeLessThan(80);
  });

  it('handles the degenerate and invalid bounds', () => {
    expect(randomInt(1)).toBe(0);
    expect(() => randomInt(0)).toThrow(/bound must be/);
    expect(() => randomInt(-1)).toThrow(/bound must be/);
    expect(() => randomInt(1.5)).toThrow(/bound must be/);
    expect(() => randomInt(2 ** 33)).toThrow(/bound must be/);
  });
});

describe('wordCountForEntropyBits', () => {
  it('rounds up to the next whole word', () => {
    expect(wordCountForEntropyBits(128)).toBe(10);
    // 12 words give 155.0978 bits, so asking for 155.11 legitimately needs a 13th.
    expect(wordCountForEntropyBits(155.0977)).toBe(12);
    expect(wordCountForEntropyBits(155.11)).toBe(13);
    expect(wordCountForEntropyBits(256)).toBe(20);
  });
});

describe('normalisePassphraseInput', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalisePassphraseInput('  Abacus   ABDOMEN\n\tabide  ')).toBe(
      'abacus abdomen abide',
    );
  });

  it('strips the numbering people copy off the transcription sheet', () => {
    expect(normalisePassphraseInput('1. abacus\n2. abdomen\n3) abide')).toBe(
      'abacus abdomen abide',
    );
  });

  it('normalises typographic dashes to the ASCII hyphen the list uses', () => {
    expect(normalisePassphraseInput('t‑shirt yo–yo')).toBe('t-shirt yo-yo');
  });

  it('returns an empty string for empty input', () => {
    expect(normalisePassphraseInput('   \n  ')).toBe('');
  });
});

describe('checkTranscription', () => {
  const original = ['abacus', 'abdomen', 'abide', 'ability'];

  it('accepts an exact transcription', () => {
    const r = checkTranscription(original, 'abacus abdomen abide ability');
    expect(r.matches).toBe(true);
    expect(r.mismatchedIndices).toEqual([]);
  });

  it('accepts a sloppily formatted but correct transcription', () => {
    const r = checkTranscription(original, '1. Abacus\n2. abdomen\n 3. ABIDE\n4. ability\n');
    expect(r.matches).toBe(true);
  });

  it('reports which positions are wrong without revealing the right word', () => {
    const r = checkTranscription(original, 'abacus abdomen zoom ability');
    expect(r.matches).toBe(false);
    expect(r.mismatchedIndices).toEqual([2]);
    expect(JSON.stringify(r)).not.toContain('abide');
  });

  it('flags words that are not in the EFF list at all', () => {
    const r = checkTranscription(original, 'abacus abdomen abyde ability');
    expect(r.unknownWords).toEqual(['abyde']);
    expect(r.mismatchedIndices).toEqual([2]);
  });

  it('detects a short transcription', () => {
    const r = checkTranscription(original, 'abacus abdomen abide');
    expect(r.matches).toBe(false);
    expect(r.actualWordCount).toBe(3);
    expect(r.expectedWordCount).toBe(4);
    expect(r.mismatchedIndices).toEqual([3]);
  });

  it('detects a long transcription', () => {
    const r = checkTranscription(original, 'abacus abdomen abide ability zoom');
    expect(r.matches).toBe(false);
    expect(r.mismatchedIndices).toEqual([4]);
  });

  it('detects a transposition', () => {
    const r = checkTranscription(original, 'abacus abide abdomen ability');
    expect(r.matches).toBe(false);
    expect(r.mismatchedIndices).toEqual([1, 2]);
  });

  it('rejects empty input', () => {
    const r = checkTranscription(original, '');
    expect(r.matches).toBe(false);
    expect(r.actualWordCount).toBe(0);
  });
});

describe('wordsWithPrefix', () => {
  it('is inert below two characters, so it cannot act as a hint system', () => {
    expect(wordsWithPrefix('')).toEqual([]);
    expect(wordsWithPrefix('a')).toEqual([]);
  });

  it('returns a bounded list of real list words', () => {
    const matches = wordsWithPrefix('abac');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(8);
    for (const w of matches) expect(w.startsWith('abac')).toBe(true);
  });

  it('returns nothing for a prefix no word has', () => {
    expect(wordsWithPrefix('qqqq')).toEqual([]);
  });
});
