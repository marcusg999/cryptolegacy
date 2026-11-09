'use client';

/**
 * Browser Supabase client.
 *
 * Carries the anon key and the user's session only. There is no code path from
 * here to the service-role key, and `scripts/check-crypto-leaks.mjs` fails the
 * build if one appears.
 */

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './types';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
