/**
 * All randomness in the product comes from here.
 *
 * `crypto.getRandomValues` is the platform CSPRNG in every browser we support and
 * in Node >= 19. There is no fallback on purpose: a vault built on `Math.random`
 * would be worse than no vault, so we fail loudly instead.
 */

function subtleOrThrow(): Crypto {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'No cryptographically secure random source available. Refusing to continue.',
    );
  }
  return c;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('randomBytes: length must be a positive integer.');
  }
  const out = new Uint8Array(length);
  subtleOrThrow().getRandomValues(out);
  return out;
}

/**
 * Uniform integer in `[0, bound)` by rejection sampling.
 *
 * The naive `random % bound` is biased whenever `bound` does not divide the
 * generator's range, which for a 7776-word list is a real, measurable bias in the
 * first words of the list. Rejection sampling removes it: draw 32 random bits,
 * discard any draw at or above the largest multiple of `bound` that fits, retry.
 */
export function randomInt(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > 0x1_0000_0000) {
    throw new Error('randomInt: bound must be an integer in 1..2^32.');
  }
  if (bound === 1) return 0;

  const range = 0x1_0000_0000; // 2^32
  const limit = range - (range % bound); // largest multiple of bound <= 2^32
  const buf = new Uint32Array(1);
  const c = subtleOrThrow();

  // Expected iterations < 2 for every bound; the loop is bounded in practice.
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    c.getRandomValues(buf);
    const draw = buf[0] as number;
    if (draw < limit) return draw % bound;
  }
  throw new Error('randomInt: rejection sampling failed to terminate.');
}
