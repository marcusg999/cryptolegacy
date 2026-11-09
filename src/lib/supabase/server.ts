/**
 * Server Supabase client, bound to the request's cookies.
 *
 * Still the anon key: server components read on behalf of the signed-in user and
 * are therefore subject to the same RLS policies as the browser. That is
 * deliberate — a server component that could see more than the user is a
 * horizontal-access bug waiting to happen.
 *
 * The service-role client lives in `src/lib/server/admin.ts` and is used only
 * where it genuinely must be (WebAuthn verification), against the `account`
 * schema, which is the only schema it has been granted.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
