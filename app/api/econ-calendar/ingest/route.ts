import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { apiError } from '@/lib/apiError';
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

    // An empty result means every upstream source failed at once. Overwriting a
    // good snapshot with [] would blank the calendar for every client, so keep
    // the last known-good one instead.
    if (!events?.length) {
      return NextResponse.json({ ok: true, skipped: 'empty result, kept previous snapshot' });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb.from(T.econ_snapshot).upsert({
      key: SNAPSHOT_KEY,
      events,
      source: source ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) return apiError('econ-calendar/ingest', error, 500, 'Snapshot write failed');

    return NextResponse.json({ ok: true, events: events.length, source });
  } catch (e) {
    return apiError('econ-calendar/ingest', e, 500, 'Calendar ingest failed');
  }
}
