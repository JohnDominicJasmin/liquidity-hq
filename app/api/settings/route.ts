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
    'telegram_chat_id',
    'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist',
    'display_name', 'country', 'trading_challenge', 'language',
    'timezone',
  ];
  const payload: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (key in body) payload[key] = body[key];
  }

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

  const { error } = await sb(token)
    .from(T.user_settings)
    .upsert(payload, { onConflict: 'user_id' });

  if (error) return apiError('settings', error);
  return NextResponse.json({ ok: true });
}
