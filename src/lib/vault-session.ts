'use client';

/**
 * The unlocked-vault session: a vault master key held in memory, and nowhere else.
 *
 * Spec §5.1: "The VMK exists only in browser memory during an unlocked session.
 * Zero it on lock, tab close, and timeout."
 *
 * Things this module deliberately does not do, each of which would look like a
 * convenience and would break the security model:
 *
 *   - It does not write to localStorage, sessionStorage, IndexedDB or a cookie.
 *     A persisted master key survives the tab, the browser and the user walking
 *     away from the machine.
 *   - It does not put the key in React state or a context value. Those end up in
 *     devtools, in error-boundary payloads and in anything that serialises a
 *     component tree. The key lives in a module-scoped variable and the rest of
 *     the app gets a handle plus the operations it needs.
 *   - It does not keep the passphrase at all. The passphrase is consumed by
 *     `unlockVault` and the string is dropped on the next line.
 *
 * The master key is a non-extractable `CryptoKey`, so even with the handle in
 * scope JavaScript cannot read the bytes out — a heap snapshot of an unlocked
 * tab does not yield the key.
 */

import { openItem, openText, sealItem, sealText, type SealedItem } from '@/lib/crypto/envelope';

export type LockReason = 'manual' | 'idle_timeout' | 'page_hidden' | 'navigation' | 'error';

interface SessionState {
  readonly vaultId: string;
  readonly keyRecordId: string;
  readonly kind: 'primary' | 'duress';
  readonly key: CryptoKey;
  readonly unlockedAt: number;
  lastActivityAt: number;
  idleTimeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let state: SessionState | null = null;

type Listener = (status: VaultSessionStatus) => void;
const listeners = new Set<Listener>();

export interface VaultSessionStatus {
  readonly unlocked: boolean;
  readonly vaultId: string | null;
  readonly kind: 'primary' | 'duress' | null;
  readonly unlockedAt: number | null;
  readonly expiresAt: number | null;
  readonly lastLockReason: LockReason | null;
}

let lastLockReason: LockReason | null = null;

function snapshot(): VaultSessionStatus {
  if (!state) {
    return {
      unlocked: false,
      vaultId: null,
      kind: null,
      unlockedAt: null,
      expiresAt: null,
      lastLockReason,
    };
  }
  return {
    unlocked: true,
    vaultId: state.vaultId,
    kind: state.kind,
    unlockedAt: state.unlockedAt,
    expiresAt: state.lastActivityAt + state.idleTimeoutMs,
    lastLockReason,
  };
}

function notify(): void {
  const status = snapshot();
  for (const listener of listeners) listener(status);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function getStatus(): VaultSessionStatus {
  return snapshot();
}

export function isUnlocked(vaultId?: string): boolean {
  if (!state) return false;
  return vaultId ? state.vaultId === vaultId : true;
}

/**
 * Begin an unlocked session.
 *
 * Any existing session is locked first. Holding two master keys at once is never
 * needed and would double the window in which key material is resident.
 */
export function startSession(params: {
  vaultId: string;
  keyRecordId: string;
  kind: 'primary' | 'duress';
  key: CryptoKey;
  /** Spec §5.3: a separate, shorter timeout than the auth session. */
  idleTimeoutSeconds: number;
}): void {
  if (state) lock('navigation');

  const now = Date.now();
  state = {
    vaultId: params.vaultId,
    keyRecordId: params.keyRecordId,
    kind: params.kind,
    key: params.key,
    unlockedAt: now,
    lastActivityAt: now,
    idleTimeoutMs: Math.max(60, params.idleTimeoutSeconds) * 1000,
    timer: null,
  };
  armTimer();
  installGlobalHandlers();
  lastLockReason = null;
  notify();
}

/** Extend the idle window. Called by the UI on real user interaction only. */
export function touch(): void {
  if (!state) return;
  state.lastActivityAt = Date.now();
  armTimer();
}

function armTimer(): void {
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => lock('idle_timeout'), state.idleTimeoutMs);
}

/**
 * End the session and drop the key.
 *
 * Dropping the only reference to a non-extractable `CryptoKey` is what actually
 * removes it: the bytes live inside the browser's crypto implementation, not in
 * a JavaScript buffer we could overwrite. That is a stronger guarantee than
 * zeroizing an array would be, and it is the reason the key is kept as a
 * `CryptoKey` in the first place.
 */
export function lock(reason: LockReason = 'manual'): void {
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state = null;
  lastLockReason = reason;
  notify();
}

let handlersInstalled = false;

function installGlobalHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;

  // Tab close or navigation away.
  window.addEventListener('pagehide', () => lock('page_hidden'));
  window.addEventListener('beforeunload', () => lock('page_hidden'));

  // Backgrounding the tab on mobile is where a phone gets handed to someone
  // else, so it locks rather than merely pausing the timer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lock('page_hidden');
  });
}

// ---------------------------------------------------------------------------
// Operations. The key never leaves this module.
// ---------------------------------------------------------------------------

function requireKey(vaultId: string): CryptoKey {
  if (!state) throw new VaultLockedError();
  if (state.vaultId !== vaultId) throw new VaultLockedError();
  touch();
  return state.key;
}

export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked. Enter your passphrase to continue.');
    this.name = 'VaultLockedError';
  }
}

export async function encryptText(
  vaultId: string,
  itemId: string,
  text: string,
): Promise<SealedItem> {
  return sealText(requireKey(vaultId), text, vaultId, itemId);
}

export async function decryptText(
  vaultId: string,
  itemId: string,
  item: Parameters<typeof openText>[1],
): Promise<string> {
  return openText(requireKey(vaultId), item, vaultId, itemId);
}

export async function encryptBytes(
  vaultId: string,
  itemId: string,
  bytes: Uint8Array,
): Promise<SealedItem> {
  return sealItem(requireKey(vaultId), bytes, vaultId, itemId);
}

export async function decryptBytes(
  vaultId: string,
  itemId: string,
  item: Parameters<typeof openItem>[1],
): Promise<Uint8Array> {
  return openItem(requireKey(vaultId), item, vaultId, itemId);
}
