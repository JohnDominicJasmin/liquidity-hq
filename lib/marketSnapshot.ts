/* Read and write the server-owned market snapshot (#1404, tracker #1397).
 *
 * The shape of the deal: ONE scheduled job calls the exchange and writes here;
 * page requests only read. Enforced by the database as well as by convention -
 * `lhq_market_snapshot` has a read policy for anon/authenticated and no write
 * policy at all, so only the service-role client used by the ingest route can
 * write a row (20260923b_market_snapshot.sql).
 *
 * WHY A TABLE AND NOT A LONGER CACHE TTL. Measured over four runs in #1397:
 * upstream calls held at ~5/second while the page-load rate varied by 56%, so
 * the in-memory cache already decouples exchange traffic from visitor count.
 * What it does NOT do is survive a deploy, or reach a second instance - every
 * restart starts cold and pays the full fan-out again on the next visitor, and
 * that is exactly the moment a viral post would arrive. A row in a table is the
 * same data with neither property.
 *
 * FRESHNESS IS DATA. `updated_at` is written on every run and the age is
 * computed on every read, never defaulted. A reader that cannot say how old a
 * number is has to either present it as current or show nothing, and both were
 * ruled out: a stale value is shown WITH its age.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import type { MarketFeed } from '@/lib/marketFeeds';

/** How often the scheduled job is expected to run. Must match the cron entry -
 *  every five minutes on cron-job.org, docs/INFRASTRUCTURE.md §2. */
export const SNAPSHOT_CADENCE_MS = 5 * 60_000;

/** Older than two cadences and a row is labelled stale rather than shown as a
 *  current number. Two rather than one so a single missed run - a deploy, a
 *  slow upstream - does not cry wolf; two consecutive misses is a real signal. */
export const SNAPSHOT_STALE_AFTER_MS = 2 * SNAPSHOT_CADENCE_MS;

/* THE HARD LIMIT, AND WHY IT IS NOT THE SAME AS `stale`.
 *
 * `stale` marks a row for the CONSUMER to label - "as of 14 minutes ago". Until
 * a consumer can actually say that, marking it changes nothing on screen: the
 * page renders an old number as though it were current, which is the defect
 * itself rather than a milder version of it (PM/DevOps, #1404).
 *
 * So past this age the row is treated as ABSENT and the route serves live, the
 * same as if the job had never run. A stopped cron job then degrades to exactly
 * today's behaviour instead of to quietly wrong numbers, and it needs no new
 * copy to be honest.
 *
 * Thirty minutes is six consecutive missed runs. One missed run is a deploy or
 * a slow upstream; six is the scheduler being down, which is the case this
 * exists for. Lower it once the UI can label a stale row, at which point this
 * whole fallback goes - see the removal condition in the page routes. */
export const SNAPSHOT_TOO_OLD_MS = 30 * 60_000;

export type SnapshotRead = {
  payload: unknown;
  source: string | null;
  /** Age of the ROW - when the job wrote it. Never null: an unreadable timestamp
   *  resolves to Infinity, which sorts as stale rather than as fresh.
   *
   *  NOT a freshness verdict, and this type deliberately no longer carries one.
   *  `stale` and `tooOld` used to be computed here from the write age; every
   *  verdict now lives in `decideSnapshot`, judged on the data's own timestamps.
   *  Leaving the old pair on an exported type under a confident doc comment
   *  would hand the next caller who writes `if (snap.tooOld)` the exact model
   *  three commits removed, reading as the blessed API (QA's review of #1412). */
  ageMs: number;
};

/** Reads one snapshot row. Returns null when the row does not exist - the job
 *  has not run yet - which callers must report as "not available yet" rather
 *  than as an empty result. Never throws: a database failure reads as absent,
 *  because a page that cannot reach the database is in the same position as one
 *  whose job has not run, and neither may invent a value. */
export async function readSnapshot(key: string): Promise<SnapshotRead | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from(T.market_snapshot)
      .select('payload, source, updated_at')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as { payload: unknown; source: string | null; updated_at: string | null };
    const written = row.updated_at ? new Date(row.updated_at).getTime() : NaN;
    /* Unknown age is treated as stale, never as fresh - the same rule
       NewsProvider applies to the econ snapshot (#298). An unreadable timestamp
       means we cannot show that the data is current, and "cannot show" is the
       caution state, not the happy one. */
    const ageMs = Number.isFinite(written) ? Math.max(0, Date.now() - written) : Infinity;
    /* Infinity for an unreadable timestamp, so a row whose age cannot be known
       is never judged fresh downstream - unknown age is the caution state. */
    return { payload: row.payload, source: row.source, ageMs };
  } catch {
    return null;
  }
}

/** What a page route serves when the snapshot can be used, with BOTH clocks in
 *  it so the two can be compared rather than conflated. */
export type FeedSnapshot = {
  body: Record<string, unknown>;
  /** How long ago the JOB wrote the row - our clock. */
  rowAgeMs: number;
  /** How old the OLDEST item in it is, by the upstream's own timestamp - the
   *  market's clock. Null when nothing carried a usable timestamp. */
  dataAgeMs: number | null;
  /** How far PAST its own sampling interval that oldest item is. This is what
   *  `stale` and the hard limit are judged on; `dataAgeMs` alone would condemn
   *  every hourly feed. */
  overdueMs: number;
  /** Per symbol, so one ancient item is visible as one ancient item. */
  dataAges: Record<string, number>;
  /** Symbols removed from `body.data` because their own data is past the hard
   *  limit - reported so the loss is auditable rather than silent. */
  droppedSymbols: string[];
  stale: boolean;
};

/* Resolves a feed to either "serve this row" or null meaning "serve live".
 *
 * THE VERDICT USES THE MARKET'S CLOCK, NOT OURS. Freshness is judged on the
 * oldest item's upstream timestamp, falling back to the row's write age only
 * when no item carried one - a row written a minute ago holding six-hour-old
 * ratios is six hours stale, and judging it by write time would call it fresh
 * (QA's acceptance criterion for #1404).
 *
 * Returning null rather than an error is deliberate: past the hard limit, or
 * with no row at all, the caller falls through to exactly the code path it used
 * before this feature existed. */
/* THE DECISION, SEPARATED FROM THE DATABASE ON PURPOSE.
 *
 * Pure inputs, pure output: a payload, the row's write age and a clock. Every
 * case below is forceable from fabricated inputs, which is what QA needs to test
 * them at all - Bybit cannot be asked to fail 12 of 49 symbols on demand, and an
 * end-to-end test that only sees whichever case the exchange happens to produce
 * is a suite that passes because the interesting path never ran (PM/DevOps).
 *
 * Returns null for "serve live". */
export function decideSnapshot(
  feed: MarketFeed,
  payload: unknown,
  rowAgeMs: number,
  now: number,
  logLabel = 'snapshot',
): FeedSnapshot | null {
  const { bySymbol } = feed.dataAges(payload, now);

  /* NOTHING TO JUDGE MEANS NOT FRESH, and this is decided HERE - above the
   * write-age fallback, not as a consequence of it (PM/DevOps's requirement).
   *
   * The failure mode it closes is precise: with no symbol carrying a usable
   * timestamp there is no oldest item, so the verdict would fall through to the
   * row's write age - and the merge may have written that row a second ago. A
   * snapshot holding nothing judgeable would read as brand new. Every input to
   * that decision is honest; the verdict is wrong because nothing was asked.
   *
   * That is the third state collapsing into the affirmative one, which this
   * codebase has been bitten by repeatedly. The write-age fallback is safe only
   * where it can UNDER-state freshness; here it does the opposite, so the guard
   * sits above it and the fallback is gone entirely. */
  const ages = Object.entries(bySymbol);
  if (!ages.length) {
    console.log(`[${logLabel}] no symbol carries a usable timestamp - cannot judge freshness, serving live`);
    return null;
  }

  /* The verdict is taken over the symbols this feed is actually refreshing.
     `staleSymbols` are the ones a partial run carried over from the previous
     snapshot; their ages are still reported, but letting them drive the verdict
     would mean one permanently-failing symbol disables the snapshot path for all
     49. When EVERY symbol is carried there is nothing to exclude, so they all
     count and the feed falls back on the carried data's own age - never on the
     write time (QA's edge case). */
  const carried = new Set((payload as { staleSymbols?: string[] } | null)?.staleSymbols ?? []);
  const judged = ages.filter(([sym]) => !carried.has(sym));
  const pool = judged.length ? judged : ages;
  const oldestMs = Math.max(...pool.map(([, v]) => v));

  /* OVERDUE, NOT AGE. A feed sampled hourly hands back a bucket that is already
     0-60 minutes old the instant it is fetched, so raw age compared against a
     30-minute limit calls a just-written row "too old" and sends every request
     back to the live path - which is exactly what the first run of the
     verification did. What matters is how long PAST its own sampling interval
     the newest item is. */
  const overdueMs = Math.max(0, oldestMs - feed.samplingMs);

  if (overdueMs >= SNAPSHOT_TOO_OLD_MS) {
    console.log(`[${logLabel}] data ${Math.round(oldestMs / 60_000)}m old, ${Math.round(overdueMs / 60_000)}m overdue (row ${Math.round(rowAgeMs / 60_000)}m) - past the limit, serving live`);
    return null;
  }

  /* A SYMBOL PAST THE LIMIT IS DROPPED, not served with its age attached.
   *
   * The per-symbol form of the rule the row already follows - past the limit,
   * treat as absent - and it closes a hole this PR's own merge opened. Before
   * merging, a symbol the fan-out failed to fetch simply was not in the payload,
   * and MarketProvider's "absent means not fetched, not zero" handled it
   * correctly. Carrying it forward would instead show its last known value
   * INDEFINITELY, and nothing consumes `staleSymbols` or `dataAges` today, so
   * "the age is in the response" and "the page acts on the age" are different
   * claims with only the first true.
   *
   * Dropping restores the old behaviour for genuinely dead symbols while keeping
   * the merge's benefit for transient ones, and safety then does not depend on a
   * UI change that has not been built: a symbol is fresh enough to serve, or it
   * is not there. A symbol with NO usable timestamp is dropped for the same
   * reason - unknown age must never be served as current. Names are reported so
   * the loss is auditable rather than silent. */
  const body = payload as Record<string, unknown>;
  const data = (body as { data?: Record<string, unknown> }).data;
  const droppedSymbols = [
    ...ages.filter(([, age]) => Math.max(0, age - feed.samplingMs) >= SNAPSHOT_TOO_OLD_MS).map(([sym]) => sym),
    ...(data && typeof data === 'object' ? Object.keys(data).filter((sym) => !(sym in bySymbol)) : []),
  ];

  let served = body;
  if (droppedSymbols.length && data && typeof data === 'object') {
    const remaining: Record<string, unknown> = { ...data };
    for (const sym of droppedSymbols) delete remaining[sym];
    served = { ...body, data: remaining };
    console.log(`[${logLabel}] dropped ${droppedSymbols.length} symbol(s) past the limit or without a timestamp: ${droppedSymbols.slice(0, 5).join(',')}${droppedSymbols.length > 5 ? '...' : ''}`);
  }

  return {
    body: served,
    rowAgeMs,
    dataAgeMs: oldestMs,
    overdueMs,
    dataAges: bySymbol,
    droppedSymbols,
    stale: overdueMs >= SNAPSHOT_STALE_AFTER_MS,
  };
}

/* Reads the row and hands it to `decideSnapshot`. The split is what makes every
 * branch above testable from pure inputs; this half only touches the database.
 *
 * Returning null rather than an error is deliberate: past the hard limit, or
 * with no row at all, the caller falls through to exactly the code path it used
 * before this feature existed. */
export async function resolveFeedSnapshot(
  feed: MarketFeed,
  logLabel: string,
): Promise<FeedSnapshot | null> {
  const snap = await readSnapshot(feed.key);
  if (!snap) {
    console.log(`[${logLabel}] no snapshot row yet - serving live`);
    return null;
  }
  return decideSnapshot(feed, snap.payload, snap.ageMs, Date.now(), logLabel);
}

/* COVERAGE MUST NEVER SHRINK (QA's criterion 2, #1404).
 *
 * `stopped || ok === 0` catches a banned run and a dead one, and lets a PARTIAL
 * one straight through: 37 of 49 symbols with no 418 and no 429 is not
 * "stopped", so a short row overwrote a full one and api_health called it
 * healthy. Nobody sees a wrong number - they see twelve symbols quietly
 * missing, reported as success. Lost coverage dressed as a healthy run is the
 * worst shape a monitoring bug can take, because nothing ever asks about it.
 *
 * The fix is a merge rather than a refusal. Refusing to write a partial would
 * be worse: one permanently failing symbol would freeze the whole feed forever.
 * Merging takes every symbol this run DID return and keeps the previous value
 * for the ones it did not, so coverage only ever grows - and because each item
 * carries its own upstream timestamp, a symbol that stops updating is caught by
 * the per-symbol drop in `decideSnapshot` rather than served for ever.
 *
 * This is a finding the change itself created: before this PR there was no row
 * to overwrite. */
export function mergeCoverage(previous: unknown, next: unknown): { payload: unknown; kept: string[] } {
  const prevData = (previous as { data?: Record<string, unknown> } | null)?.data;
  const nextObj  = next as Record<string, unknown> | null;
  const nextData = (nextObj as { data?: Record<string, unknown> } | null)?.data;
  if (!prevData || !nextData || typeof prevData !== 'object' || typeof nextData !== 'object') {
    return { payload: next, kept: [] };
  }
  const kept = Object.keys(prevData).filter((sym) => !(sym in nextData));
  if (!kept.length) return { payload: { ...nextObj, staleSymbols: [] }, kept };
  const merged: Record<string, unknown> = { ...nextData };
  for (const sym of kept) merged[sym] = prevData[sym];
  /* NAMED, not just carried. `staleSymbols` is the list this run did not refresh,
     and the freshness verdict excludes them - otherwise merging would hand a
     single delisted symbol the power to condemn the whole feed to the live path
     for ever, which trades a visible gap for an invisible one. Their ages are
     still reported per symbol, and once past the limit they are dropped. */
  return { payload: { ...nextObj, data: merged, staleSymbols: kept }, kept };
}

/** Writes one snapshot row. Only the ingest route calls this, and only with the
 *  service-role client; an anon or authenticated caller has no write policy to
 *  use even if this were reachable from a page request. */
export async function writeSnapshot(key: string, payload: unknown, source: string | null): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from(T.market_snapshot).upsert({
    key,
    payload,
    source,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error(`snapshot write failed for ${key}: ${error.message}`);
}
