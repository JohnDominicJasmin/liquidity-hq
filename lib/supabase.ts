import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // PKCE flow: OAuth returns a single-use `code` in the URL, never the actual
  // access/refresh tokens. The SDK exchanges the code for a session via a
  // background request, so the real token never appears in the address bar or
  // browser history (unlike the default implicit flow, which puts the raw
  // access_token in the URL fragment on every OAuth return).
  if (!_client) _client = createClient(url, key, { auth: { flowType: 'pkce' } });
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
