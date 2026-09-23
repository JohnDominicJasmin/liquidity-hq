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
