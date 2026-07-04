import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

async function requireAuth(req: NextRequest | Request): Promise<boolean> {
  const token = (req.headers as Headers).get('Authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await sb.auth.getUser();
  return !!data.user;
}

export const dynamic = 'force-dynamic';

/* Muted Telegram alert groups — stored as one row per muted key. This is a
   single global config table with no per-user ownership (no user_id column),
   so there's no meaningful RLS policy to write for it — same reasoning as
   the rest of the alert system (app/api/telegram/alert/route.ts reads/writes
   it via the admin client too). RLS is enabled on the table with zero
   policies defined, which silently blocks the anon key on every operation
   including SELECT (returns empty, not an error) — using the service-role
   client here bypasses that instead of granting anon broad write access to
   a table anyone could otherwise mute alerts on.
   Fail-open: if Supabase is unreachable, nothing is muted. */

export async function GET(req: NextRequest) {
  if (!await requireAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from(T.muted_alerts).select('key');
    if (error) return NextResponse.json({ muted: [], error: error.message });
    return NextResponse.json({ muted: (data ?? []).map(r => String(r.key)) });
  } catch {
    return NextResponse.json({ muted: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!await requireAuth(req)) {
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
      ? await db.from(T.muted_alerts).upsert({ key })
      : await db.from(T.muted_alerts).delete().eq('key', key);
    if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Supabase not configured' }, { status: 503 });
  }
}
