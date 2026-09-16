import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

async function getAuthedUserId(req: NextRequest | Request): Promise<string | null> {
  const token = (req.headers as Headers).get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export const dynamic = 'force-dynamic';

/* Muted Telegram alert groups - one row per (user_id, key). Was a single
   global config table with no per-user ownership until 2026-07-17 (see
   supabase/migrations/20260717_muted_alerts_per_user.sql) - any user muting
   a coin/rule silenced it for every Pro user's Telegram feed. Now scoped:
   every read/write is filtered to the authenticated user's own rows. Uses
   the service-role client (not the user's own token) because the cron route
   (app/api/telegram/alert/route.ts) also needs bulk cross-user reads - the
   user_id filter here is what actually enforces the boundary, not RLS.
   Fail-open: if Supabase is unreachable, nothing is muted. */

export async function GET(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from(T.muted_alerts).select('key').eq('user_id', userId);
    // #1309 item 10: a DB failure used to answer {muted: []} with a 200, which
    // the page couldn't tell apart from "this user genuinely has zero mutes" -
    // so it re-seeded the default mute set on top of whatever the user had
    // actually chosen. An error status lets the page treat "unknown" as
    // unknown instead of as "brand new user".
    if (error) { console.error('[alert-prefs] GET:', error.message); return NextResponse.json({ error: 'Failed to load' }, { status: 503 }); }
    return NextResponse.json({ muted: (data ?? []).map(r => String(r.key)) });
  } catch (e) {
    console.error('[alert-prefs] GET exception:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Failed to load' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { key?: string; muted?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const { key, muted } = body;
  if (!key || typeof key !== 'string' || key.length > 64) {
    return NextResponse.json({ ok: false, error: 'key required' }, { status: 400 });
  }
  try {
    const db = getSupabaseAdmin();
    const res = muted
      ? await db.from(T.muted_alerts).upsert({ user_id: userId, key })
      : await db.from(T.muted_alerts).delete().eq('user_id', userId).eq('key', key);
    if (res.error) { console.error('[alert-prefs] POST:', res.error.message); return NextResponse.json({ ok: false, error: 'Failed to update' }, { status: 500 }); }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[alert-prefs] POST exception:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'Request failed' }, { status: 503 });
  }
}
