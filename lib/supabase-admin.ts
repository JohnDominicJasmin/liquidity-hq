import { createClient } from '@supabase/supabase-js';
import { fetchWithDeadline } from './supabase.ts';

// Server-side only - uses service role key, bypasses RLS.
// Never import this in client components.
/** `deadline: true` abandons a READ that never answers (lib/supabase.ts fetchWithDeadline; writes are never cut). It is OPT-IN: the backup export and the ops reports read whole tables and must be allowed to take as long as they take; only the public market and plan reads ask for it. */
export function getSupabaseAdmin(opts: { deadline?: boolean } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase admin env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(opts.deadline ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchWithDeadline(input, init) } } : {}),
  });
}
