import { describe, expect, it } from 'vitest';

import { buildCsp } from '@/lib/security/csp';

const SUPABASE = 'https://abcdefgh.supabase.co';

function parse(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

describe('Content-Security-Policy', () => {
  it('denies everything by default', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    expect(d['default-src']).toEqual(["'none'"]);
  });

  it('carries the per-request nonce and strict-dynamic', () => {
    const d = parse(buildCsp({ nonce: 'n0nce', supabaseUrl: SUPABASE }));
    expect(d['script-src']).toContain("'nonce-n0nce'");
    expect(d['script-src']).toContain("'strict-dynamic'");
  });

  it('allows no script host beyond our own origin', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    // No https: scheme source, no wildcard, no CDN. Spec §11 forbids a
    // third-party script on any page that touches decrypted content, and every
    // page in this app does.
    for (const source of d['script-src'] ?? []) {
      expect(source).not.toMatch(/^https?:/);
      expect(source).not.toContain('*');
      expect(source).not.toMatch(/cdn|unpkg|jsdelivr|googleapis|gstatic/i);
    }
  });

  it('never allows unsafe-eval unless development is explicitly requested', () => {
    // The default must be the strict one: a caller that forgets the flag gets
    // the production policy, not the loose one.
    expect(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE })).not.toContain('unsafe-eval');
    expect(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE, dev: false })).not.toContain(
      'unsafe-eval',
    );
  });

  it('allows unsafe-eval only in development, where React requires it', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE, dev: true }));
    expect(d['script-src']).toContain("'unsafe-eval'");
  });

  it('never allows unsafe-inline for scripts, development included', () => {
    for (const dev of [true, false]) {
      const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE, dev }));
      expect(d['script-src']).not.toContain("'unsafe-inline'");
    }
  });

  it('restricts connect-src to our origin and the Supabase project', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    expect(d['connect-src']).toEqual([
      "'self'",
      'https://abcdefgh.supabase.co',
      'wss://abcdefgh.supabase.co',
    ]);
  });

  it('has nowhere to send a passphrase even if a script got onto the page', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    for (const source of d['connect-src'] ?? []) {
      expect(source === "'self'" || source.includes('supabase.co')).toBe(true);
    }
    // No form-action off-origin either, so a form cannot POST a secret away.
    expect(d['form-action']).toEqual(["'self'"]);
  });

  it('falls back to our origin alone when Supabase is not configured', () => {
    expect(parse(buildCsp({ nonce: 'abc' }))['connect-src']).toEqual(["'self'"]);
    expect(parse(buildCsp({ nonce: 'abc', supabaseUrl: 'not a url' }))['connect-src']).toEqual(["'self'"]);
  });

  it('forbids framing and plugins outright', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['frame-src']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
  });

  it('permits blob: media and workers, for client-side decrypted playback', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    expect(d['media-src']).toContain('blob:');
    expect(d['worker-src']).toContain('blob:');
    // But not remote media: a decrypted video must never be fetched from elsewhere.
    expect(d['media-src']).toEqual(["'self'", 'blob:']);
  });

  it('allows stylesheets only from our own origin', () => {
    const d = parse(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE }));
    expect(d['style-src']?.filter((s) => s.startsWith('http'))).toEqual([]);
    // Google Fonts and similar are deliberately absent: a font request leaks
    // which page a user is on to a third party.
    expect(d['font-src']).toEqual(["'self'"]);
  });

  it('upgrades insecure requests, since WebCrypto needs a secure context anyway', () => {
    expect(buildCsp({ nonce: 'abc', supabaseUrl: SUPABASE })).toContain('upgrade-insecure-requests');
  });
});
