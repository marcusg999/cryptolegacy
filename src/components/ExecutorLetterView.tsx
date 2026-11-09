'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  buildExecutorLetter,
  renderExecutorLetterText,
  type ExecutorLetter,
} from '@/lib/custody/executor-letter';
import { decryptCustodyPoints } from '@/lib/custody-api';
import { recordLetterGenerated } from '@/lib/vault-api';
import { Button, Card, Field, H2, inputClass } from '@/components/ui';
import type { CustodyPlanRow, CustodyPointRow } from '@/lib/supabase/types';

/**
 * Renders the Executor Letter for printing.
 *
 * There is no PDF library here and that is deliberate (spec §11: no third-party
 * script on any page that touches decrypted content — and this page shows the
 * custodian names and locations in the clear). The browser's own print pipeline
 * produces the paper, and `globals.css`'s print rules are the actual output
 * format.
 */
export function ExecutorLetterView({
  vaultId,
  vaultLabel,
  ownerEmail,
  plan,
  pointRows,
}: {
  vaultId: string;
  vaultLabel: string;
  ownerEmail: string;
  plan: CustodyPlanRow;
  pointRows: CustodyPointRow[];
}) {
  const [ownerName, setOwnerName] = useState('');
  const [executorNotes, setExecutorNotes] = useState('');
  const [letter, setLetter] = useState<ExecutorLetter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  // Returns a result rather than setting state, so the effect below owns every
  // state update and can drop a stale one.
  const build = useCallback(async (): Promise<
    { ok: true; letter: ExecutorLetter } | { ok: false; error: string }
  > => {
    try {
      const points = await decryptCustodyPoints(vaultId, pointRows);
      return {
        ok: true,
        letter: buildExecutorLetter({
          ownerName: ownerName.trim() || 'The vault owner',
          vaultLabel,
          mode: plan.mode,
          passphraseWordCount: plan.passphrase_word_count,
          partCount: plan.part_count,
          points,
          ...(executorNotes.trim() ? { executorNotes: executorNotes.trim() } : {}),
        }),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not build the letter.' };
    }
  }, [vaultId, pointRows, ownerName, vaultLabel, plan, executorNotes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const built = await build();
      if (cancelled) return;
      if (built.ok) setLetter(built.letter);
      else {
        setError(built.error);
        setLetter(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [build]);

  const print = useCallback(async () => {
    // Record the generation BEFORE printing. If the print dialogue is cancelled
    // the worst case is a timestamp claiming a letter exists when it does not,
    // which the user can see and fix; recording afterwards would silently miss
    // every print on a browser that navigates away during printing.
    try {
      await recordLetterGenerated(vaultId);
      setRecorded(true);
    } catch {
      // Printing matters more than the bookkeeping.
    }
    window.print();
  }, [vaultId]);

  return (
    <div className="space-y-8">
      <div className="no-print space-y-5">
        <Card>
          <div className="space-y-4">
            <Field
              label="Your full legal name"
              hint="As it appears on your will, so your executor can match the two documents. Not stored."
            >
              <input
                className={inputClass}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Jane Alexandra Doe"
              />
            </Field>

            <Field
              label="A note to your executor (optional)"
              hint="Appears in the letter. Not stored — it exists only in this browser and on the paper you print."
            >
              <textarea
                className={inputClass}
                rows={3}
                value={executorNotes}
                onChange={(e) => setExecutorNotes(e.target.value)}
                placeholder="Call my sister before the attorney. She does not know what is in the envelope."
              />
            </Field>
          </div>
        </Card>

        {error ? (
          <p className="rounded border-2 border-danger bg-danger/5 p-4 text-sm text-ink">{error}</p>
        ) : null}

        {letter?.warnings.length ? (
          <div className="rounded border border-warn/50 bg-warn/5 p-4 text-sm text-ink">
            <p className="font-semibold">Check these before printing</p>
            <ul className="mt-2 space-y-1">
              {letter.warnings.map((w, i) => (
                <li key={i}>— {w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {letter ? (
          <Card tone="warn">
            <H2>Before you print</H2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink/80">
              <li>
                — Write your vault account email on the printed letter{' '}
                <strong>in pen</strong>. We leave it blank deliberately: the letter lives with your
                will, and a document that pairs the account identifier with the custody locations is
                a complete map for anyone who finds it.
                {ownerEmail ? (
                  <span className="block text-xs text-ink/50">
                    Your account email is {ownerEmail} — do not type it into this page.
                  </span>
                ) : null}
              </li>
              <li>
                — Store it with your will, not with the passphrase. The letter says where the
                passphrase is; keeping the two together defeats both.
              </li>
              <li>
                — Reprint it whenever your custody plan changes. We will warn you on the dashboard
                when the plan has moved ahead of the paper.
              </li>
              <li>
                — This letter contains no passphrase, no keys and no account password. It is a set
                of directions.
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={print}>Print the letter</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const text = renderExecutorLetterText(letter);
                  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `executor-letter-${vaultLabel.replace(/\W+/g, '-').toLowerCase()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download as plain text
              </Button>
            </div>
            {recorded ? (
              <p className="mt-3 text-xs text-ok">
                Recorded that you generated the letter today. The dashboard will stop warning you
                until the custody plan changes again.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      {letter ? <LetterPrintable letter={letter} /> : null}
    </div>
  );
}

function LetterPrintable({ letter }: { letter: ExecutorLetter }) {
  return (
    <article className="print-sheet mx-auto max-w-[170mm] border border-ink/20 bg-white p-10 text-ink shadow-sm">
      <header className="border-b-2 border-ink pb-4">
        <h1 className="text-lg font-bold uppercase tracking-wide">{letter.title}</h1>
        <p className="mt-2 text-sm">
          Prepared by <strong>{letter.ownerName}</strong>
        </p>
        <p className="text-xs text-ink/70">
          Vault: {letter.vaultLabel} · Generated {letter.generatedAt.slice(0, 10)}
        </p>
        <p className="mt-3 border border-ink px-3 py-2 text-xs font-bold uppercase">
          Keep this with the will. It contains no passphrase and no keys.
        </p>
      </header>

      {letter.sections.map((section) => (
        <section key={section.heading} className="mt-7 print-keep-together">
          <h2 className="text-sm font-bold uppercase tracking-wide">{section.heading}</h2>
          {section.paragraphs.map((p, i) => (
            <p key={i} className="mt-2 text-sm leading-relaxed">
              {p}
            </p>
          ))}

          {section.steps?.length ? (
            <ol className="mt-4 space-y-4">
              {section.steps.map((step) => (
                <li key={step.order} className="print-keep-together border-l-2 border-ink pl-4">
                  <p className="text-sm font-semibold">
                    {step.order}. {step.label}
                    <span className="ml-2 font-normal text-ink/60">[{step.pointType}]</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Holds:</span> {step.holds}
                  </p>
                  {step.lines.map((line, i) => (
                    <p key={i} className="text-sm">
                      {line}
                    </p>
                  ))}
                  <p className="mt-1 text-xs text-ink/60">
                    Last confirmed by {letter.ownerName}: {step.lastVerified}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ))}

      <section className="mt-10 border-t-2 border-ink pt-5 print-keep-together">
        <h2 className="text-sm font-bold uppercase tracking-wide">Signature</h2>
        <div className="mt-4 space-y-7">
          {letter.handwrittenFields.map((field) => (
            <div key={field}>
              <div className="h-7 border-b border-ink" />
              <p className="mt-1 text-xs text-ink/70">{field}</p>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
