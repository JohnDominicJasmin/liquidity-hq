import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // REVERTED 2026-07-20: tried flowType: 'pkce' to keep OAuth tokens out of the
  // URL/browser history. Broke real mobile logins in prod within hours:
  // "PKCE code verifier not found in storage" - the code_verifier PKCE stashes
  // in localStorage doesn't survive if the OAuth hop lands in a different
  // browser/storage context than it started in (PWA-installed shortcut vs.
  // regular tab, Brave routing the Google step through a different profile,
  // etc.) - a known, fairly common PKCE-on-mobile failure mode, not a fluke.
  // This app has no server session (see lib/admin-auth.ts), so the textbook
  // fix (@supabase/ssr, cookie-backed verifier) would mean a much bigger
  // auth-architecture change, not a config flag. Back to the default implicit
  // flow, which has zero storage-continuity requirement across the OAuth hop -
  // reliability over the token-in-URL hardening for now. If PKCE is revisited,
  // it needs real multi-browser mobile testing before going anywhere near prod
  // again, not just a local dev-machine smoke test.
  if (!_client) _client = createClient(url, key);
  return _client;
}

export interface Signal {
  id?: number;
  coin: string;
  signal: string;
  confidence: number;
  entry_zone: string;
  reasoning: string;
  session: string;
  result?: string;   // 'win' | 'loss' | 'pending' | undefined
  created_at?: string;
}
