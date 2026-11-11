'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { generatePassphrase, type GeneratedPassphrase } from '@/lib/crypto/diceware';
import {
  DEFAULT_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  RECOMMENDED_SPLIT_WORDS,
} from '@/lib/crypto/constants';
import { createVault } from '@/lib/crypto/vault';
import { createVaultRecords } from '@/lib/vault-api';
import { startSession } from '@/lib/vault-session';
import { PassphraseDisplay } from '@/components/PassphraseDisplay';
import { TranscriptionCheck } from '@/components/TranscriptionCheck';
import { TranscriptionSheet } from '@/components/TranscriptionSheet';
import { Button, Card, Field, H1, HardWarning, Lead, Page, inputClass } from '@/components/ui';

type Step = 'details' | 'sheet' | 'display' | 'transcribe' | 'creating';

/**
 * Vault creation.
 *
 * The step order is the point of this screen, not an arbitrary wizard: the
 * printable sheet comes BEFORE the phrase is shown, so the user has somewhere to
 * write it when they first see it. Spec §3.2 requires the physical artefact to
 * exist before anything depends on it, and a user who sees the phrase first will
 * reach for a screenshot while they go looking for paper.
 *
 * The passphrase lives in component state for the length of this flow and is
 * never sent anywhere. `createVault` consumes it to derive the key-encryption
 * key; what gets persisted is a salt, a wrapped master key and a sentinel.
 */
export default function NewVaultPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('details');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [wordCount, setWordCount] = useState(DEFAULT_PASSPHRASE_WORDS);
  const [generated, setGenerated] = useState<GeneratedPassphrase | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setGenerated(generatePassphrase(wordCount));
    setStep('sheet');
  }, [wordCount]);

  const create = useCallback(async () => {
    if (!generated) return;
    setStep('creating');
    setError(null);
    try {
      const vaultId = crypto.randomUUID();
      const keyRecordId = crypto.randomUUID();

      const { keyRecord, vaultMasterKey } = await createVault({
        passphrase: generated.phrase,
        vaultId,
        keyRecordId,
        onProgress: setProgress,
      });

      await createVaultRecords({
        vaultId,
        label: label.trim(),
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        keyRecord,
      });

      // Drop the only reference to the phrase. Not a guarantee — the string may
      // survive in a GC'd buffer — but it closes the window we control.
      setGenerated(null);

      startSession({
        vaultId,
        keyRecordId,
        kind: 'primary',
        key: vaultMasterKey,
        idleTimeoutSeconds: 300,
      });

      router.push(`/vaults/${vaultId}/custody?created=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The vault could not be created.');
      setStep('transcribe');
    }
  }, [generated, label, purpose, router]);

  return (
    <Page>
      {step === 'details' ? (
        <>
          <H1>Create a vault</H1>
          <Lead>
            One vault holds the records, instructions and messages for one set of assets and one
            set of beneficiaries. Personal, business and trust assets usually want separate vaults,
            because they often have different executors.
          </Lead>

          <div className="mt-8 max-w-xl space-y-5">
            <Card>
              <div className="space-y-5">
                <Field
                  label="Vault name"
                  hint="Stored unencrypted, so we can show it to you before you unlock. Keep it boring — “Personal crypto”, not “Ledger in the hall safe”."
                >
                  <input
                    className={inputClass}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={120}
                    placeholder="Personal crypto"
                  />
                </Field>

                <Field
                  label="What is in it (optional)"
                  hint="Also unencrypted. A note to your future self and your executor about scope, not contents."
                >
                  <input
                    className={inputClass}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    maxLength={400}
                    placeholder="Long-term holdings and the hardware wallets"
                  />
                </Field>

                <Field
                  label="Passphrase length"
                  hint={`${MIN_PASSPHRASE_WORDS} words is about 155 bits and is not brute-forceable. Choose ${RECOMMENDED_SPLIT_WORDS} or more only if you intend to split the phrase across custodians, where each holder knows part of it.`}
                >
                  <select
                    className={inputClass}
                    value={wordCount}
                    onChange={(e) => setWordCount(Number(e.target.value))}
                  >
                    {[12, 15, 18, 21, 24].map((n) => (
                      <option key={n} value={n}>
                        {n} words{n === 12 ? ' — recommended' : ''}
                        {n === 15 ? ' — recommended if splitting' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Card>

            <HardWarning title="Read this before you continue">
              <p>
                In a moment your browser will generate a passphrase and show it to you once. We
                will never see it. We cannot reset it, recover it, or help you guess it.
              </p>
              <p>
                You will need paper and a pen. Have them now — the next screen is a printable sheet
                to write on.
              </p>
            </HardWarning>

            <Button onClick={generate} disabled={label.trim().length === 0}>
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === 'sheet' && generated ? (
        <>
          <div className="no-print">
            <H1>Print the transcription sheet first</H1>
            <Lead>
              The sheet prints blank. You write the words on it by hand in a moment. We do not
              print the phrase for you, because printing sends it through a spooler and onto a
              disk, and quite possibly into a shared printer&rsquo;s job history.
            </Lead>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => window.print()}>Print this sheet</Button>
              <Button variant="secondary" onClick={() => setStep('display')}>
                I have paper — show me the passphrase
              </Button>
            </div>
          </div>

          <div className="mt-8">
            <TranscriptionSheet wordCount={generated.wordCount} vaultLabel={label.trim()} />
          </div>
        </>
      ) : null}

      {step === 'display' && generated ? (
        <>
          <div className="no-print">
            <H1>Your passphrase</H1>
          </div>
          <div className="mt-6">
            <PassphraseDisplay words={generated.words} onContinue={() => setStep('transcribe')} />
          </div>
        </>
      ) : null}

      {step === 'transcribe' && generated ? (
        <>
          <H1>Confirm your written copy</H1>
          <div className="mt-6 max-w-2xl">
            <TranscriptionCheck
              words={generated.words}
              onConfirmed={create}
              onBack={() => setStep('display')}
            />
            {error ? (
              <div className="mt-5 border border-danger/40 bg-danger/5 p-4 text-sm text-ink">
                {error}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {step === 'creating' ? (
        <>
          <H1>Creating your vault</H1>
          <Lead>
            Stretching your passphrase with Argon2id. This is intentionally slow — it is the step
            that makes a stolen copy of our database expensive to attack.
          </Lead>
          <div className="mt-6 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-glow/10">
              <div
                className="h-full rounded-full bg-glow transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink/60">
              {Math.round(progress * 100)}% — do not close this tab.
            </p>
          </div>
        </>
      ) : null}
    </Page>
  );
}
