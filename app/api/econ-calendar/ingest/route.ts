import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { apiError } from '@/lib/apiError';
import { recordApiHealth } from '@/lib/apiHealth';
import { runHealthAlert } from '@/lib/healthAlert';
import { T } from '@/lib/tables';
import type { CalEvent } from '../route';

// Writes the economic calendar into a snapshot row so clients can subscribe to
// it instead of each polling /api/econ-calendar on their own hour timer.
// Scheduled hourly from cron-job.org - see docs/INFRASTRUCTURE.md §2.
//
// Calls this app's own /api/econ-calendar rather than importing its internals:
// that route merges four fallback sources (Finnhub, ForexFactory, the Fed's
// FOMC page, a computed schedule) and enriches past events from FRED, and it
// stays in place for the pages that read it directly. app/api/macro-alert
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

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    // answers 200 with `{events: [], source: 'none'}` when all four upstream
    // sources fail, so status alone would report a total outage as healthy.
    await recordApiHealth([{
      source: 'econ-calendar',
      category: 'macro',
      ok: (events?.length ?? 0) > 0,
      detail: events?.length ? `${events.length} events via ${source ?? 'unknown'}` : 'no events - all upstream sources failed',
      items: events?.length ?? 0,
    }]);

    // An empty result means every upstream source failed at once. Overwriting a
    // good snapshot with [] would blank the calendar for every client, so keep
    // the last known-good one instead. The health sweep still runs - a failing
    // calendar is exactly when you want to hear about the other sources too.
    if (!events?.length) {
      const health = await healthAlertTick();
      return NextResponse.json({ ok: true, skipped: 'empty result, kept previous snapshot', health });
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
    return NextResponse.json({ ok: true, events: events.length, source, health });
  } catch (e) {
    return apiError('econ-calendar/ingest', e, 500, 'Calendar ingest failed');
  }
}
