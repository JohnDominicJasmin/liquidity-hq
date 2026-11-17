import { createClient } from '@supabase/supabase-js';
import { fetchWithDeadline } from './supabase.ts';

// Server-side only - uses service role key, bypasses RLS.
// Never import this in client components.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase admin env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    /* A READ that never answers is abandoned after the usual deadline (PM audit 2026-11-17: a slow database hung public market routes); writes are not cut. */
    global: { fetch: (input, init) => fetchWithDeadline(input, init) },
  });
}
