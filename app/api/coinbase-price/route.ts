import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached, cachedPeek } from '@/lib/apiCache';
import { apiError } from '@/lib/apiError';
import { trackHealth } from '@/lib/apiHealth';

// Coinbase Exchange public ticker - no auth required, no CORS issues from server
const CB_TICKER = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';
const CB_USDT_TICKER = 'https://api.exchange.coinbase.com/products/USDT-USD/ticker';
// 20 s: every visitor's page asks every 30 s (MarketProvider fetchCoinbasePremium), and the premium is a spread of two prices that move far less than that in 20 s. It was 5 s, which let concurrent visitors
// at random phases drive up to 12 upstream rounds a minute (two Coinbase tickers each); at 20 s it is at most 3 whatever the visitor count (#1651 L13, traffic inventory).
const CACHE_TTL = 20_000;
// How long the answer waits for the USDT rate after the BTC price is in. A slower rate answers null this time (premium unknown), not late.
const USDT_WAIT_MS = 1_000;
// When Coinbase does not answer, the last good price is still served this long, flagged with its age (#1651).
const LAST_GOOD_MS = 10 * 60_000;

export async function GET(req: NextRequest) {
  if (!rateLimit(`coinbase-price:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    /* #1631 C: what one USDT is worth in USD, so the Coinbase premium compares like with like. Coinbase quotes BTC in USD, the exchange
       price we compare with is in USDT, and USDT trades a little under $1 (0.99885 in PM's check, which turned a raw -$86.9 "premium"
       into about +$8). Moves slowly: a minute is plenty. Optional - a miss answers null and the premium is shown as unknown.
       Started BEFORE the BTC price and given at most USDT_WAIT_MS once that is in (QA's review of #1665): the price must never wait on the
       rate. A rate still in flight is not lost - cached() keeps the request and the next caller gets its answer. */
    const usdtP: Promise<number | null> = cached('coinbase-usdt-usd', 60_000, () =>
      trackHealth('coinbase:USDT-USD', 'market', async () => {
        const res = await fetch(CB_USDT_TICKER, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(5_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { price?: string };
        const p = parseFloat(data.price ?? '');
        if (isNaN(p) || p < 0.9 || p > 1.1) throw new Error('bad price');
        return p;
      }, p => ({ detail: `$${p}` })),
    ).catch(() => null);
    // trackHealth sits INSIDE cached(), so a cache hit is not reported as a
    // fresh success. Reporting on every hit would keep the source looking
    // green off a 5s-old value long after Coinbase stopped answering.
    const price = await cached('coinbase-price', CACHE_TTL, () =>
      trackHealth('coinbase:BTC-USD', 'market', async () => {
        const res = await fetch(CB_TICKER, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          // PM audit of #1665: neither Coinbase request had a timeout, so a hung answer held the route open.
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { price?: string };
        const p = parseFloat(data.price ?? '');
        if (isNaN(p) || p <= 0) throw new Error('bad price');
        return p;
      }, p => ({ detail: `$${p}` })),
    );
    const usdtUsd = await Promise.race([usdtP, new Promise<null>((resolve) => setTimeout(() => resolve(null), USDT_WAIT_MS))]);
    return NextResponse.json({ price, usdtUsd });
  } catch (e) {
    const last = cachedPeek<number>('coinbase-price', LAST_GOOD_MS);
    if (last) {
      // No USDT rate with it: a premium must not be worked out from an old price against a live one.
      return NextResponse.json({ price: last.data, usdtUsd: null }, {
        headers: { 'Cache-Control': 'no-store', 'x-data-stale': '1', 'x-data-age-ms': String(Date.now() - last.ts) },
      });
    }
    return apiError('coinbase-price', e, 502, 'fetch failed');
  }
}
