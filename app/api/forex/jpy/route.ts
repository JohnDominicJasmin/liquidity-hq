import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 300 },
    });
    if (!r.ok) throw new Error('upstream error');
    const d = await r.json() as { rates?: Record<string, number> };
    const jpy = d?.rates?.JPY;
    if (!jpy) throw new Error('no JPY in response');
    return NextResponse.json({ jpy }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
