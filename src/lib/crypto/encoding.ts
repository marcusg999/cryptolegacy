/**
 * Byte/string conversions and best-effort zeroization.
 *
 * Nothing here logs, throws with secret material in the message, or touches
 * persistent storage.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8ToBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Standard base64 (with padding) — the shape Postgres `bytea`/JSON transport wants. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large payload does not blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Malformed base64 input.');
  }
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Overwrite a buffer in place.
 *
 * Be honest about what this is worth: JavaScript gives no guarantee that a copy of
 * the bytes does not survive somewhere else (a GC'd intermediate, a `String`, a
 * JIT register spill, the OS swap file). Zeroizing shortens the window and makes a
 * heap snapshot much less likely to be useful. It is not a guarantee, and
 * SECURITY.md says so. Keys held by WebCrypto as non-extractable `CryptoKey`
 * objects are the stronger protection, which is why `envelope.ts` prefers them.
 */
export function zeroize(...buffers: readonly (Uint8Array | null | undefined)[]): void {
  for (const buf of buffers) {
    if (buf && buf.length > 0) buf.fill(0);
  }
}

/**
 * Constant-time byte comparison. Used for the sentinel check so a timing signal
 * cannot reveal how much of the expected plaintext matched.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
