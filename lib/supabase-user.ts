import { createClient } from '@supabase/supabase-js';

/* Server-side Supabase clients made for ONE request: as the signed-in caller (their access token, so RLS applies), or with the anon key only.
 *
 * WHY EVERY SERVER CLIENT COMES FROM HERE (#1397). Outside a browser, supabase-js's auth client starts an auto-refresh timer (setInterval, every
 * 30 s) as soon as it is created, unless `autoRefreshToken` is false, and nothing ever stops it. The timer holds the client, so every per-request
 * client the API routes made stayed in memory for the life of the process (about 13 KB each), each running its own timer. Measured on #1397:
 * 2,000 clients made the way the routes made them were all still reachable after a forced GC; with these options, 1 of 2,000 was. That is the
 * memory that grew with signed-in traffic until the server ran out of heap (qa, 2026-10-21 06:57 UTC, exit 134).
 *
 * `persistSession: false` alone does NOT stop the timer (also measured: 2,000 of 2,000 kept). A server-side client comes from here, or from
 * lib/supabase-admin.ts (service role), which sets the same two options. lib/supabase.ts is the browser's one shared client and is not for
 * server code. */
export const SERVER_AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } as const;

/** A client that acts as the user this access token belongs to, for one request. */
export function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: SERVER_AUTH_OPTIONS,
  });
}

/** A client with the anon key and no user, for one request. */
export function anonServerClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: SERVER_AUTH_OPTIONS });
}
