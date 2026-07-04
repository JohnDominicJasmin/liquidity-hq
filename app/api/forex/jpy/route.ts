import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  if (!rateLimit(`forex-jpy:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
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
