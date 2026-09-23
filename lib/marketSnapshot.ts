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
  /** Age at read time. Never null: an unreadable timestamp resolves to
   *  Infinity, which sorts as stale rather than as fresh. */
  ageMs: number;
  /** Past two cadences: serve it, but say how old it is. */
  stale: boolean;
  /** Past the hard limit: do not serve it at all - treat as absent. */
  tooOld: boolean;
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
    return {
      payload: row.payload,
      source: row.source,
      ageMs,
      stale:  ageMs >= SNAPSHOT_STALE_AFTER_MS,
      /* Infinity satisfies both, so an unreadable timestamp is not served -
         consistent with treating unknown age as the caution state. */
      tooOld: ageMs >= SNAPSHOT_TOO_OLD_MS,
    };
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
export async function resolveFeedSnapshot(
  feed: MarketFeed,
  logLabel: string,
): Promise<FeedSnapshot | null> {
  const snap = await readSnapshot(feed.key);
  if (!snap) {
    console.log(`[${logLabel}] no snapshot row yet - serving live`);
    return null;
  }

  const { bySymbol } = feed.dataAges(snap.payload, Date.now());

  /* The verdict is taken over the symbols this feed is actually refreshing.
     `staleSymbols` are the ones a partial run carried over from the previous
     snapshot; their ages are still reported, but letting them drive the verdict
     would mean one permanently-failing symbol disables the snapshot path for all
     49. If every symbol is stale there is nothing to exclude, so they all count
     and the feed correctly falls back. */
  const carried = new Set((snap.payload as { staleSymbols?: string[] } | null)?.staleSymbols ?? []);
  const judged = Object.entries(bySymbol).filter(([sym]) => !carried.has(sym));
  const pool = judged.length ? judged : Object.entries(bySymbol);
  const oldestMs = pool.length ? Math.max(...pool.map(([, v]) => v)) : null;
  /* No usable upstream timestamp anywhere falls back to the write age, which is
     a lower bound on how old the data is - never an over-estimate of freshness. */
  const verdictAge = oldestMs ?? snap.ageMs;

  /* OVERDUE, NOT AGE. A feed sampled hourly hands back a bucket that is already
     0-60 minutes old the instant it is fetched, so raw age compared against a
     30-minute limit calls a just-written row "too old" and sends every request
     back to the live path - which is exactly what the first run of the
     verification did. What matters is how long PAST its own sampling interval
     the newest item is. The fallback case uses write age with no subtraction,
     because a row we wrote is not excused by the upstream's cadence. */
  const overdueMs = oldestMs === null ? snap.ageMs : Math.max(0, oldestMs - feed.samplingMs);

  if (overdueMs >= SNAPSHOT_TOO_OLD_MS) {
    console.log(`[${logLabel}] data ${Math.round(verdictAge / 60_000)}m old, ${Math.round(overdueMs / 60_000)}m overdue (row ${Math.round(snap.ageMs / 60_000)}m) - past the limit, serving live`);
    return null;
  }

  return {
    body: snap.payload as Record<string, unknown>,
    rowAgeMs: snap.ageMs,
    dataAgeMs: oldestMs,
    overdueMs,
    dataAges: bySymbol,
    stale: overdueMs >= SNAPSHOT_STALE_AFTER_MS,
  };
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
 * carries its own upstream timestamp, a symbol that stops updating shows up as
 * an ageing entry in `dataAges` instead of vanishing. The thing that was
 * invisible becomes visible in the data the route already returns.
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
     still reported per symbol, so a consumer can grey out exactly those. */
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
