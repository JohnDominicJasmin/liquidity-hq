// Records per-source health for the external APIs this app depends on.
//
// Motivated by three dependencies found silently dead in one day - RSS feeds
// whose hostnames stopped resolving, TruthSocial serving an HTML app shell
// behind a 200, and Coinglass v2 returning 500 - all of them swallowed by a
// `catch {}` so nothing ever surfaced.
//
// The rule this encodes: health is SEMANTIC, not a status code. `ok` means
// "we got data we can actually use", which is why TruthSocial's 200-with-no-
// items counts as a failure. Callers decide, because only the caller knows
// what usable looks like for its own payload.
import { getSupabaseAdmin } from './supabase-admin';

// Same env-prefixed naming as the tables in lib/tables.ts - the two Supabase
// projects each hold their own copy of this function. Matches the pattern
// app/api/auth/ban-reason already uses for lhq_user_id_by_email.
const RECORD_FN = process.env.NEXT_PUBLIC_APP_ENV === 'dev'
  ? 'lhq_dev_record_api_health'
  : 'lhq_record_api_health';

export type HealthCategory = 'news' | 'macro' | 'market' | 'ai' | 'delivery' | 'other';

export interface HealthReport {
  /** Stable id, namespaced by provider - 'rss:BBC World', 'finnhub:crypto'. */
  source: string;
  category: HealthCategory;
  /** True only when the response carried usable data, not merely HTTP 200. */
  ok: boolean;
  /** Short human reason shown on /ops: '26 items', 'HTTP 500', 'no items'. */
  detail?: string;
  /** Payload size on success - lets /ops show "worked but returned 0". */
  items?: number;
}

/** Turns a thrown value into something short enough to display. */
export function healthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 140 ? msg.slice(0, 137) + '...' : msg;
}

/**
 * Writes a batch of outcomes. One round trip regardless of source count.
 *
 * Never throws and never rejects. Health tracking that can break the job it
 * measures is worse than no health tracking - a transient write failure here
 * must not stop a news ingest from delivering news. The only cost of a lost
 * write is one missing sample in the rolling window.
 */
export async function recordApiHealth(reports: HealthReport[]): Promise<void> {
  if (!reports.length) return;
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.rpc(RECORD_FN, { p_rows: reports });
    if (error) console.error('[apiHealth] write failed:', error.message);
  } catch (e) {
    console.error('[apiHealth] write threw:', healthError(e));
  }
}
