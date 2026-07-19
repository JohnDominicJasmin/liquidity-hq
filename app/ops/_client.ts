'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

// Attaches the signed-in user's bearer token to an admin API call. The server
// route re-checks the token + role (the real gate); this just supplies it.
// Accepts an optional RequestInit for writes (POST/PATCH/DELETE + body).
export async function adminFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) return null;
  return fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export function useAdminResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(path);
      if (!res) { setError('Not signed in'); setData(null); return; }
      if (!res.ok) { setError(`HTTP ${res.status}`); setData(null); return; }
      setData((await res.json()) as T);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const fmtInt = (n: number | null | undefined) =>
  n == null ? '-' : n.toLocaleString('en-US');

export const fmtPct = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? '-' : `${n.toFixed(digits)}%`;

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
