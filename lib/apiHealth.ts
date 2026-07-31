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

/* ── Per-request sources ──────────────────────────────────────────────────
   The ingest crons call recordApiHealth directly: they run once a minute, so
   one write per source per run costs nothing. The routes below are different -
   they are hit on page loads, potentially many times a second, and a DB write
   per request would cost more than the signal is worth.

   So writes are coalesced per source. A state CHANGE is always written
   immediately, because the ok->down and down->ok transitions are the whole
   point; a repeat of the same state waits out MIN_WRITE_INTERVAL_MS. Worst
   case a source is one interval stale, which the card's own staleness rule
   already accounts for.

   In-memory, so per-process - the same single-long-lived-process assumption
   lib/rateLimit.ts documents. If this service is ever scaled to multiple
   instances the only consequence is more writes, not wrong ones. */
const MIN_WRITE_INTERVAL_MS = 30_000;
const lastWrite = new Map<string, { at: number; ok: boolean }>();

function shouldWrite(source: string, ok: boolean): boolean {
  const prev = lastWrite.get(source);
  const now = Date.now();
  if (!prev || prev.ok !== ok || now - prev.at >= MIN_WRITE_INTERVAL_MS) {
    lastWrite.set(source, { at: now, ok });
    return true;
  }
  return false;
}

/**
 * Wraps a per-request upstream call. Returns whatever fn returns and rethrows
 * whatever it throws, so existing error handling at the call site is unchanged
 * and this can be dropped in without altering behaviour.
 *
 * Health is SEMANTIC (see the note at the top of this file), and the caller
 * decides: throwing means unusable, and `describe` can mark a value that came
 * back structurally fine but empty as a failure - which is the case that plain
 * uptime checks miss.
 *
 * The write is deliberately not awaited. Render runs this app as a normal
 * long-lived Node process, so a floating promise still completes after the
 * response is sent; awaiting would put a Supabase round trip in front of every
 * user-facing response to measure something nobody is waiting for.
 */
export async function trackHealth<T>(
  source: string,
  category: HealthCategory,
  fn: () => Promise<T>,
  describe?: (value: T) => { ok?: boolean; detail?: string; items?: number },
): Promise<T> {
  try {
    const value = await fn();
    const d = describe?.(value) ?? {};
    const ok = d.ok ?? true;
    if (shouldWrite(source, ok)) {
      void recordApiHealth([{ source, category, ok, detail: d.detail, items: d.items }]);
    }
    return value;
  } catch (e) {
    if (shouldWrite(source, false)) {
      void recordApiHealth([{ source, category, ok: false, detail: healthError(e) }]);
    }
    throw e;
  }
}

/** For call sites that swallow failures into a null/empty result instead of
 *  throwing - report the outcome without pretending to wrap control flow. */
export function reportHealth(
  source: string, category: HealthCategory, ok: boolean, detail?: string, items?: number,
): void {
  if (shouldWrite(source, ok)) {
    void recordApiHealth([{ source, category, ok, detail, items }]);
  }
}
