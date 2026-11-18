import { readJsonCapped, BODY_CAPS } from '@/lib/requestBody';
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { T } from '@/lib/tables';
import { shouldAcceptFieldWrite } from '@/lib/settingsFieldConcurrency';
import { getUserCompat } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { STRATEGY_IDS } from '@/lib/strategies';
import { clampThreshold, isThresholdField } from '@/lib/alertThresholdRanges';
import { isValidSummaryHour } from '@/lib/dailySummaryPrefs';
import { isValidSoundPrefs } from '@/lib/arenaSoundPrefs';

function sb(token: string) {
  return userClient(token);
}

async function getUser(token: string) {
  const { data } = await getUserCompat(token);
  return data.user ?? null;
}

// Ask Intl whether it recognises the zone - it throws RangeError on anything
// that isn't a real IANA name. Cheaper and more honest than maintaining a
// hardcoded list that would go stale as zones are added or renamed.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* A snooze end: an ISO time with a zone, a REAL calendar time (2026-02-30 is refused, not rolled to 2 March by Date.parse; the timestamptz column
   would refuse it with a 500), and no more than SNOOZE_MAX_MS ahead. A past time is accepted and simply means not snoozed. */
const SNOOZE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
function isSnoozeTime(v: unknown, nowMs: number): boolean {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d || local.getUTCHours() !== h || local.getUTCMinutes() !== mi || local.getUTCSeconds() !== sec) return false;
  if (m[7] !== 'Z' && (Number(m[9]) > 14 || Number(m[10]) > 59)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= nowMs + SNOOZE_MAX_MS;
}

// GET - return current settings row (or null if not yet saved)
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb(token)
    .from(T.user_settings)
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return apiError('settings', error);
  return NextResponse.json({ settings: data });
}

// PATCH - upsert settings (only the fields sent)
export async function PATCH(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const capped = await readJsonCapped(req, BODY_CAPS.settings);
  if (capped.tooLarge) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  if (!capped.value || typeof capped.value !== 'object' || Array.isArray(capped.value)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const body = capped.value as Record<string, unknown>;

  // Sanitize - only allow known fields through
  const ALLOWED = [
    'account_size', 'risk_pct', 'default_coin', 'default_tf',
    'fr_threshold', 'fng_fear', 'fng_greed', 'rsi_ob', 'rsi_os', 'squeeze_threshold',
    'anti_chop_enabled',

    'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist',
    'display_name', 'country', 'trading_challenge', 'language',
    'timezone',
    'strategy_selection', 'strategy_params', 'arena_strategy',
    'arena_sound',
    'alert_quiet_start', 'alert_quiet_end', 'alert_snooze_until', 'alert_paused',
    'daily_summary_hour',
    'arena_sound_prefs',
  ];
  const payload: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) payload[key] = body[key];
  }
  // #1202: the client's own last-known server timestamp per field it's
  // writing - present only for a field this client has previously read a
  // confirmed value for. Absent (or missing an entry) means "I have never
  // synced this field," which the accept rule below treats as a real
  // conflict risk, not a free pass - see that rule's own comment for why.
  const knownAsOfRaw = body.knownAsOf;
  const knownAsOf: Record<string, string> = (knownAsOfRaw && typeof knownAsOfRaw === 'object' && !Array.isArray(knownAsOfRaw))
    ? Object.fromEntries(Object.entries(knownAsOfRaw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

  // timezone is written automatically by components/TimezoneSync.tsx from
  // Intl, not typed by a user, but it still arrives over a PATCH a client
  // controls - and it is later handed to toLocaleString() as a timeZone in the
  // Telegram alert cron. Reject anything that isn't a real IANA zone rather
  // than storing a value that would throw (or silently degrade every alert for
  // that user) later, far from here.
  if ('timezone' in payload) {
    const tz = payload.timezone;
    if (tz === null || tz === '') {
      payload.timezone = null;
    } else if (typeof tz !== 'string' || !isValidTimeZone(tz)) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }
  }

  // arena_sound is a tri-state (null = never asked): refuse anything else rather than store a string a client invented.
  if ('arena_sound' in payload && payload.arena_sound !== null && typeof payload.arena_sound !== 'boolean') {
    return NextResponse.json({ error: 'Invalid arena_sound' }, { status: 400 });
  }
  // The sound picker's object is checked field by field (lib/arenaSoundPrefs.ts): a known sound id, volume 0-1, three booleans, nothing else.
  if ('arena_sound_prefs' in payload && !isValidSoundPrefs(payload.arena_sound_prefs)) {
    return NextResponse.json({ error: 'Invalid arena_sound_prefs' }, { status: 400 });
  }

  // Telegram alert controls: hours are whole numbers 0-23 or null, snooze is an ISO time or null, paused is a boolean or null. Anything else is refused,
  // because the alert cron reads these to decide whether to send (lib/alertQuiet.ts).
  for (const k of ['alert_quiet_start', 'alert_quiet_end'] as const) {
    const v = payload[k];
    if (k in payload && v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23)) {
      return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 });
    }
  }
  // Quiet hours are a pair: both set or both off, in the same request. One alone would be stored as a window the cron ignores.
  if ('alert_quiet_start' in payload || 'alert_quiet_end' in payload) {
    if (!('alert_quiet_start' in payload) || !('alert_quiet_end' in payload) || (payload.alert_quiet_start === null) !== (payload.alert_quiet_end === null)) {
      return NextResponse.json({ error: 'Invalid alert_quiet_start/alert_quiet_end: set both or neither' }, { status: 400 });
    }
  }
  if ('alert_snooze_until' in payload) {
    const v = payload.alert_snooze_until;
    if (v !== null && !isSnoozeTime(v, Date.now())) return NextResponse.json({ error: 'Invalid alert_snooze_until' }, { status: 400 });
  }
  if ('alert_paused' in payload && payload.alert_paused !== null && typeof payload.alert_paused !== 'boolean') {
    return NextResponse.json({ error: 'Invalid alert_paused' }, { status: 400 });
  }
  // daily_summary_hour: a whole hour 0-23, or null for the default (07:00). Anything else is refused.
  if ('daily_summary_hour' in payload && !isValidSummaryHour(payload.daily_summary_hour)) {
    return NextResponse.json({ error: 'Invalid daily_summary_hour' }, { status: 400 });
  }

  // strategy_selection/strategy_params are jsonb - reject anything that isn't
  // the shape app/arena/page.tsx actually produces, rather than storing
  // garbage that would later crash StrategyPanel/useEMAStrategy on read.
  if ('strategy_selection' in payload) {
    const sel = payload.strategy_selection;
    if (sel !== null && !(Array.isArray(sel) && sel.every(v => typeof v === 'string'))) {
      return NextResponse.json({ error: 'Invalid strategy_selection' }, { status: 400 });
    }
  }
  if ('arena_strategy' in payload) {
    const a = payload.arena_strategy;
    if (a !== null && !(typeof a === 'string' && STRATEGY_IDS.has(a))) {
      return NextResponse.json({ error: 'Invalid arena_strategy' }, { status: 400 });
    }
  }
  if ('strategy_params' in payload) {
    const p = payload.strategy_params;
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);
    const valid = p === null || (isPlainObject(p) && Object.values(p).every(isPlainObject));
    if (!valid) {
      return NextResponse.json({ error: 'Invalid strategy_params' }, { status: 400 });
    }
  }

  /* Notification thresholds: brought inside the range the Settings field offers (lib/alertThresholdRanges.ts), so a stored value is always one
     the alert checks can reach; a squeeze threshold above 80 never fired. Clamped rather than refused: the page saves while the user types, and a
     refusal would keep a half-typed value unsaved and retried. Anything that is not a number is refused. */
  for (const key of Object.keys(payload)) {
    if (!isThresholdField(key)) continue;
    const v = clampThreshold(key, payload[key]);
    if (v === null) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
    payload[key] = v;
  }

  const client = sb(token);

  /* #1202: per-field optimistic concurrency. Read-then-write, not a single
   * atomic UPDATE - a genuinely simultaneous write to the SAME field from two
   * devices in the same instant has a small residual race. Accepted trade,
   * named on the issue: this is personal settings, not financial data, and
   * the baseline before this existed was ZERO arbitration. Full serializable
   * correctness would need per-field row locking or a stored procedure -
   * only worth it if this race is shown to actually bite in practice.
   *
   * ACCEPT RULE lives in shouldAcceptFieldWrite (lib/settingsFieldConcurrency.ts)
   * - extracted so QA can test it directly (#1223) rather than only through
   * one live two-device pass. See that file's own comment for the rule
   * itself and the correction PM/DevOps made to my first draft. */
  const { data: existing } = await client
    .from(T.user_settings)
    .select('field_updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  const serverTimestamps = (existing?.field_updated_at ?? {}) as Record<string, string>;

  const accepted: string[] = [];
  const rejected: string[] = [];
  const nowIso = new Date().toISOString();
  const acceptedPayload: Record<string, unknown> = {};
  const newFieldTimestamps: Record<string, string> = { ...serverTimestamps };

  for (const key of Object.keys(payload)) {
    const accept = shouldAcceptFieldWrite(serverTimestamps[key], knownAsOf[key]);
    if (accept) {
      accepted.push(key);
      acceptedPayload[key] = payload[key];
      newFieldTimestamps[key] = nowIso;
    } else {
      rejected.push(key);
    }
  }

  if (accepted.length === 0) {
    // Nothing this request contributed was real - every field lost to a
    // fresher confirmed write elsewhere. Skip the write entirely (including
    // the whole-row updated_at) rather than touching the row for no reason.
    const { data } = await client.from(T.user_settings).select('*').eq('user_id', user.id).maybeSingle();
    return NextResponse.json({ ok: true, accepted, rejected, settings: data });
  }

  const { error } = await client
    .from(T.user_settings)
    .upsert(
      { user_id: user.id, updated_at: nowIso, field_updated_at: newFieldTimestamps, ...acceptedPayload },
      { onConflict: 'user_id' },
    );

  if (error) return apiError('settings', error);

  const { data } = await client.from(T.user_settings).select('*').eq('user_id', user.id).maybeSingle();
  return NextResponse.json({ ok: true, accepted, rejected, settings: data });
}
