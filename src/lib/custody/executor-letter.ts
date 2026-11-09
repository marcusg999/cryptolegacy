/**
 * The Executor Letter. Spec §4.4.
 *
 * This solves a circular dependency: the executor needs to know where the
 * passphrase is, but that information is exactly what we must not hold in
 * plaintext. The resolution is that the letter is generated in the browser from
 * the decrypted custody plan, printed by the user, and stored on paper with the
 * will — where executors already look. The app keeps the plan only inside the
 * encrypted vault, and keeps the letter not at all.
 *
 * So: nothing in this module writes to a database or makes a request. It turns a
 * decrypted plan into a document model. The only thing persisted anywhere as a
 * result of generating a letter is the timestamp `letter_last_generated_at`, which
 * exists so the app can nag when the plan drifts ahead of the paper.
 */

import { BITS_PER_WORD } from '@/lib/crypto/constants';

import { analyseSplit } from './entropy';
import { assertNoPassphraseInContent, scanForPassphraseLikeRun } from './passphrase-guard';
import type { CustodyMode, CustodyPoint, CustodyPointType } from './types';

export interface ExecutorLetterInput {
  readonly ownerName: string;
  readonly vaultLabel: string;
  readonly mode: CustodyMode;
  readonly passphraseWordCount: number;
  readonly partCount: number;
  /** Decrypted custody points, in the order the executor should work through them. */
  readonly points: readonly CustodyPoint[];
  readonly generatedAt?: Date;
  /** Optional: who the executor should contact first, free text from the user. */
  readonly executorNotes?: string;
}

export interface LetterSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** Ordered contact/retrieval steps, when the section has them. */
  readonly steps?: readonly LetterStep[];
}

export interface LetterStep {
  readonly order: number;
  readonly label: string;
  readonly pointType: CustodyPointType;
  readonly holds: string;
  readonly lines: readonly string[];
  readonly lastVerified: string;
}

export interface ExecutorLetter {
  readonly title: string;
  readonly generatedAt: string;
  readonly ownerName: string;
  readonly vaultLabel: string;
  readonly sections: readonly LetterSection[];
  /** Fields the user must complete in pen, because the app must not hold them. */
  readonly handwrittenFields: readonly string[];
  readonly warnings: readonly string[];
}

const NOT_LEGAL_ADVICE =
  'This letter is not a legal document and not legal advice. It does not transfer anything, ' +
  'and it is not a will or a codicil. It is a set of directions for locating a passphrase. ' +
  'Store it with the will; it has no effect on its own.';

/**
 * Build the letter.
 *
 * Throws if any custody detail looks like it contains the passphrase itself — the
 * printed letter is the one artefact that goes into the world as plaintext, and
 * having it carry the phrase would collapse the two-channel separation the whole
 * design rests on (spec §3).
 */
export function buildExecutorLetter(input: ExecutorLetterInput): ExecutorLetter {
  const generatedAt = input.generatedAt ?? new Date();
  const warnings: string[] = [];

  if (input.points.length === 0) {
    throw new Error(
      'Cannot generate an Executor Letter with no custody points — there would be nothing to direct anyone to.',
    );
  }

  for (const point of input.points) {
    const fields: ReadonlyArray<[string, string | undefined]> = [
      ['label', point.detail.label],
      ['custodian name', point.detail.custodianName],
      ['contact', point.detail.contact],
      ['location notes', point.detail.locationNotes],
      ['notes', point.detail.notes],
    ];
    for (const [name, value] of fields) {
      if (!value) continue;
      assertNoPassphraseInContent(value, `The ${name} of custody point "${point.detail.label}"`);
      if (scanForPassphraseLikeRun(value).warn) {
        warnings.push(
          `The ${name} of "${point.detail.label}" reads like part of a passphrase. ` +
            'Check it before printing — this letter is stored unencrypted on paper.',
        );
      }
    }
  }

  const ordered = [...input.points].sort(
    (a, b) => a.meta.displayOrder - b.meta.displayOrder,
  );

  const steps: LetterStep[] = ordered.map((point, i) => ({
    order: i + 1,
    label: point.detail.label,
    pointType: point.meta.pointType,
    holds:
      point.meta.holding === 'split_part'
        ? `Part ${point.meta.partIndex} of ${input.partCount}`
        : 'A complete copy of the passphrase',
    lines: [
      point.detail.custodianName ? `Held by: ${point.detail.custodianName}` : null,
      point.detail.contact ? `Contact: ${point.detail.contact}` : null,
      point.detail.locationNotes ? `Where: ${point.detail.locationNotes}` : null,
      point.detail.notes ? `Notes: ${point.detail.notes}` : null,
    ].filter((l): l is string => l !== null),
    lastVerified: point.meta.lastVerifiedAt
      ? formatDate(new Date(point.meta.lastVerifiedAt))
      : 'never verified',
  }));

  const sections: LetterSection[] = [
    {
      heading: 'What this letter is for',
      paragraphs: [
        `${input.ownerName} kept an encrypted vault called "${input.vaultLabel}". It holds records, ` +
          'instructions and messages about their cryptocurrency and related assets.',
        'The vault is encrypted with a passphrase that the vault company never had and cannot ' +
          'recover. No support request, court order or subpoena can produce it, because it does ' +
          'not exist on their systems in any form. The passphrase exists only on paper, in the ' +
          'places listed below.',
        'You will need two things: access to the vault account, and the passphrase. Neither one ' +
          'alone opens anything.',
        NOT_LEGAL_ADVICE,
      ],
    },
    {
      heading: 'How the passphrase was arranged',
      paragraphs: describeArrangement(input),
    },
    {
      heading: 'Where to go, in this order',
      paragraphs: [
        'Work through these in order. Each entry says what that holder has and how to reach them.',
        input.mode === 'split'
          ? `All ${input.partCount} parts are required. A part that cannot be recovered cannot be ` +
            'reconstructed from the others, and the vault contents are then permanently unreadable. ' +
            'Collect every part before attempting to unlock anything.'
          : 'Any one complete copy is enough. If the first holder cannot be reached, move to the next.',
      ],
      steps,
    },
    {
      heading: 'What to do once you have it',
      paragraphs: [
        'Sign in to the vault account as the named executor, using the access the vault company ' +
          'granted you after verifying the death. Enter the passphrase there. It is checked in your ' +
          'own browser; it is never sent to the company.',
        'Type the passphrase exactly as written: all lower case, single spaces between words, no ' +
          'punctuation. The words come from a fixed list, so a misreading usually shows up as a word ' +
          'that is not on the list at all.',
        'Do not photograph, email, message or type the passphrase into anything other than the ' +
          'vault unlock screen. Do not read it aloud over the phone to anyone claiming to be support. ' +
          'No legitimate support process will ever ask you for it.',
        'The vault reveals its contents in stages, starting with personal messages and ending with ' +
          'wallet access. Follow that order. Do not move or sell any crypto asset before taking ' +
          'advice — assets generally receive a stepped-up cost basis at death, and a sale made in the ' +
          'first week can cost the estate real money and create problems that cannot be undone.',
      ],
    },
    {
      heading: 'If something has gone wrong',
      paragraphs: [
        'If a holder no longer has their envelope, go to the next holder on the list. If this is a ' +
          'split arrangement and a part is genuinely gone, the vault contents cannot be recovered by ' +
          'anyone, including the vault company. Record what happened for the estate file and move on ' +
          'to the rest of the estate.',
        'If the passphrase is entered correctly and the vault still reports a failure, stop. Do not ' +
          'create a new vault. Record the exact message and contact the vault company — that pattern ' +
          'indicates a damaged stored record, not a wrong passphrase, and it may be restorable from backup.',
      ],
    },
  ];

  return {
    title: 'Letter to my executor — locating the vault passphrase',
    generatedAt: generatedAt.toISOString(),
    ownerName: input.ownerName,
    vaultLabel: input.vaultLabel,
    sections: input.executorNotes
      ? [
          ...sections.slice(0, 3),
          {
            heading: 'A note from ' + input.ownerName,
            paragraphs: [input.executorNotes],
          },
          ...sections.slice(3),
        ]
      : sections,
    handwrittenFields: [
      'Signature',
      'Date signed',
      'Vault account email address (write it here in pen — this letter is stored with the will)',
    ],
    warnings,
  };
}

function describeArrangement(input: ExecutorLetterInput): string[] {
  const out: string[] = [];
  const words = input.passphraseWordCount;

  if (input.mode === 'split') {
    const analysis = analyseSplit(words, input.partCount);
    out.push(
      `The passphrase is ${words} words long. It was divided into ${input.partCount} parts ` +
        `(${analysis.partSizes.join(' / ')} words), and every part is needed. ` +
        'No single holder can open the vault, and no single holder can be coerced into opening it.',
    );
    out.push(
      'That protection has a cost, and you should know it before you start: if any one part is ' +
        'lost, the vault cannot be opened by anybody, ever. There is no backup copy and no recovery ' +
        'process.',
    );
  } else {
    const copies = input.points.filter((p) => p.meta.holding === 'full_copy').length;
    out.push(
      `The passphrase is ${words} words long. ${copies} complete ${
        copies === 1 ? 'copy exists' : 'copies exist'
      }, in the ${copies === 1 ? 'place' : 'places'} listed below. Any one of them is enough to open the vault.`,
    );
    if (copies === 1) {
      out.push(
        'There is only one copy. If it cannot be found, the vault contents cannot be recovered by ' +
          'anyone, including the vault company.',
      );
    }
  }

  out.push(
    `For reference: a ${words}-word passphrase from this word list represents about ` +
      `${Math.round(words * BITS_PER_WORD)} bits of randomness. It cannot be guessed, worked out from ` +
      'personal details, or recovered by any technical means. Finding the written copy is the only way in.',
  );
  return out;
}

/**
 * Plain-text rendering, for the print view's fallback and for tests.
 *
 * Deliberately not a PDF produced by a third-party library: spec §11 forbids a
 * third-party script on any page that touches decrypted content, and this page
 * does. The user prints to paper (or to PDF) with the browser's own print
 * pipeline, which involves no extra code.
 */
export function renderExecutorLetterText(letter: ExecutorLetter): string {
  const out: string[] = [];
  out.push(letter.title.toUpperCase());
  out.push('');
  out.push(`Prepared by: ${letter.ownerName}`);
  out.push(`Vault: ${letter.vaultLabel}`);
  out.push(`Generated: ${formatDate(new Date(letter.generatedAt))}`);
  out.push('');
  out.push('KEEP THIS WITH THE WILL. IT CONTAINS NO PASSPHRASE AND NO KEYS.');
  out.push('');

  for (const section of letter.sections) {
    out.push(section.heading.toUpperCase());
    out.push('-'.repeat(section.heading.length));
    for (const p of section.paragraphs) {
      out.push(p);
      out.push('');
    }
    for (const step of section.steps ?? []) {
      out.push(`${step.order}. ${step.label}  [${step.pointType}]`);
      out.push(`   Holds: ${step.holds}`);
      for (const line of step.lines) out.push(`   ${line}`);
      out.push(`   Last confirmed by ${letter.ownerName}: ${step.lastVerified}`);
      out.push('');
    }
  }

  out.push('SIGNATURE');
  out.push('---------');
  for (const field of letter.handwrittenFields) {
    out.push(`${field}: ______________________________________`);
    out.push('');
  }
  return out.join('\n');
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
