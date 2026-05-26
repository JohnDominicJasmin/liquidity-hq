import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key);
  return _client;
}

export interface Cluster {
  id?: number;
  coin: string;
  level: number;
  side: 'above' | 'below';
  note?: string;
  status: 'pending' | 'raided' | 'expired';
  added_at?: string;
  raided_at?: string | null;
}

export interface Signal {
  id?: number;
  coin: string;
  signal: string;
  confidence: number;
  entry_zone: string;
  reasoning: string;
  session: string;
  created_at?: string;
}
