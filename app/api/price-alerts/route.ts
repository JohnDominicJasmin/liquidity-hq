import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const { data, error } = await db
    .from('price_alerts')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const body = await req.json();
  const { coin, target_price, direction, label } = body;
  if (!coin || !target_price || !direction)
    return NextResponse.json({ error: 'coin, target_price, direction required' }, { status: 400 });
  const { data, error } = await db
    .from('price_alerts')
    .insert({ coin, target_price: parseFloat(target_price), direction, label: label ?? '' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

export async function DELETE(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await db.from('price_alerts').update({ active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
