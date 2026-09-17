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
import { getSupabaseAdmin } from './supabase-admin.ts';

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

/* ── Coalescing queue for trackHealth/reportHealth (found investigating
 * prod's #1252 504s on rpc/lhq_record_api_health and lhq_app_config) ──
 *
 * `recordApiHealth` above already accepts a BATCH and costs one round trip
 * regardless of size - but until now, only `news/ingest`'s caller actually
 * batched (it assembles every source's report into one array itself before
 * calling this once). Every OTHER caller goes through `trackHealth`/
 * `reportHealth` below, and each of THOSE fired its own individual
 * `recordApiHealth([oneReport])` - one full RPC round trip per source per
 * pass. Confirmed live against prod's edge logs: a single chart-load burst
 * produced 20 separate `rpc/lhq_record_api_health` calls in about 3
 * seconds, all from sources release #2 added (`app/api/market/klines`,
 * `lib/ribbonCandles`) that fire on ordinary page-load traffic, not just a
 * once-a-minute cron the way `news/ingest`'s sources do.
 *
 * That specific burst didn't measurably fail (confirmed - all 20 returned
 * 204), so this isn't a confirmed fix for the 504s themselves (see #1252
 * for the full investigation - the failures instead correlate with an
 * unexplained ~5s stall during LOW-volume moments, not the burst). It is
 * still real, measured waste: 20 round trips for what could have been 1-2,
 * on a free-tier database, matching #1219/#1025's own established
 * principle of coalescing writes that don't need per-request granularity.
 *
 * Batches every queued report that arrives within FLUSH_INTERVAL_MS into
 * ONE recordApiHealth call, the same shape news/ingest already uses
 * manually. `shouldWrite`'s OWN throttling (below) is unchanged and still
 * decides WHETHER a given call queues at all - this only changes how many
 * of the calls that already passed that gate turn into separate RPC round
 * trips. A source appearing twice in one flush window is fine: the RPC
 * upserts per source, so the batch just applies both, last one winning -
 * the same outcome as two separate calls landing in either order. */
const FLUSH_INTERVAL_MS = 1_000;
let pendingReports: HealthReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueApiHealth(report: HealthReport): void {
  pendingReports.push(report);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = pendingReports;
    pendingReports = [];
    flushTimer = null;
    void recordApiHealth(batch);
  }, FLUSH_INTERVAL_MS);
}

/** Exported for tests only, same convention as _resetApiHealthWriteState
 *  below - clears the queue and cancels any pending flush without writing
 *  it, so a test isn't left with a dangling timer or a write that lands
 *  after the test that queued it has already finished. */
export function _resetApiHealthQueue(): void {
  pendingReports = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

/* ── Per-request sources ──────────────────────────────────────────────────
   The ingest crons call recordApiHealth directly: they run once a minute, so
   one write per source per run costs nothing. The routes below are different -
   they are hit on page loads, potentially many times a second, and a DB write
   per request would cost more than the signal is worth.

   So writes are coalesced per source. A state CHANGE is written promptly
   (after MIN_STATE_CHANGE_INTERVAL_MS, not immediately - see #1025's fix on
   that constant for why), because the ok->down and down->ok transitions are
   the whole point; a repeat of the same state waits out MIN_WRITE_INTERVAL_MS.
   Worst case a source is one interval stale, which the card's own staleness
   rule already accounts for.

   In-memory, so per-process - the same single-long-lived-process assumption
   lib/rateLimit.ts documents. If this service is ever scaled to multiple
   instances the only consequence is more writes, not wrong ones. Also
   per-process across dev/qa/staging, each its own Render service - #1025's
   ~280-writes measurement is the sum across however many of those were
   running, not one process's output alone. */
const MIN_WRITE_INTERVAL_MS = 30_000;
/* #1025: a state-change write bypassing MIN_WRITE_INTERVAL_MS entirely was
 * meant to report a real ok<->down transition promptly - it assumes one
 * source represents one stable state that changes rarely. That assumption
 * broke during the 2026-09-12 PostgREST outage: high-volume proxy routes
 * (klines, agg-trades, macro, cmc) coalesce many concurrent requests onto
 * one source key (e.g. every symbol/interval collapses into
 * 'bybit:klines-proxy'), and when some of those concurrent requests
 * succeed (served from cache, or an upstream call that happened to answer)
 * while others fail, the recorded state flips on every disagreeing request
 * - per-request noise misread as a sequence of real transitions. Checked
 * and ruled out as the cause: dynamic/unbounded source keys (every source
 * string in this codebase is a literal or a low-cardinality enum) and a
 * Map growing without bound (same reason). Measured: ~280 writes in ~8s to
 * one health-write RPC during that outage - consistent with flapping
 * across concurrent requests to a shared key, not either of those.
 *
 * This floor still reports a genuine transition promptly (5s, not 30s)
 * while capping the worst case: flapping across a burst of concurrent
 * requests collapses to a few writes instead of one per request. */
const MIN_STATE_CHANGE_INTERVAL_MS = 5_000;
const lastWrite = new Map<string, { at: number; ok: boolean }>();

// Exported for tests (#1223, QA) - already pure, no behaviour change from
// exporting it. Same shape as this file's other exports: real callers below
// (trackHealth, reportHealth) are the only production use, this just lets a
// test drive it directly instead of only through a live write.
export function shouldWrite(source: string, ok: boolean): boolean {
  const prev = lastWrite.get(source);
  const now = Date.now();
  if (!prev) {
    lastWrite.set(source, { at: now, ok });
    return true;
  }
  const elapsed = now - prev.at;
  const stateChanged = prev.ok !== ok;
  const floor = stateChanged ? MIN_STATE_CHANGE_INTERVAL_MS : MIN_WRITE_INTERVAL_MS;
  if (elapsed < floor) return false;
  lastWrite.set(source, { at: now, ok });
  return true;
}

/** Clears shouldWrite's per-source state. Exported for tests only (#1223) -
 *  a real caller has no reason to ever reset this; every source keeps its
 *  history for the life of the process by design. */
export function _resetApiHealthWriteState(): void {
  lastWrite.clear();
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
      queueApiHealth({ source, category, ok, detail: d.detail, items: d.items });
    }
    return value;
  } catch (e) {
    if (shouldWrite(source, false)) {
      queueApiHealth({ source, category, ok: false, detail: healthError(e) });
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
    queueApiHealth({ source, category, ok, detail, items });
  }
}
