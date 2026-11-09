'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  createTextItem,
  deleteItem,
  listItems,
  readTextItem,
  updateTextItem,
  type ItemSummary,
} from '@/lib/vault-api';
import {
  BLOCK_RUN_LENGTH,
  PassphraseInContentError,
  assertNoPassphraseInContent,
  scanForPassphraseLikeRun,
} from '@/lib/custody/passphrase-guard';
import { Button, Card, Field, H2, inputClass } from '@/components/ui';
import type { DisclosureStageRow } from '@/lib/supabase/types';

/**
 * Vault CRUD for text items. Build-order step 3.
 *
 * Encryption happens in `vault-session`, which holds the master key; this
 * component never sees key material. Note the disclosure stage on every item:
 * spec §6.2 reveals content to an executor in a fixed order, messages first and
 * wallet access last, and asking the user which stage an item belongs to while
 * they are writing it is far more reliable than inferring it later.
 */

const STAGES: ReadonlyArray<{ value: DisclosureStageRow; label: string; help: string }> = [
  {
    value: 'messages',
    label: '1 — Personal messages',
    help: 'Letters to beneficiaries. Released first.',
  },
  {
    value: 'inventory_education',
    label: '2 — Inventory and explanation',
    help: 'What exists, what it is, roughly what it is worth, how to use it.',
  },
  {
    value: 'legal_documents',
    label: '3 — Legal documents',
    help: 'Copies of the will, trust documents, the probate packet.',
  },
  {
    value: 'wallet_access',
    label: '4 — Wallet access',
    help: 'Recovery instructions and key locations. Released last, deliberately.',
  },
];

export function VaultItems({ vaultId }: { vaultId: string }) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listItems(vaultId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load items.');
    }
  }, [vaultId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await listItems(vaultId);
        if (!cancelled) setItems(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load items.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">{error}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <H2>Vault contents</H2>
        <Button onClick={() => setComposing((c) => !c)} variant={composing ? 'secondary' : 'primary'}>
          {composing ? 'Cancel' : 'Add an item'}
        </Button>
      </div>

      {composing ? (
        <ItemComposer
          vaultId={vaultId}
          onSaved={async () => {
            setComposing(false);
            await refresh();
          }}
        />
      ) : null}

      {items === null ? (
        <p className="text-sm text-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-ink/70">
            Nothing stored yet. A good first item is a plain-language note describing what assets
            exist and where the hardware is — useful to an executor even if they never open the
            rest of the vault.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <ItemRowView key={item.id} vaultId={vaultId} item={item} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemComposer({
  vaultId,
  onSaved,
}: {
  vaultId: string;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [stage, setStage] = useState<DisclosureStageRow>('inventory_education');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = scanForPassphraseLikeRun(text);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Spec §1.1 and §11: the passphrase must never be stored in the vault it
      // unlocks. Checked here before anything is encrypted or sent.
      assertNoPassphraseInContent(text, 'This item');
      assertNoPassphraseInContent(name, 'The item name');
      await createTextItem({ vaultId, name: name.trim(), text, disclosureStage: stage });
      setName('');
      setText('');
      await onSaved();
    } catch (e) {
      setError(
        e instanceof PassphraseInContentError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not save the item.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="space-y-4">
        <Field
          label="Name"
          hint="Not encrypted. Describe the item without revealing its contents."
        >
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="Hardware wallet locations and models"
          />
        </Field>

        <Field label="Contents" hint="Encrypted in this browser before it is sent.">
          <textarea
            className={`${inputClass} font-mono`}
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </Field>

        {scan.warn && !scan.block ? (
          <p className="rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink">
            This looks like it might contain part of a passphrase or seed phrase ({scan.longestRun}{' '}
            consecutive words from the wordlist). Check before saving — a secret stored inside the
            vault it unlocks is protected by nothing.
          </p>
        ) : null}

        {scan.block ? (
          <p className="rounded border-2 border-danger bg-danger/5 p-3 text-sm text-ink">
            <strong>This will not be saved.</strong> It contains {scan.longestRun} consecutive
            words from the passphrase wordlist, which is{' '}
            {scan.longestRun >= BLOCK_RUN_LENGTH ? 'unmistakably' : 'likely'} a passphrase or seed
            phrase. Those belong on paper, in the places your custody plan names — never in the
            vault, and never anywhere this app can reach.
          </p>
        ) : null}

        <Field label="When should your executor see this?" hint="Spec §6.2 staged disclosure.">
          <select
            className={inputClass}
            value={stage}
            onChange={(e) => setStage(e.target.value as DisclosureStageRow)}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.help}
              </option>
            ))}
          </select>
        </Field>

        {error ? (
          <p className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
            {error}
          </p>
        ) : null}

        <Button
          onClick={save}
          disabled={busy || name.trim().length === 0 || text.length === 0 || scan.block}
        >
          {busy ? 'Encrypting…' : 'Encrypt and save'}
        </Button>
      </div>
    </Card>
  );
}

function ItemRowView({
  vaultId,
  item,
  onChanged,
}: {
  vaultId: string;
  item: ItemSummary;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const text = await readTextItem(vaultId, item.id);
      setPlaintext(text);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decrypt this item.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      assertNoPassphraseInContent(draft, 'This item');
      await updateTextItem({ vaultId, itemId: item.id, name: item.name, text: draft });
      setPlaintext(draft);
      setDraft(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const stage = STAGES.find((s) => s.value === item.disclosureStage);

  return (
    <li className="rounded-lg border border-ink/15 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{item.name}</p>
          <p className="mt-1 text-xs text-ink/50">
            {item.plaintextBytes} bytes · version {item.version} · updated{' '}
            {new Date(item.updatedAt).toISOString().slice(0, 10)}
            {stage ? ` · released at stage ${stage.label.charAt(0)}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {open ? (
            <Button variant="secondary" onClick={() => { setOpen(false); setPlaintext(null); setDraft(null); }}>
              Hide
            </Button>
          ) : (
            <Button variant="secondary" onClick={reveal} disabled={busy}>
              {busy ? 'Decrypting…' : 'Open'}
            </Button>
          )}
          <Button
            variant="danger"
            onClick={async () => {
              await deleteItem(vaultId, item.id);
              await onChanged();
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded border border-danger/40 bg-danger/5 p-3 text-sm text-ink">
          {error}
        </p>
      ) : null}

      {open && plaintext !== null ? (
        <div className="mt-4 space-y-3">
          <textarea
            className={`${inputClass} font-mono`}
            rows={10}
            value={draft ?? plaintext}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          {draft !== null && draft !== plaintext ? (
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save new version'}
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Discard changes
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-ink/50">
            Saving keeps the previous version. Edits never destroy what was there before — wills get
            amended and wallets get migrated, and a mistaken edit here can mean unrecoverable money.
          </p>
        </div>
      ) : null}
    </li>
  );
}
