import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp } from '@/lib/security/csp';

/**
 * Two jobs: refresh the Supabase session, and set a per-request
 * Content-Security-Policy carrying a fresh nonce.
 *
 * Spec §11: "No third-party script on any page that touches decrypted content.
 * Strict CSP, Subresource Integrity on everything."
 *
 * The policy below is `default-src 'none'` with everything added back
 * explicitly. `connect-src` is the interesting one: it lists our own origin and
 * the Supabase project, and nothing else, so a script that somehow got onto the
 * page still has nowhere to send a passphrase to.
 */

const PUBLIC_PATHS = ['/', '/sign-in', '/auth/callback', '/legal'];

/**
 * Static assets served from /public.
 *
 * These MUST bypass the auth gate. Without this the landing page — which is
 * public — has its font and its descent frames redirected to /sign-in for any
 * visitor without a session, so the one page whose job is to make the argument
 * renders with no typeface and no imagery. The matcher at the bottom of this
 * file excludes them too; this list is the belt to that braces.
 */
const STATIC_PREFIXES = ['/fonts/', '/descent/'];

/**
 * Reachable while signed in but before a passkey exists. Everything else
 * redirects to enrolment: spec §5.3 makes passkeys mandatory, and a requirement
 * the user can navigate around is not a requirement.
 */
const PRE_PASSKEY_PATHS = ['/onboarding/passkey', '/api/passkeys'];

export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV === 'development',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const isPublic =
      PUBLIC_PATHS.includes(path) ||
      path.startsWith('/legal/') ||
      path.startsWith('/auth/') ||
      path.startsWith('/_next/') ||
      STATIC_PREFIXES.some((prefix) => path.startsWith(prefix));

    if (!user && !isPublic) {
      const signIn = request.nextUrl.clone();
      signIn.pathname = '/sign-in';
      signIn.searchParams.set('next', path);
      const redirect = NextResponse.redirect(signIn);
      redirect.headers.set('Content-Security-Policy', csp);
      return redirect;
    }

    if (user && !PRE_PASSKEY_PATHS.some((p) => path.startsWith(p)) && !isPublic) {
      const { data: security } = await supabase
        .schema('account')
        .from('account_security')
        .select('passkey_enrolled_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!security?.passkey_enrolled_at) {
        const onboarding = request.nextUrl.clone();
        onboarding.pathname = '/onboarding/passkey';
        onboarding.searchParams.set('next', path);
        const redirect = NextResponse.redirect(onboarding);
        redirect.headers.set('Content-Security-Policy', csp);
        return redirect;
      }
    }
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: [
    /*
       Everything except /_next (static output, the image optimiser and the
       dev HMR socket — middleware has no business on any of them, and running
       on the socket upgrade breaks it) and files served from /public.

       The trailing extension group is not belt-and-braces padding: a public
       asset that falls through to this middleware gets redirected to /sign-in
       for a signed-out visitor, which silently strips the font and the hero
       imagery off the public landing page.
    */
    '/((?!_next/|favicon.ico|fonts/|descent/|.*\\.(?:woff2?|webp|avif|png|jpe?g|gif|svg|ico|css|js|map|txt|xml|webmanifest)$).*)',
  ],
};
