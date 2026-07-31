// SERVER ONLY. Emails the owner when a tracked dependency goes down, and again
// when it comes back.
//
// The API-health card was write-only until this existed: it recorded every
// outcome faithfully and told nobody. Three sources sat red for an unknown
// length of time and were found by someone opening /ops and looking. A monitor
// nobody is watching is a log, not a monitor.
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { sendHealthAlertEmail } from '@/lib/email';

// Matches the /ops card's own Down threshold, and deliberately NOT "one failed
// check". Finnhub flaps - roughly 3 failures in 50 samples, isolated ticks
// surrounded by successes - so alerting on a single failure would email every
// few hours about a source that is fine. Three consecutive misses is a real
// outage; one is weather.
const DOWN_AFTER = 3;

// A source that is still down a day later gets one reminder, not one per hour.
const RENOTIFY_MS = 24 * 60 * 60_000;

const STATE_KEY = 'api_health_alert_state';
const SUPPRESS_KEY = 'api_health_alert_suppress';

export interface HealthAlertResult {
  downCount: number;
  recoveredCount: number;
  emailed: boolean;
  suppressed: string[];
}

interface HealthRow {
  source: string;
  category: string;
  ok: boolean;
  detail: string | null;
  consecutive_failures: number;
  last_ok_at: string | null;
}

/**
 * Deliberately does NOT alert on staleness, only on consecutive failures.
 *
 * Most sources here are written when a user-facing route is hit, so overnight
 * with no traffic they simply stop being reported - which the card correctly
 * shows as stale/unmonitored, but which is not a fault and must not send email
 * at 4am every night. Staleness is a "go look" signal for a human reading the
 * card, not a page.
 */
export async function runHealthAlert(): Promise<HealthAlertResult> {
  const admin = getSupabaseAdmin();

  const [healthRes, cfgRes] = await Promise.all([
    admin.from(T.api_health).select('source, category, ok, detail, consecutive_failures, last_ok_at'),
    admin.from(T.app_config).select('key, value').in('key', [STATE_KEY, SUPPRESS_KEY]),
  ]);

  const rows = (healthRes.data ?? []) as HealthRow[];
  const cfg = Object.fromEntries((cfgRes.data ?? []).map(r => [r.key, r.value]));
  const state = (cfg[STATE_KEY] ?? {}) as Record<string, string>;
  const suppress = new Set<string>((cfg[SUPPRESS_KEY] ?? []) as string[]);

  const now = Date.now();
  const newlyDown: HealthRow[] = [];
  const recovered: string[] = [];
  const nextState: Record<string, string> = { ...state };

  for (const r of rows) {
    if (suppress.has(r.source)) {
      // Acknowledged-dead. Keep it off the email but do not pretend it is
      // healthy - the card still shows it red.
      delete nextState[r.source];
      continue;
    }

    const isDown = (r.consecutive_failures ?? 0) >= DOWN_AFTER;
    const notifiedAt = state[r.source] ? Date.parse(state[r.source]) : null;

    if (isDown) {
      if (notifiedAt == null || now - notifiedAt >= RENOTIFY_MS) {
        newlyDown.push(r);
        nextState[r.source] = new Date(now).toISOString();
      }
      continue;
    }

    // Recovery is only worth reporting to someone who was told it broke.
    // `ok` rather than failures===0 so a source part-way back down does not
    // read as recovered.
    if (notifiedAt != null && r.ok) {
      recovered.push(r.source);
      delete nextState[r.source];
    }
  }

  let emailed = false;
  if (newlyDown.length || recovered.length) {
    emailed = await sendHealthAlertEmail({
      down: newlyDown.map(r => ({
        source: r.source,
        category: r.category,
        detail: r.detail ?? 'no detail',
        failures: r.consecutive_failures ?? 0,
        lastOkAt: r.last_ok_at,
      })),
      recovered,
    });
  }

  // Written even when no email went out, so a suppression added since the last
  // run clears its stale entry. Best-effort: a failed write means at worst a
  // duplicate email next hour, never a missed one.
  await admin.from(T.app_config).upsert(
    { key: STATE_KEY, value: nextState },
    { onConflict: 'key' },
  );

  return {
    downCount: newlyDown.length,
    recoveredCount: recovered.length,
    emailed,
    suppressed: [...suppress],
  };
}
