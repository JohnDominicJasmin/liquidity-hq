import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { trackHealth } from '@/lib/apiHealth';
import { cached } from '@/lib/apiCache';

/* FIVE MINUTES, HELD IN THIS PROCESS (#1397, #1404) - the same five minutes the
 * fetch's `next: { revalidate: 300 }` and the response header already promised.
 *
 * That declaration was measured doing nothing on /api/econ-calendar (one
 * upstream call per visitor; see that route). It has not been measured here, so
 * it is not claimed broken. But the Arena, the briefing and the macro strip all
 * call this route, and `cached()` makes the bound certain: one request to the
 * rate provider per five minutes per instance, however many visitors there are.
 * The fetch is `no-store` so there is one cache with one age, not two stacked.
 *
 * The fetcher throws on both failure shapes and `cached()` never stores a
 * throw, so a failed read is retried by the next caller, not remembered. */
const JPY_TTL_MS = 5 * 60_000;

export async function GET(req: NextRequest) {
  if (!rateLimit(`forex-jpy:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    // Already threw on both failure shapes - non-2xx and a 200 with no JPY in
    // it - so trackHealth needs no extra judgement here, it just records what
    // this route already decided. Inside the cache, so health is reported once
    // per real upstream call rather than once per visitor.
    const jpy = await cached('forex:usd-jpy', JPY_TTL_MS, () => trackHealth('er-api:USD', 'macro', async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { rates?: Record<string, number> };
      const rate = d?.rates?.JPY;
      if (!rate) throw new Error('no JPY in response');
      return rate;
    }, rate => ({ detail: String(rate) })));
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
