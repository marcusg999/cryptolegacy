import { describe, expect, it } from 'vitest';

import {
  buildExecutorLetter,
  renderExecutorLetterText,
  type ExecutorLetterInput,
} from '@/lib/custody/executor-letter';
import {
  BLOCK_RUN_LENGTH,
  PassphraseInContentError,
  WARN_RUN_LENGTH,
  assertNoPassphraseInContent,
  scanForPassphraseLikeRun,
  tokenise,
} from '@/lib/custody/passphrase-guard';
import { generatePassphrase } from '@/lib/crypto/diceware';
import type { CustodyPoint } from '@/lib/custody/types';

const GENERATED = new Date('2026-06-15T00:00:00.000Z');

const pt = (
  label: string,
  over: Partial<CustodyPoint['meta']> = {},
  detail: Partial<CustodyPoint['detail']> = {},
): CustodyPoint => ({
  meta: {
    id: crypto.randomUUID(),
    pointType: 'institution',
    holding: 'full_copy',
    partIndex: null,
    lastVerifiedAt: '2026-05-01T00:00:00.000Z',
    displayOrder: 0,
    ...over,
  },
  detail: { label, ...detail },
});

const redundancyInput: ExecutorLetterInput = {
  ownerName: 'Marcus Gray',
  vaultLabel: 'Personal crypto',
  mode: 'hybrid',
  passphraseWordCount: 12,
  partCount: 1,
  generatedAt: GENERATED,
  points: [
    pt(
      'Golden One safe deposit box',
      { pointType: 'institution', displayOrder: 0 },
      {
        locationNotes: 'Box 418, Howe Avenue branch, Sacramento',
        contact: '(916) 555-0100',
        notes: 'Brass key is taped under the top desk drawer.',
      },
    ),
    pt(
      "Attorney's firm safe",
      { pointType: 'person', displayOrder: 1 },
      { custodianName: 'Reed & Vance LLP', contact: 'mreed@example.com' },
    ),
  ],
};

describe('buildExecutorLetter', () => {
  it('builds a letter from the custody plan', () => {
    const letter = buildExecutorLetter(redundancyInput);
    expect(letter.title).toMatch(/Letter to my executor/);
    expect(letter.ownerName).toBe('Marcus Gray');
    expect(letter.generatedAt).toBe(GENERATED.toISOString());
    expect(letter.sections.length).toBeGreaterThan(3);
  });

  it('lists every custody point as an ordered step', () => {
    const letter = buildExecutorLetter(redundancyInput);
    const steps = letter.sections.flatMap((s) => s.steps ?? []);
    expect(steps.map((s) => s.order)).toEqual([1, 2]);
    expect(steps[0]?.label).toBe('Golden One safe deposit box');
    expect(steps[0]?.lines).toContain('Where: Box 418, Howe Avenue branch, Sacramento');
    expect(steps[1]?.lines).toContain('Held by: Reed & Vance LLP');
  });

  it('orders steps by displayOrder, not array order', () => {
    const letter = buildExecutorLetter({
      ...redundancyInput,
      points: [
        pt('second', { displayOrder: 5 }),
        pt('first', { displayOrder: 1 }),
      ],
    });
    const steps = letter.sections.flatMap((s) => s.steps ?? []);
    expect(steps.map((s) => s.label)).toEqual(['first', 'second']);
  });

  it('says any one copy is enough in a full-copy arrangement', () => {
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).toMatch(/Any one complete copy is enough/);
    expect(text).toMatch(/2 complete copies exist/);
    expect(text).not.toMatch(/All 1 parts are required/);
  });

  it('warns that a single copy is the only copy', () => {
    const text = renderExecutorLetterText(
      buildExecutorLetter({ ...redundancyInput, points: [redundancyInput.points[0]!] }),
    );
    expect(text).toMatch(/There is only one copy/);
  });

  it('states that all parts are required in a split arrangement, and the cost of that', () => {
    const letter = buildExecutorLetter({
      ...redundancyInput,
      mode: 'split',
      passphraseWordCount: 15,
      partCount: 3,
      points: [
        pt('part one', { holding: 'split_part', partIndex: 1, displayOrder: 0 }),
        pt('part two', { holding: 'split_part', partIndex: 2, displayOrder: 1 }),
        pt('part three', { holding: 'split_part', partIndex: 3, displayOrder: 2 }),
      ],
    });
    const text = renderExecutorLetterText(letter);
    expect(text).toMatch(/All 3 parts are required/);
    expect(text).toMatch(/divided into 3 parts \(5 \/ 5 \/ 5 words\)/);
    expect(text).toMatch(/if any one part is lost, the vault cannot be opened by anybody, ever/i);
    const steps = letter.sections.flatMap((s) => s.steps ?? []);
    expect(steps[0]?.holds).toBe('Part 1 of 3');
  });

  it('tells the executor plainly that nobody can recover the passphrase', () => {
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).toMatch(/never had and cannot\s+recover/);
    expect(text).toMatch(/court order or subpoena/);
  });

  it('includes the anti-scam warning and the do-not-rush tax guidance', () => {
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).toMatch(/No legitimate support process will ever ask you for it/);
    expect(text).toMatch(/stepped-up cost basis at death/);
  });

  it('distinguishes a damaged record from a wrong passphrase for the executor', () => {
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).toMatch(/Do not\s+create a new vault/);
    expect(text).toMatch(/damaged stored record, not a wrong passphrase/);
  });

  it('states it is not a legal document — spec §2.2 and §2.4', () => {
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).toMatch(/not a legal document and not legal advice/);
    expect(text).toMatch(/not a will or a codicil/);
    expect(text).toMatch(/Store it with the will/);
  });

  it('leaves the account email to be written in pen, so the app does not print it', () => {
    const letter = buildExecutorLetter(redundancyInput);
    expect(letter.handwrittenFields.join(' ')).toMatch(/email address/);
    expect(renderExecutorLetterText(letter)).toMatch(/Signature: _____/);
  });

  it('records the last-verified date for each point', () => {
    const letter = buildExecutorLetter(redundancyInput);
    const steps = letter.sections.flatMap((s) => s.steps ?? []);
    expect(steps[0]?.lastVerified).toBe('2026-05-01');
  });

  it('says so when a point was never verified rather than printing a blank', () => {
    const letter = buildExecutorLetter({
      ...redundancyInput,
      points: [pt('never checked', { lastVerifiedAt: null })],
    });
    expect(letter.sections.flatMap((s) => s.steps ?? [])[0]?.lastVerified).toBe('never verified');
  });

  it('includes the owner’s own note as its own section when given', () => {
    const letter = buildExecutorLetter({
      ...redundancyInput,
      executorNotes: 'Call my sister before the attorney.',
    });
    const headings = letter.sections.map((s) => s.heading);
    expect(headings).toContain('A note from Marcus Gray');
    expect(renderExecutorLetterText(letter)).toMatch(/Call my sister before the attorney/);
  });

  it('refuses to generate a letter with no custody points', () => {
    expect(() => buildExecutorLetter({ ...redundancyInput, points: [] })).toThrow(
      /no custody points/,
    );
  });

  it('never contains a passphrase, because it is built from the plan and not the phrase', () => {
    const phrase = generatePassphrase(12);
    const text = renderExecutorLetterText(buildExecutorLetter(redundancyInput));
    expect(text).not.toContain(phrase.phrase);
    for (const word of phrase.words) {
      // No run of generated words can appear; individual common words may.
      expect(text).not.toContain(phrase.words.slice(0, 4).join(' '));
      expect(word.length).toBeGreaterThan(0);
    }
  });

  it('refuses to print a letter whose custody notes contain the passphrase', () => {
    const phrase = generatePassphrase(12).phrase;
    expect(() =>
      buildExecutorLetter({
        ...redundancyInput,
        points: [pt('box', {}, { notes: `the words are ${phrase}` })],
      }),
    ).toThrow(PassphraseInContentError);
  });

  it('warns, without blocking, on a shorter run of wordlist words', () => {
    // Five consecutive list words: suspicious enough to flag, not to refuse.
    const letter = buildExecutorLetter({
      ...redundancyInput,
      points: [pt('box', {}, { notes: 'abacus abdomen abide ability ablaze' })],
    });
    expect(letter.warnings.length).toBeGreaterThan(0);
    expect(letter.warnings[0]).toMatch(/reads like part of a passphrase/);
  });

  it('does not warn on ordinary custody prose', () => {
    const letter = buildExecutorLetter(redundancyInput);
    expect(letter.warnings).toEqual([]);
  });
});

describe('passphrase-in-content guard', () => {
  const realisticNotes = [
    'Safe deposit box 418 at the Golden One Credit Union branch on Howe Avenue, Sacramento. The small brass key is taped under the top drawer of my desk.',
    'My sister Elena keeps a sealed envelope in her home safe in Portland. Call her before the attorney; she does not know what is inside.',
    'Fireproof document box in the hall closet behind the winter coats, bottom shelf, under the tax folders.',
    'Attorney: Marcus Reed, Reed & Vance LLP. The firm safe holds the sealed envelope marked with my name and the date.',
    'Steel plate stamped with the words, buried in a sealed capsule under the third fence post east of the garden shed at the cabin.',
    'The hardware wallet is a Ledger Nano X in the gun safe. The passphrase is not stored with it and never will be.',
    'Registered agent in Reno holds a copy for the business vault. Ask for the file under the company name, not mine.',
  ];

  it('does not fire on realistic custody prose', () => {
    for (const note of realisticNotes) {
      const scan = scanForPassphraseLikeRun(note);
      expect(scan.block, note).toBe(false);
      expect(scan.warn, note).toBe(false);
      expect(() => assertNoPassphraseInContent(note)).not.toThrow();
    }
  });

  it('keeps a wide margin between real prose and the warn threshold', () => {
    const worst = Math.max(...realisticNotes.map((n) => scanForPassphraseLikeRun(n).longestRun));
    expect(worst).toBeLessThan(WARN_RUN_LENGTH);
  });

  it('catches a pasted 12-word phrase every time', () => {
    for (let i = 0; i < 50; i += 1) {
      const phrase = generatePassphrase(12).phrase;
      const scan = scanForPassphraseLikeRun(`do not lose this: ${phrase}`);
      expect(scan.longestRun).toBeGreaterThanOrEqual(BLOCK_RUN_LENGTH);
      expect(scan.block).toBe(true);
    }
  });

  it('catches a phrase punctuated or numbered as people actually write it', () => {
    const phrase = generatePassphrase(12);
    for (const rendering of [
      phrase.words.join(', '),
      phrase.words.join('\n'),
      phrase.words.map((w, i) => `${i + 1}. ${w}`).join('  '),
      phrase.words.join(' - '),
    ]) {
      expect(scanForPassphraseLikeRun(rendering).block).toBe(true);
    }
  });

  it('catches a partial phrase of 8 or more words — spec §1.1 bars partial seeds too', () => {
    const phrase = generatePassphrase(12);
    expect(scanForPassphraseLikeRun(phrase.words.slice(0, 8).join(' ')).block).toBe(true);
    expect(scanForPassphraseLikeRun(phrase.words.slice(0, 5).join(' ')).warn).toBe(true);
  });

  it('catches a phrase whose words are joined by hyphens with no spaces', () => {
    const phrase = generatePassphrase(12);
    expect(scanForPassphraseLikeRun(phrase.words.join('-')).block).toBe(true);
    expect(scanForPassphraseLikeRun(phrase.words.join('_')).block).toBe(true);
    expect(scanForPassphraseLikeRun(phrase.words.join('.')).block).toBe(true);
    expect(scanForPassphraseLikeRun(phrase.words.join('|')).block).toBe(true);
  });

  it('treats a bare hyphen as a separator, not as a run-breaker', () => {
    const scan = scanForPassphraseLikeRun('abacus - abdomen - abide - ability - ablaze');
    expect(scan.longestRun).toBe(5);
    expect(scan.warn).toBe(true);
  });

  it('keeps the four hyphenated EFF words whole', () => {
    expect(tokenise('t-shirt yo-yo drop-down felt-tip')).toEqual([
      't-shirt',
      'yo-yo',
      'drop-down',
      'felt-tip',
    ]);
    // A phrase made of them is still caught.
    const scan = scanForPassphraseLikeRun(
      't-shirt yo-yo drop-down felt-tip t-shirt yo-yo drop-down felt-tip',
    );
    expect(scan.longestRun).toBe(8);
    expect(scan.block).toBe(true);
  });

  it('reports where the run starts', () => {
    const scan = scanForPassphraseLikeRun('note: abacus abdomen abide ability ablaze able abnormal abrasion');
    expect(scan.startIndex).toBe(1);
  });

  it('is unbothered by empty or punctuation-only input', () => {
    for (const s of ['', '   ', '!!!', '12345']) {
      const scan = scanForPassphraseLikeRun(s);
      expect(scan.longestRun).toBe(0);
      expect(scan.block).toBe(false);
    }
  });

  it('names the field in the error so the user knows where to look', () => {
    const phrase = generatePassphrase(12).phrase;
    expect(() => assertNoPassphraseInContent(phrase, 'The notes field')).toThrow(
      /The notes field contains 12 consecutive words/,
    );
    expect(() => assertNoPassphraseInContent(phrase)).toThrow(
      /must never be stored in the vault/,
    );
  });
});
