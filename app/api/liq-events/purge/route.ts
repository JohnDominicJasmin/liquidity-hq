import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

/* Retention for the liquidation history, run on a schedule with the service role (#1632 item 4).
 *
 * ── WHY THIS EXISTS: THE BROWSER USED TO DO IT ──────────────────────────────
 *
 * `components/LiqFeed.tsx` RAN `delete().lt('ts', cutoff)` from the visitor's browser after each save -
 * removed in #1735, in the same window as the revoke. That is only possible because `liq_events_delete_expired` grants DELETE to `{anon,
 * authenticated}` where `ts < now() - 7 days` - which also means **any anonymous caller can erase all
 * history older than seven days in one statement.** QA verified the policy against production on
 * 2026-10-23.
 *
 * The grant has to go. But it cannot go first: retention would simply stop, on a table every visitor
 * loads a 5,000-row window from, and the symptom would be slow growth that nobody notices for weeks.
 * **So the purge moves here first, and the grant is revoked only once this is observed working.**
 * That order is QA's and it is the point of the whole item - revoking first trades a security hole for
 * an availability one.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 * It does not fix the poisoning half. `liq_events_insert_bounded` still lets anyone anonymous write
 * rows that every visitor loads, and closing that needs the COLLECTOR moved server-side, which this
 * route is not. The collector is a harder problem than a cron route: liquidations arrive over
 * WebSocket (`fstream.binance.com/...@forceOrder`, `stream.bybit.com/v5/public/linear`), and a route
 * handler is request-scoped - it cannot hold a subscription open. See the issue for where that stands.
 *
 * Nothing here is a reason to revoke INSERT yet. **Both grants go in one window, after both halves
 * exist**, and the test asserts a direct anon INSERT and a direct anon DELETE are both refused.
 *
 * ── SCHEDULING ──────────────────────────────────────────────────────────────
 *
 * No code in this repo schedules it; that lives on cron-job.org or n8n (docs/INFRASTRUCTURE.md §2-3).
 * Daily is enough - the window is seven days, so a missed run costs nothing but a slightly larger
 * table. POST with an `x-cron-secret` header; cron-job.org defaults to GET, which will 405.
 *
 * `headerOnly: true`, unlike the other cron routes: this one DELETES. `checkCronAuth` otherwise also
 * accepts `?secret=`, and a secret in a query string ends up in access logs and referrers. The read-only
 * jobs can live with that; a destructive one should not.
 */

export const dynamic = 'force-dynamic';

/** THE retention period. Was duplicated as SB_RETAIN_MS in components/LiqFeed.tsx while the browser
 *  also purged; that copy went with the browser purge in #1735, so this is now the only definition.
 *  Two copies of a retention period is how they come to disagree. */
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

/** The oldest cutoff this route will ever accept, as a sanity floor on the arithmetic. A cutoff that
 *  landed in the future would delete the entire table, and `ts` is a plain epoch-ms column with no
 *  constraint stopping it - so the value is checked rather than trusted, even though it is computed
 *  two lines above and cannot currently be wrong. Cheap, and the failure it guards against is total. */
function cutoffMs(nowMs: number): number | null {
  const cutoff = nowMs - RETAIN_MS;
  if (!Number.isFinite(cutoff) || cutoff <= 0) return null;
  if (cutoff >= nowMs) return null;
  return cutoff;
}

export async function POST(req: Request) {
  if (!checkCronAuth(req, { headerOnly: true })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = cutoffMs(now);
  if (cutoff == null) {
    console.error(`[liq-purge] refused: cutoff did not compute from now=${now}`);
    return NextResponse.json({ error: 'cutoff_invalid' }, { status: 500 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error, count } = await admin
      .from(T.liq_events)
      .delete({ count: 'exact' })
      .lt('ts', cutoff);

    if (error) {
      console.error(`[liq-purge] delete failed: ${error.message}`);
      return NextResponse.json({ error: 'delete_failed' }, { status: 502 });
    }

    /* Logged on every run, including the zero. "Nothing to delete" and "the job stopped running" look
       identical from the table alone, and the table is the only place anyone would look. */
    console.log(`[liq-purge] deleted=${count ?? 0} older_than=${new Date(cutoff).toISOString()}`);
    return NextResponse.json({ deleted: count ?? 0, cutoff, retainDays: RETAIN_MS / 86_400_000 });
  } catch (e) {
    console.error(`[liq-purge] threw: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: 'purge_failed' }, { status: 500 });
  }
}
