import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getUser(token: string) {
  const { data } = await sb(token).auth.getUser();
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

  const body = await req.json() as Record<string, unknown>;

  // Sanitize - only allow known fields through
  const ALLOWED = [
    'account_size', 'risk_pct', 'default_coin', 'default_tf',
    'fr_threshold', 'fng_fear', 'fng_greed', 'rsi_ob', 'rsi_os', 'squeeze_threshold',
    'anti_chop_enabled',

    'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist',
    'display_name', 'country', 'trading_challenge', 'language',
    'timezone',
    'strategy_selection', 'strategy_params',
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

  // strategy_selection/strategy_params are jsonb - reject anything that isn't
  // the shape app/arena/page.tsx actually produces, rather than storing
  // garbage that would later crash StrategyPanel/useEMAStrategy on read.
  if ('strategy_selection' in payload) {
    const sel = payload.strategy_selection;
    if (sel !== null && !(Array.isArray(sel) && sel.every(v => typeof v === 'string'))) {
      return NextResponse.json({ error: 'Invalid strategy_selection' }, { status: 400 });
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

  const client = sb(token);

  /* #1202: per-field optimistic concurrency. Read-then-write, not a single
   * atomic UPDATE - a genuinely simultaneous write to the SAME field from two
   * devices in the same instant has a small residual race. Accepted trade,
   * named on the issue: this is personal settings, not financial data, and
   * the baseline before this existed was ZERO arbitration. Full serializable
   * correctness would need per-field row locking or a stored procedure -
   * only worth it if this race is shown to actually bite in practice.
   *
   * ACCEPT RULE (PM/DevOps correction on #1202 - the original draft was
   * wrong): a field's write is accepted iff `server_ts` is null (nobody has
   * ever confirmed a value for this field - nothing to conflict with) OR
   * the client's own known-as-of timestamp for that field is present AND
   * >= `server_ts`. A client with NO known-as-of for a field that the
   * server already has a timestamp for is REJECTED, not accepted - "I have
   * never synced this field" is not the same as "there is no conflict",
   * and treating it as one is exactly the bug this whole mechanism exists
   * to close (a stale, never-synced local edit stomping a newer confirmed
   * write from another device). */
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
    const serverTsRaw = serverTimestamps[key];
    const serverTsMs = serverTsRaw ? Date.parse(serverTsRaw) : NaN;
    const clientTsRaw = knownAsOf[key];
    const clientTsMs = clientTsRaw ? Date.parse(clientTsRaw) : NaN;
    const accept = !Number.isFinite(serverTsMs) || (Number.isFinite(clientTsMs) && clientTsMs >= serverTsMs);
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
