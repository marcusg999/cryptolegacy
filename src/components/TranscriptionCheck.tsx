'use client';

import { useMemo, useState } from 'react';

import { checkTranscription, normalisePassphraseInput } from '@/lib/crypto/diceware';
import { Button } from '@/components/ui';

/**
 * Spec §3.2: "Require physical transcription confirmation: the user must
 * re-enter the phrase from their written copy before the vault is created. This
 * forces the physical artifact to exist before anything depends on it."
 *
 * The check runs against the phrase still in memory from generation — nothing is
 * sent anywhere. When it fails, it says *which positions* are wrong but never
 * what the right word was. Saying "word 7 does not match" sends the user back to
 * their paper, which is the behaviour we want; saying "word 7 should be
 * 'abacus'" would make the paper optional and turn this screen into a second
 * display of the phrase.
 */
export function TranscriptionCheck({
  words,
  onConfirmed,
  onBack,
}: {
  words: readonly string[];
  onConfirmed: () => void;
  onBack: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [attempted, setAttempted] = useState(false);

  const result = useMemo(() => checkTranscription(words, typed), [words, typed]);
  const typedCount = normalisePassphraseInput(typed).split(' ').filter(Boolean).length;
  const showErrors = attempted && typed.trim().length > 0 && !result.matches;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Type it back from your paper</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          Read from the sheet you just wrote, not from memory and not from the previous screen.
          This is the step that catches a transcription mistake now, while it is still fixable,
          rather than in ten years when nobody can fix it.
        </p>
      </div>

      <textarea
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => setAttempted(true)}
        rows={4}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        aria-label="Re-enter your passphrase from your written copy"
        placeholder="word word word …"
        className="w-full border border-[#2A3B4F] bg-[#070D16] p-3 font-mono text-base text-ink focus:border-[#2A3B4F] focus:outline-none focus:ring-1 focus:ring-ink"
      />

      <p className="text-xs text-ink/60">
        {typedCount} of {words.length} words entered. Case, extra spaces and line numbers are
        ignored.
      </p>

      {showErrors ? (
        <div className="border border-danger/40 bg-danger/5 p-4 text-sm">
          {result.actualWordCount !== result.expectedWordCount ? (
            <p className="text-ink">
              You have entered {result.actualWordCount} words; the passphrase has{' '}
              {result.expectedWordCount}.
            </p>
          ) : null}

          {result.mismatchedIndices.length > 0 ? (
            <p className="mt-1 text-ink">
              {result.mismatchedIndices.length === 1 ? 'Word' : 'Words'}{' '}
              <strong>{result.mismatchedIndices.map((i) => i + 1).join(', ')}</strong>{' '}
              {result.mismatchedIndices.length === 1 ? 'does' : 'do'} not match. Check your paper
              for {result.mismatchedIndices.length === 1 ? 'that position' : 'those positions'}.
            </p>
          ) : null}

          {result.unknownWords.length > 0 ? (
            <p className="mt-2 text-ink">
              {result.unknownWords.map((w) => `“${w}”`).join(', ')}{' '}
              {result.unknownWords.length === 1 ? 'is' : 'are'} not on the word list at all, so
              that is almost certainly a misreading of your handwriting rather than a wrong word.
            </p>
          ) : null}
        </div>
      ) : null}

      {result.matches ? (
        <div className="border border-ok/40 bg-ok/5 p-4 text-sm text-ink">
          Matches your written copy exactly. Your paper is correct — keep it.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={!result.matches} onClick={onConfirmed}>
          Create the vault
        </Button>
        <Button type="button" variant="secondary" onClick={onBack}>
          Show the passphrase again
        </Button>
      </div>

      <p className="text-xs text-ink/50">
        Going back shows the phrase once more. It is better to look again now than to create a
        vault around a passphrase you cannot reproduce.
      </p>
    </div>
  );
}
