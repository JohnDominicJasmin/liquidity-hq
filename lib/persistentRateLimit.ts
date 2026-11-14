import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/rateLimit';

/* A RATE LIMIT THAT SURVIVES A RESTART (security audit #1413; migration 20261114o).
 *
 * lib/rateLimit.ts counts in process memory, so a deploy, a restart or a second instance resets it. This counts in the database (one atomic function), so the count is shared and
 * durable. Where the function is not on this database yet, or the call fails, it FALLS BACK TO THE IN-MEMORY LIMITER rather than letting the request through unlimited: the
 * weaker limit is still a limit. Returns true when the request is allowed. */

const FN = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_rate_limit_hit' : 'lhq_rate_limit_hit';

export async function persistentRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(FN, { p_key: key.slice(0, 200), p_limit: limit, p_window_seconds: Math.max(1, Math.round(windowMs / 1000)) });
    if (!error && typeof data === 'boolean') return data;
    /* missing function or any other error: fall through to memory */
  } catch { /* the database is unreachable: fall through */ }
  return rateLimit(key, limit, windowMs);
}
