import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { trackHealth } from '@/lib/apiHealth';

export async function GET(req: NextRequest) {
  if (!rateLimit(`forex-jpy:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    // Already threw on both failure shapes - non-2xx and a 200 with no JPY in
    // it - so trackHealth needs no extra judgement here, it just records what
    // this route already decided.
    const jpy = await trackHealth('er-api:USD', 'macro', async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', {
        next: { revalidate: 300 },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { rates?: Record<string, number> };
      const rate = d?.rates?.JPY;
      if (!rate) throw new Error('no JPY in response');
      return rate;
    }, rate => ({ detail: String(rate) }));
    /* `s-maxage`, not `max-age`. The old header cached per-BROWSER only, so
       every new visitor still cost an upstream call - the shared cache is the
       whole point of #177. Kept at 300s; added swr so a slow upstream serves
       stale rather than blocking. */
    return NextResponse.json({ jpy }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (e) {
    return apiError('forex/jpy', e, 502, 'Upstream fetch failed');
  }
}
