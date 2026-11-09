'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
} from '@/lib/crypto/constants';
import { reviewPlan } from '@/lib/custody/entropy';
import { assessCustodyHealth } from '@/lib/custody/health';
import {
  ALLOWED_VERIFICATION_INTERVALS_MONTHS,
  AT_RISK_AFTER_MONTHS,
  CUSTODY_POINT_TYPES,
  type CustodyHolding,
  type CustodyMode,
  type CustodyPoint,
  type CustodyPointType,
} from '@/lib/custody/types';
import {
  addCustodyPoint,
  decryptCustodyPoints,
  deleteCustodyPoint,
  upsertCustodyPlan,
} from '@/lib/custody-api';
import { recordCustodyCheck } from '@/lib/vault-api';
import { CustodyModeChoice } from '@/components/CustodyModeChoice';
import { Button, Card, Field, H2, StatusPill, inputClass } from '@/components/ui';
import type { CustodyPlanRow, CustodyPointRow } from '@/lib/supabase/types';

export function CustodyPlanner({
  vaultId,
  vaultLabel,
  existingPlan,
  existingPoints,
  keyRecordCount,
}: {
  vaultId: string;
  vaultLabel: string;
  existingPlan: CustodyPlanRow | null;
  existingPoints: CustodyPointRow[];
  keyRecordCount: number;
}) {
  const [mode, setMode] = useState<CustodyMode | null>(existingPlan?.mode ?? null);
  const [partCount, setPartCount] = useState(existingPlan?.part_count ?? 2);
  const [wordCount, setWordCount] = useState(
    existingPlan?.passphrase_word_count ?? DEFAULT_PASSPHRASE_WORDS,
  );
  const [interval, setInterval] = useState(existingPlan?.verification_interval_months ?? 12);
  const [points, setPoints] = useState<CustodyPoint[] | null>(null);
  const [rows, setRows] = useState<CustodyPointRow[]>(existingPoints);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Decrypting custody detail needs the unlocked vault, so it happens here
  // rather than on the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decrypted = await decryptCustodyPoints(vaultId, rows);
        if (!cancelled) setPoints(decrypted);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not decrypt the custody plan.');
          setPoints([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultId, rows]);

  const review = useMemo(
    () =>
      mode
        ? reviewPlan({
            mode,
            passphraseWordCount: wordCount,
            partCount: mode === 'split' ? partCount : 1,
            points: (points ?? []).map((p) => p.meta),
          })
        : null,
    [mode, wordCount, partCount, points],
  );

  const health = useMemo(
    () =>
      assessCustodyHealth(
        {
          verificationIntervalMonths: interval,
          planLastModifiedAt: existingPlan?.plan_last_modified_at ?? null,
          letterLastGeneratedAt: existingPlan?.letter_last_generated_at ?? null,
        },
        (points ?? []).map((p) => p.meta),
      ),
    [interval, existingPlan, points],
  );

  const reload = useCallback(async () => {
    const { listCustodyPoints } = await import('@/lib/vault-api');
    setRows(await listCustodyPoints(vaultId));
  }, [vaultId]);

  const savePlan = useCallback(async () => {
    if (!mode) return;
    setSaving(true);
    setError(null);
    try {
      await upsertCustodyPlan({
        vaultId,
        mode,
        passphraseWordCount: wordCount,
        partCount: mode === 'split' ? partCount : 1,
        verificationIntervalMonths: interval,
      });
      setSavedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan.');
    } finally {
      setSaving(false);
    }
  }, [mode, vaultId, wordCount, partCount, interval]);

  return (
    <div className="space-y-10">
      {error ? (
        <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">{error}</p>
      ) : null}

      {/* -------------------------------------------------- step 1 */}
      <section>
        <H2>1. How long is your passphrase?</H2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
          We do not store your passphrase, so we cannot count its words — you have to tell us. The
          number drives the entropy arithmetic below, and it is the only thing that makes a safe
          split distinguishable from a dangerous one.
          {keyRecordCount > 1
            ? ' This vault also has a duress key record, which does not change this number.'
            : ''}
        </p>
        <div className="mt-4 max-w-xs">
          <Field label="Words in your vault passphrase">
            <select
              className={inputClass}
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
            >
              {[12, 15, 18, 21, 24, 30, 36]
                .filter((n) => n >= MIN_PASSPHRASE_WORDS)
                .map((n) => (
                  <option key={n} value={n}>
                    {n} words
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </section>

      {/* -------------------------------------------------- step 2 */}
      <section>
        <H2>2. Redundancy or split?</H2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
          Choose deliberately. Most people who get this wrong get it wrong by not choosing at all.
        </p>
        <div className="mt-5">
          <CustodyModeChoice
            mode={mode}
            partCount={partCount}
            wordCount={wordCount}
            onModeChange={setMode}
            onPartCountChange={setPartCount}
          />
        </div>
      </section>

      {/* -------------------------------------------------- step 3 */}
      <section>
        <H2>3. How often should we check with you?</H2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
          We will ask you to confirm each custody point is still reachable and intact, and send you
          a dated report. Anything unverified for more than {AT_RISK_AFTER_MONTHS} months gets
          flagged on your dashboard regardless of the interval you pick.
        </p>
        <div className="mt-4 max-w-xs">
          <Field label="Verification interval">
            <select
              className={inputClass}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              {ALLOWED_VERIFICATION_INTERVALS_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m === 12 ? 'Annually (default)' : `Every ${m} months`}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4">
          <Button onClick={savePlan} disabled={!mode || saving}>
            {saving ? 'Saving…' : existingPlan ? 'Update the plan' : 'Save the plan'}
          </Button>
          {savedAt ? (
            <span className="ml-3 text-xs text-ok">Saved. Reload to see the latest warnings.</span>
          ) : null}
        </div>
      </section>

      {/* -------------------------------------------------- step 4 */}
      <section>
        <H2>4. Who and where</H2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
          Everything you type here is encrypted in this browser before it is sent. We store one
          opaque blob per custody point — we could not produce a list of where people keep their
          passphrases if we were ordered to.
        </p>

        {points === null ? (
          <p className="mt-4 text-sm text-ink/60">Decrypting…</p>
        ) : (
          <div className="mt-5 space-y-4">
            {points.length === 0 ? (
              <Card tone="danger">
                <p className="text-sm text-ink">
                  <strong>No custody points yet.</strong> Right now nobody and nowhere holds your
                  passphrase, which means this vault cannot be inherited. If you were to die today,
                  your executor would find encrypted data and no way in.
                </p>
              </Card>
            ) : (
              <ul className="space-y-3">
                {points
                  .slice()
                  .sort((a, b) => a.meta.displayOrder - b.meta.displayOrder)
                  .map((point) => {
                    const pointHealth = health.points.find((h) => h.pointId === point.meta.id);
                    return (
                      <li
                        key={point.meta.id}
                        className="rounded-lg border border-ink/15 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-ink">{point.detail.label}</p>
                            <p className="mt-1 text-xs text-ink/60">
                              {point.meta.pointType} ·{' '}
                              {point.meta.holding === 'split_part'
                                ? `part ${point.meta.partIndex} of ${partCount}`
                                : 'full copy'}
                            </p>
                            {point.detail.custodianName ? (
                              <p className="mt-1 text-sm text-ink/75">
                                Held by {point.detail.custodianName}
                              </p>
                            ) : null}
                            {point.detail.locationNotes ? (
                              <p className="mt-0.5 text-sm text-ink/60">
                                {point.detail.locationNotes}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {pointHealth?.status === 'at_risk' ? (
                              <StatusPill tone="risk">
                                At risk — {pointHealth.monthsSinceVerified} months
                              </StatusPill>
                            ) : pointHealth?.status === 'due' ? (
                              <StatusPill tone="due">Due for a check</StatusPill>
                            ) : pointHealth?.status === 'never_verified' ? (
                              <StatusPill tone="never">Never verified</StatusPill>
                            ) : (
                              <StatusPill tone="ok">
                                Verified {pointHealth?.monthsSinceVerified ?? 0} months ago
                              </StatusPill>
                            )}
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
                                onClick={async () => {
                                  await recordCustodyCheck({
                                    vaultId,
                                    pointId: point.meta.id,
                                    outcome: 'intact',
                                  });
                                  await reload();
                                }}
                              >
                                Confirm intact
                              </Button>
                              <Button
                                variant="danger"
                                onClick={async () => {
                                  await deleteCustodyPoint(vaultId, point.meta.id);
                                  await reload();
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}

            <AddPointForm
              vaultId={vaultId}
              mode={mode}
              partCount={partCount}
              nextOrder={points.length}
              usedParts={points
                .map((p) => p.meta.partIndex)
                .filter((i): i is number => i !== null)}
              onAdded={reload}
            />
          </div>
        )}
      </section>

      {/* -------------------------------------------------- review */}
      {review ? (
        <section>
          <H2>What is wrong with this plan</H2>
          {review.issues.length === 0 ? (
            <Card tone="ok">
              <p className="text-sm text-ink">
                Nothing. This arrangement survives the failures it is meant to survive.
              </p>
            </Card>
          ) : (
            <ul className="mt-4 space-y-3">
              {review.issues.map((issue) => (
                <li
                  key={issue.code}
                  className={`rounded-lg border p-4 text-sm ${
                    issue.severity === 'blocker'
                      ? 'border-danger bg-danger/5'
                      : issue.severity === 'warning'
                        ? 'border-warn/50 bg-warn/5'
                        : 'border-ink/20 bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    {issue.severity === 'blocker'
                      ? 'Must fix'
                      : issue.severity === 'warning'
                        ? 'Should fix'
                        : 'Note'}
                  </p>
                  <p className="mt-1 text-ink">{issue.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* -------------------------------------------------- letter */}
      <section>
        <H2>5. The Executor Letter</H2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
          Your executor needs to know where the passphrase is, but storing that in plaintext would
          hand our database a treasure map. So the letter is generated here, in your browser, you
          print it, and we do not keep it. Store the printed copy with your will, which is where
          executors already look.
        </p>
        <div className="mt-4">
          <Link
            href={`/vaults/${vaultId}/letter`}
            className="inline-flex items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-soft"
          >
            {health.letterNeverGenerated
              ? 'Generate the Executor Letter'
              : health.letterOutOfDate
                ? 'Regenerate — the plan has changed since you printed it'
                : 'View or reprint the Executor Letter'}
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink/50">Vault: {vaultLabel}</p>
      </section>
    </div>
  );
}

function AddPointForm({
  vaultId,
  mode,
  partCount,
  nextOrder,
  usedParts,
  onAdded,
}: {
  vaultId: string;
  mode: CustodyMode | null;
  partCount: number;
  nextOrder: number;
  usedParts: number[];
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [pointType, setPointType] = useState<CustodyPointType>('institution');
  const [custodianName, setCustodianName] = useState('');
  const [contact, setContact] = useState('');
  const [locationNotes, setLocationNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [partIndex, setPartIndex] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holding: CustodyHolding = mode === 'split' ? 'split_part' : 'full_copy';
  const missingParts = Array.from({ length: partCount }, (_, i) => i + 1).filter(
    (i) => !usedParts.includes(i),
  );

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={!mode}>
        {mode ? 'Add a custody point' : 'Choose redundancy or split first'}
      </Button>
    );
  }

  return (
    <Card>
      <div className="space-y-4">
        <Field label="Label" hint="How you will recognise it. Encrypted.">
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Golden One safe deposit box"
          />
        </Field>

        <Field label="Type" hint="Stored unencrypted, so we can warn you about correlated risks.">
          <select
            className={inputClass}
            value={pointType}
            onChange={(e) => setPointType(e.target.value as CustodyPointType)}
          >
            {CUSTODY_POINT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        {mode === 'split' ? (
          <Field label="Which part does this hold?">
            <select
              className={inputClass}
              value={partIndex}
              onChange={(e) => setPartIndex(Number(e.target.value))}
            >
              {Array.from({ length: partCount }, (_, i) => i + 1).map((i) => (
                <option key={i} value={i}>
                  Part {i} of {partCount}
                  {usedParts.includes(i) ? ' (already assigned)' : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Who holds it (optional)" hint="Encrypted.">
          <input
            className={inputClass}
            value={custodianName}
            onChange={(e) => setCustodianName(e.target.value)}
            placeholder="Reed & Vance LLP"
          />
        </Field>

        <Field label="How to reach them (optional)" hint="Encrypted.">
          <input
            className={inputClass}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="(916) 555-0100"
          />
        </Field>

        <Field label="Where exactly (optional)" hint="Encrypted. Your executor will read this.">
          <textarea
            className={inputClass}
            rows={2}
            value={locationNotes}
            onChange={(e) => setLocationNotes(e.target.value)}
            placeholder="Box 418, Howe Avenue branch. Brass key taped under the top desk drawer."
          />
        </Field>

        <Field
          label="Anything else (optional)"
          hint="Encrypted. Never put the passphrase itself here — we will refuse to save it."
        >
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
            {error}
          </p>
        ) : null}

        {mode === 'split' && missingParts.length > 0 ? (
          <p className="text-xs text-ink/60">
            Still unassigned: {missingParts.map((p) => `part ${p}`).join(', ')}. Every part needs a
            holder or the vault cannot be opened as planned.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            disabled={busy || label.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await addCustodyPoint({
                  vaultId,
                  pointType,
                  holding,
                  partIndex: holding === 'split_part' ? partIndex : null,
                  detail: {
                    label: label.trim(),
                    ...(custodianName.trim() ? { custodianName: custodianName.trim() } : {}),
                    ...(contact.trim() ? { contact: contact.trim() } : {}),
                    ...(locationNotes.trim() ? { locationNotes: locationNotes.trim() } : {}),
                    ...(notes.trim() ? { notes: notes.trim() } : {}),
                  },
                  displayOrder: nextOrder,
                });
                setLabel('');
                setCustodianName('');
                setContact('');
                setLocationNotes('');
                setNotes('');
                setOpen(false);
                await onAdded();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not add the custody point.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Encrypting…' : 'Add'}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
