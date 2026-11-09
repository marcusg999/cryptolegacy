/**
 * The Content-Security-Policy, in its own module so it can be unit tested.
 *
 * Spec §11: "No third-party script on any page that touches decrypted content.
 * Strict CSP, Subresource Integrity on everything."
 *
 * A CSP that is only exercised by loading the app in a browser is a CSP nobody
 * notices loosening. The assertions in tests/security/csp.test.ts are what stop
 * a directive quietly growing a host.
 *
 * `buildCsp` is a pure function of its arguments — it reads no environment — so
 * the development concession below is visible at the call site rather than
 * hidden in a global.
 */

export interface CspOptions {
  /** Per-request nonce. Next propagates it to the scripts it injects. */
  readonly nonce: string;
  /** The Supabase project URL, or undefined when not configured. */
  readonly supabaseUrl?: string | undefined;
  /**
   * True only for `next dev`.
   *
   * React's development build uses eval() for debugging features — mainly
   * reconstructing call stacks across environments. Its own console error says
   * "React will never use eval() in production mode", and the production bundle
   * does not. So the concession is scoped here, explicitly, and a test asserts
   * that a non-development policy contains no 'unsafe-eval'.
   */
  readonly dev?: boolean;
}

export function buildCsp(options: CspOptions): string {
  const { nonce, supabaseUrl, dev = false } = options;

  const supabaseSources = (() => {
    if (!supabaseUrl) return [];
    try {
      const u = new URL(supabaseUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
      // wss:// for Realtime, should it ever be used.
      return [u.origin, `wss://${u.host}`];
    } catch {
      return [];
    }
  })();

  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    // 'strict-dynamic' lets Next's own nonced loader pull in its chunks without
    // us enumerating them, while still refusing every host-based source.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Next and React inject inline <style> at runtime and there is no nonce hook
    // for those, so 'unsafe-inline' is required here. It is a far smaller
    // concession than it sounds: with script-src locked down there is no
    // attacker-controlled script to author a style, and the CSS exfiltration
    // channels are closed by connect-src, img-src and font-src.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    // blob: for client-side decrypted media playback (build-order step 5).
    // Deliberately no remote media source: a decrypted video must never be
    // fetched from anywhere but this origin or a local blob.
    'media-src': ["'self'", 'blob:'],
    // No Google Fonts and no font CDN: a font request tells a third party which
    // page a user is on, which for this product is a disclosure in itself.
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...supabaseSources],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'form-action': ["'self'"],
    'base-uri': ["'none'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length > 0 ? `${key} ${values.join(' ')}` : key))
    .join('; ');
}
