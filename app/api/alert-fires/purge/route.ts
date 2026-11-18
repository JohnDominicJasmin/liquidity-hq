import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

/* Retention for the alert history (`lhq_alert_fires`), run daily with the service role (#1651, PM decision 2026-11-18: keep 90 days).
 *
 * Same shape as app/api/liq-events/purge: a server-side delete on a schedule, never a browser-side delete. Every reader of this table looks
 * at far less than 90 days (the Track Record reads the newest 500 fires, the outcome dedup a few candles, /ops/crons the last 25 h), so
 * nothing on screen changes. Retention below 100 MB was measured and declined earlier (13 MB of a 32 MB database); 90 days keeps the
 * history the hit-rate work needs and stops the one table that grows with users from growing without bound.
 *
 * SCHEDULING: no code in this repo schedules it; cron-job.org daily (docs/INFRASTRUCTURE.md). POST with an `x-cron-secret` header.
 * `headerOnly: true` because this route DELETES: a secret in a query string ends up in access logs. */

export const dynamic = 'force-dynamic';

/** THE retention period, the only definition of it. */
const RETAIN_MS = 90 * 24 * 60 * 60 * 1000;

/** A cutoff that landed in the future would delete the whole table, so the value is checked rather than trusted. */
function cutoffIso(nowMs: number): string | null {
  const cutoff = nowMs - RETAIN_MS;
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff >= nowMs) return null;
  return new Date(cutoff).toISOString();
}

export async function POST(req: Request) {
  if (!checkCronAuth(req, { headerOnly: true })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = cutoffIso(now);
  if (cutoff == null) {
    console.error(`[alert-fires-purge] refused: cutoff did not compute from now=${now}`);
    return NextResponse.json({ error: 'cutoff_invalid' }, { status: 500 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error, count } = await admin
      .from(T.alert_fires)
      .delete({ count: 'exact' })
      .lt('fired_at', cutoff);

    if (error) {
      console.error(`[alert-fires-purge] delete failed: ${error.message}`);
      return NextResponse.json({ error: 'delete_failed' }, { status: 502 });
    }

    // Logged on every run, including the zero: "nothing to delete" and "the job stopped running" look identical from the table alone.
    console.log(`[alert-fires-purge] deleted=${count ?? 0} older_than=${cutoff}`);
    return NextResponse.json({ deleted: count ?? 0, cutoff, retainDays: RETAIN_MS / 86_400_000 });
  } catch (e) {
    console.error(`[alert-fires-purge] threw: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: 'purge_failed' }, { status: 500 });
  }
}
