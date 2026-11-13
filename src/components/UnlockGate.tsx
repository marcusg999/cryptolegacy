'use client';

import { useCallback, useEffect, useState } from 'react';

import { normalisePassphraseInput } from '@/lib/crypto/diceware';
import {
  VaultIntegrityError,
  WrongPassphraseError,
  unlockVault,
} from '@/lib/crypto/vault';
import { loadKeyRecords, recordAudit } from '@/lib/vault-api';
import { lock, startSession, subscribe } from '@/lib/vault-session';
import { Button, Card, HardWarning } from '@/components/ui';

/**
 * The unlock screen, and the gate every page showing decrypted content sits behind.
 *
 * Everything here happens locally. The key records are fetched (they contain a
 * salt, a wrapped master key and a sentinel — no secret), Argon2id runs in this
 * tab, and the sentinel decides. The only thing the server learns is that an
 * attempt succeeded or failed, which is what it needs in order to rate-limit.
 *
 * Rate limiting is, honestly, mostly theatre at this layer: an attacker who has
 * the database does not need our unlock endpoint. What actually defends the
 * vault is 155 bits of passphrase entropy and the Argon2id cost. The attempt
 * counter here exists to slow down someone at the keyboard of an unlocked,
 * signed-in laptop.
 */
export function UnlockGate({
  vaultId,
  vaultLabel,
  lockTimeoutSeconds,
  children,
}: {
  vaultId: string;
  vaultLabel: string;
  lockTimeoutSeconds: number;
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [lastLockReason, setLastLockReason] = useState<string | null>(null);

  useEffect(
    () =>
      subscribe((status) => {
        setUnlocked(status.unlocked && status.vaultId === vaultId);
        setLastLockReason(status.lastLockReason);
      }),
    [vaultId],
  );

  if (unlocked) {
    return (
      <>
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          <span className="text-ink">
            <strong>{vaultLabel}</strong> is unlocked in this tab. It relocks after{' '}
            {Math.round(lockTimeoutSeconds / 60)} minutes idle, and immediately if you switch away
            from this tab.
          </span>
          <Button variant="secondary" onClick={() => lock('manual')}>
            Lock now
          </Button>
        </div>
        {children}
      </>
    );
  }

  return (
    <UnlockForm
      vaultId={vaultId}
      vaultLabel={vaultLabel}
      lockTimeoutSeconds={lockTimeoutSeconds}
      lastLockReason={lastLockReason}
    />
  );
}

function UnlockForm({
  vaultId,
  vaultLabel,
  lockTimeoutSeconds,
  lastLockReason,
}: {
  vaultId: string;
  vaultLabel: string;
  lockTimeoutSeconds: number;
  lastLockReason: string | null;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  // The cooldown end is a timestamp set in the submit handler, and the ticking
  // clock is the only thing the effect touches. Deriving the remaining seconds
  // rather than storing them keeps setState out of the effect body, and makes
  // the countdown correct across a backgrounded tab, where interval callbacks
  // are throttled and a decrement-per-tick counter drifts.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy || cooldownLeft > 0) return;

      setBusy(true);
      setError(null);
      setIntegrityError(null);
      setProgress(0);

      try {
        const keyRecords = await loadKeyRecords(vaultId);
        const result = await unlockVault({
          passphrase: normalisePassphraseInput(passphrase),
          vaultId,
          keyRecords,
          onProgress: setProgress,
        });

        // Drop the typed phrase before anything else happens.
        setPassphrase('');

        startSession({
          vaultId,
          keyRecordId: result.keyRecordId,
          kind: result.kind,
          key: result.vaultMasterKey,
          idleTimeoutSeconds: lockTimeoutSeconds,
        });

        await recordAudit({
          vaultId,
          action: 'vault.unlocked',
          metadata: { attempts: attempts + 1 },
        });
      } catch (e) {
        const attemptNumber = attempts + 1;
        setAttempts(attemptNumber);
        // Exponential backoff from the third failure. Honest about its worth:
        // against someone holding the database this is nothing, because they do
        // not need our unlock screen. It slows down a person at the keyboard of
        // an unlocked, signed-in laptop, which is a real if narrower threat.
        if (attemptNumber >= 3) {
          setCooldownUntil(Date.now() + Math.min(60, 2 ** (attemptNumber - 2)) * 1000);
          setNow(Date.now());
        }
        if (e instanceof WrongPassphraseError) {
          setError(
            'That passphrase does not open this vault. Check your written copy — all lower case, ' +
              'single spaces, and watch for words that look similar in handwriting.',
          );
          await recordAudit({ vaultId, action: 'vault.unlock_failed' });
        } else if (e instanceof VaultIntegrityError) {
          setIntegrityError(e.message);
          await recordAudit({
            vaultId,
            action: 'vault.integrity_failure',
            metadata: { key_record: e.keyRecordId },
          });
        } else {
          setError(e instanceof Error ? e.message : 'The vault could not be unlocked.');
        }
      } finally {
        setBusy(false);
        setProgress(0);
      }
    },
    [busy, cooldownLeft, vaultId, passphrase, lockTimeoutSeconds, attempts],
  );

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Unlock {vaultLabel}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          Type your passphrase from your written copy. It is checked in this browser — it is not
          sent to us, and we could not check it if it were.
        </p>
        {lastLockReason === 'idle_timeout' ? (
          <p className="mt-2 text-sm text-ink/60">Locked automatically after a period of inactivity.</p>
        ) : null}
        {lastLockReason === 'page_hidden' ? (
          <p className="mt-2 text-sm text-ink/60">
            Locked because this tab was hidden. A backgrounded tab is where a phone gets handed to
            someone else.
          </p>
        ) : null}
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="t-mono block text-ink/80">Vault passphrase</span>
            <textarea
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              rows={3}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              disabled={busy}
              className="mt-2 w-full border border-[#2A3B4F] bg-[#070D16] p-3 font-mono text-base text-ink focus:border-[#2A3B4F] focus:outline-none focus:ring-1 focus:ring-ink"
              placeholder="word word word …"
            />
          </label>

          {busy ? (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-glow/10">
                <div
                  className="h-full rounded-full bg-glow transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-ink/60">
                Stretching your passphrase with Argon2id — {Math.round(progress * 100)}%. The delay
                is the defence.
              </p>
            </div>
          ) : null}

          <Button type="submit" disabled={busy || passphrase.trim().length === 0 || cooldownLeft > 0}>
            {busy ? 'Unlocking…' : cooldownLeft > 0 ? `Wait ${cooldownLeft}s` : 'Unlock'}
          </Button>
        </form>

        {error ? (
          <p className="mt-4 rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
            {error}
          </p>
        ) : null}

        {attempts >= 3 && !integrityError ? (
          <p className="mt-3 text-xs text-ink/60">
            {attempts} failed attempts. There is no lockout that would help here and no reset to
            offer — if the written copy cannot be found, the contents of this vault are not
            recoverable by us or by anyone. Check every custody location before concluding it is
            lost.
          </p>
        ) : null}
      </Card>

      {integrityError ? (
        <HardWarning title="Your passphrase is correct — the stored record is damaged">
          <p>{integrityError}</p>
          <p>
            Do not create a new vault and do not change anything. This is recoverable from backup
            on our side; re-creating the vault would not be.
          </p>
        </HardWarning>
      ) : null}
    </div>
  );
}
