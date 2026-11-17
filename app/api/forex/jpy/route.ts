import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { trackHealth } from '@/lib/apiHealth';
import { cached } from '@/lib/apiCache';
import { polledCacheControl } from '@/lib/cacheHeaders';

/* FIVE MINUTES, HELD IN THIS PROCESS (#1397, #1404) - the same five minutes the
 * fetch's `next: { revalidate: 300 }` and the response header already promised.
 *
 * That declaration was measured doing nothing on /api/econ-calendar (one
 * upstream call per visitor; see that route). It has not been measured here, so
 * it is not claimed broken. But the Arena, the briefing and the macro strip all
 * call this route, and `cached()` bounds it: while the rate provider answers,
 * one request per five minutes per instance, however many visitors there are.
 * The fetch is `no-store` so there is one cache with one age, not two stacked.
 *
 * The fetcher throws on both failure shapes and `cached()` holds the throw for
 * 30 seconds (#1473): while the provider refuses, at most one request per 30
 * seconds, and each caller in between gets the same 502 without a new call. */
const JPY_TTL_MS = 60_000;
const JPY_FAIL_TTL_MS = 30_000;

/* THE LIVE RATE, WITH ITS OWN TIMESTAMP (#1651, PM 2026-11-17). Every USD/JPY surface (the briefing's Yen watch, the macro strip, the Arena's macro-risk input) reads THIS route, and it used to answer with a daily reference rate (open.er-api.com updates once a day) while the page said "Updated just now" about the moment it was FETCHED. Now: the market's own last price (Yahoo JPY=X, the same symbol /api/macro reads) with the time of that price, and the daily rate only as a fallback, labelled with ITS own update time. `asOf` is that time in epoch ms; `source` says which one answered. */
interface JpyRate { jpy: number; asOf: number; source: 'yahoo' | 'er-api' }
async function fetchLive(): Promise<JpyRate> {
  const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/JPY%3DX?interval=1m&range=1d', {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
  const meta = ((await res.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> } })?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice, t = meta?.regularMarketTime;
  if (!(typeof price === 'number' && price > 0) || !(typeof t === 'number' && t > 0)) throw new Error('no usable JPY=X price');
  return { jpy: price, asOf: t * 1000, source: 'yahoo' };
}
async function fetchDaily(): Promise<JpyRate> {
  const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { rates?: Record<string, number>; time_last_update_unix?: number };
  const rate = d?.rates?.JPY;
  if (!rate) throw new Error('no JPY in response');
  return { jpy: rate, asOf: (d.time_last_update_unix ?? 0) * 1000 || Date.now(), source: 'er-api' };
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`forex-jpy:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    // Already threw on both failure shapes - non-2xx and a 200 with no JPY in
    // it - so trackHealth needs no extra judgement here, it just records what
    // this route already decided. Inside the cache, so health is reported once
    // per real upstream call rather than once per visitor.
    const rate = await cached('forex:usd-jpy', JPY_TTL_MS, () => trackHealth('er-api:USD', 'macro', async () => {
      try { return await fetchLive(); } catch { return await fetchDaily(); }
    }, r => ({ detail: `${r.jpy} via ${r.source}` })), { failTtlMs: JPY_FAIL_TTL_MS });
    /* `s-maxage`, not `max-age`. The old header cached per-BROWSER only, so
       every new visitor still cost an upstream call - the shared cache is the
       whole point of #177. Kept at 300s; added swr so a slow upstream serves
       stale rather than blocking. */
    return NextResponse.json({ jpy: rate.jpy, asOf: rate.asOf, source: rate.source }, {
      headers: { 'Cache-Control': polledCacheControl(60) },
    });
  } catch (e) {
    return apiError('forex/jpy', e, 502, 'Upstream fetch failed');
  }
}
