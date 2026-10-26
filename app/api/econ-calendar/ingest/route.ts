import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { apiError } from '@/lib/apiError';
import { recordApiHealth } from '@/lib/apiHealth';
import { formatFieldCoverage } from '@/lib/econCoverage';
import { runHealthAlert } from '@/lib/healthAlert';
import { T } from '@/lib/tables';
import type { CalEvent } from '../route';
import { retryRefusedWhopDeliveries, type RetrySummary } from '@/lib/whopGrant';

// Writes the economic calendar into a snapshot row so clients can subscribe to
// it instead of each polling /api/econ-calendar on their own hour timer.
// Scheduled hourly from cron-job.org - see docs/INFRASTRUCTURE.md §2.
//
// THAT JOB POSTS TO PRODUCTION ONLY (https://liquidity-hq.com). There is no qa, staging or dev
// equivalent, and there deliberately will not be: the job authenticates with `x-cron-secret`, and a
// production secret must never be copied to a non-production service (the same reasoning is recorded
// against the market-ingest job, 2026-09-26; this route's row simply has no non-prod counterpart).
//
// SO NOTHING HERE EVER RUNS ON qa, AND WAITING FOR IT TO IS WAITING FOR SOMETHING THAT CANNOT HAPPEN.
// This is written down because the opposite reading cost a verification on 2026-10-27: the field
// coverage line below was merged to `qa`, seven days of qa service logs were searched for
// `[econ-calendar/ingest]`, nothing was found, and the natural conclusion - "it has not fired yet" -
// sends the next reader back to wait. The code and the scheduler were simply on different hosts.
// Anything logged or written here becomes observable one hour after it reaches PRODUCTION.
//
// Calls this app's own /api/econ-calendar rather than importing its internals:
// that route builds the calendar from the agencies' published schedules
// (lib/econSchedule.ts, plus a live read of the Fed's FOMC page) and enriches
// past events from FRED (#1625), and it stays in place for the pages that read
// it directly. app/api/macro-alert
// already reaches it the same way.
const SNAPSHOT_KEY = 'us_high_impact';

/* The API-health alert sweep rides this job rather than owning a route.
 *
 * It needs an hourly schedule and this is the only hourly cron that exists.
 * The alternative - its own route plus a new cron-job.org entry - is exactly
 * what app/api/ops/spike-alert did: built 2026-07-25, never wired, still dead
 * today. An alerting feature that depends on someone remembering to schedule
 * it is worse than none, because it looks finished.
 *
 * Failing here must never fail the ingest: the calendar snapshot is the job,
 * the sweep is a passenger. */
async function healthAlertTick(): Promise<unknown> {
  try {
    return await runHealthAlert();
  } catch (e) {
    console.error('[econ-calendar/ingest] health alert failed:', e instanceof Error ? e.message : String(e));
    return { error: 'health alert failed' };
  }
}

/* A second passenger (#1630 GO-LIVE 3): the Whop deliveries that were refused for a SETTINGS reason (unknown plan id, no payer email, company
 * mismatch) are re-run through the webhook's own pipeline, hourly, for 7 days (lib/whopGrant.ts retryRefusedWhopDeliveries). Same reason this job
 * carries the health sweep: it is the hourly cron that exists, and a retry that depends on someone scheduling a new job is one that never runs.
 * Like the sweep, it must never fail the ingest. Payment ids and reasons only are reported, never an email. */
async function whopRetryTick(): Promise<RetrySummary | { error: string }> {
  try {
    const r = await retryRefusedWhopDeliveries(getSupabaseAdmin(), process.env);
    if (r.notes.length) apiError('whop/retry', new Error(`Whop retry: granted ${r.granted}, still refused ${r.stillRefused}, gave up ${r.gaveUp}, handed off ${r.handedOff}, errors ${r.errors} - ${r.notes.join('; ')}`));
    return r;
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'error' };
  }
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const whopRetry = await whopRetryTick();

  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/econ-calendar`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Calendar fetch failed' }, { status: 502 });
    }
    const { events, source } = await res.json() as { events?: CalEvent[]; source?: string };

    // Health is the count of events, not the HTTP status: /api/econ-calendar
    // answers 200 with `{events: [], source: 'none'}` when it cannot produce a
    // calendar (the schedule table has expired), so status alone would report
    // that as healthy.

    /* ...and the count is not the VALUES either (#1651). The table draws eight columns; PREVIOUS, CONSENSUS
       and ACTUAL are three of them, and on production 001d0c1 all three read `-` on all twenty rows while
       this route reported a healthy twenty events. A count-based check cannot see that, for the same reason
       the status-based one above could not see an empty calendar: it measures the wrong thing one level up.

       This LOGS the gap rather than closing it, and a zero here is not a failure - `previous` and
       `estimate` have no producer anywhere, and `actual` is only ever filled for events already past.
       Why, measured rather than inferred, and why Finnhub is not involved at any point: lib/econCoverage.ts.

       The counting lives there rather than here because the bug it guards against is unreachable from
       outside. All three fields are absent from every event today, so a test driven through this route
       answers the same on a correct counter and a broken one; only a test that PLANTS a value tells them
       apart, and that means calling the function directly. A closure here could not be called at all. */
    const total = events?.length ?? 0;
    const fieldCoverage = formatFieldCoverage(events);
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log(`[econ-calendar/ingest] ${total} events via ${source ?? 'unknown'} | ${fieldCoverage}`);
    }
    await recordApiHealth([{
      source: 'econ-calendar',
      category: 'macro',
      ok: (events?.length ?? 0) > 0,
      detail: events?.length ? `${events.length} events via ${source ?? 'unknown'} | ${fieldCoverage}` : 'no events - the release schedule table has expired or could not be read',
      items: events?.length ?? 0,
    }]);

    // An empty result means no calendar could be produced. Overwriting a
    // good snapshot with [] would blank the calendar for every client, so keep
    // the last known-good one instead. The health sweep still runs - a failing
    // calendar is exactly when you want to hear about the other sources too.
    if (!events?.length) {
      const health = await healthAlertTick();
      return NextResponse.json({ ok: true, skipped: 'empty result, kept previous snapshot', health, whopRetry: retryCounts(whopRetry) });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb.from(T.econ_snapshot).upsert({
      key: SNAPSHOT_KEY,
      events,
      source: source ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) return apiError('econ-calendar/ingest', error, 500, 'Snapshot write failed');

    const health = await healthAlertTick();
    return NextResponse.json({ ok: true, events: events.length, source, health, whopRetry: retryCounts(whopRetry) });
  } catch (e) {
    return apiError('econ-calendar/ingest', e, 500, 'Calendar ingest failed');
  }
}

/** Counts only in the cron's response (the notes go to the error report, not to the caller). */
function retryCounts(r: RetrySummary | { error: string }) {
  if ('error' in r) return r;
  const { notes: _notes, ...counts } = r;
  void _notes;
  return counts;
}
