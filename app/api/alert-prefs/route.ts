import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/* Muted Telegram alert groups — stored as one row per muted key.
   Fail-open: if the table is missing or Supabase is down, nothing is muted. */

export async function GET() {
  const db = getSupabase();
  if (!db) return NextResponse.json({ muted: [] });
  try {
    const { data, error } = await db.from('muted_alerts').select('key');
    if (error) return NextResponse.json({ muted: [], error: error.message });
    return NextResponse.json({ muted: (data ?? []).map(r => String(r.key)) });
  } catch {
    return NextResponse.json({ muted: [] });
  }
}

export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  let body: { key?: string; muted?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const { key, muted } = body;
  if (!key || typeof key !== 'string' || key.length > 64) {
    return NextResponse.json({ ok: false, error: 'key required' }, { status: 400 });
  }
  const res = muted
    ? await db.from('muted_alerts').upsert({ key })
    : await db.from('muted_alerts').delete().eq('key', key);
  if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
