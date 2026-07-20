import { NextRequest, NextResponse } from 'next/server';
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    'telegram_chat_id',
    'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist',
    'display_name', 'country', 'trading_challenge',
  ];
  const payload: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (key in body) payload[key] = body[key];
  }

  const { error } = await sb(token)
    .from(T.user_settings)
    .upsert(payload, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
