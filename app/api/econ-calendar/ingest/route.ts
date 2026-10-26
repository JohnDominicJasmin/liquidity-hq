import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { apiError } from '@/lib/apiError';
import { recordApiHealth } from '@/lib/apiHealth';
import { runHealthAlert } from '@/lib/healthAlert';
import { T } from '@/lib/tables';
import type { CalEvent } from '../route';
import { retryRefusedWhopDeliveries, type RetrySummary } from '@/lib/whopGrant';

// Writes the economic calendar into a snapshot row so clients can subscribe to
// it instead of each polling /api/econ-calendar on their own hour timer.
// Scheduled hourly from cron-job.org - see docs/INFRASTRUCTURE.md §2.
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

       WHY THEY ARE EMPTY, traced 2026-10-26 rather than guessed:

         actual    - produced by enrichWithFRED, and ONLY for events already past (within 30 days). Every one
                     of the twenty is in the FUTURE, so zero is CORRECT here, not a failure. It fills in as
                     releases happen.
         previous  - no producer. Declared on CalEvent, assigned by nothing in the codebase.
         estimate  - no producer, same.
         delta     - the page computes it from actual and estimate, so it cannot populate while estimate has
                     no source.

       Finnhub is NOT involved: /api/econ-calendar never calls it. The dates come from the agencies' own
       schedules and the values from FRED.

       So this logs coverage rather than fixing it. `previous 0/20` reading zero forever is the intended
       output until something produces those values - the point is that the next person reads the number
       instead of inferring it from a table full of dashes. */
    const coverageOf = (key: 'actual' | 'previous' | 'estimate') =>
      (events ?? []).filter((e) => (e as Record<string, unknown>)[key]).length;
    const total = events?.length ?? 0;
    const fieldCoverage = `actual ${coverageOf('actual')}/${total}, previous ${coverageOf('previous')}/${total}, estimate ${coverageOf('estimate')}/${total}`;
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
