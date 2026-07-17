import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached } from '@/lib/apiCache';

// Coinbase Exchange public ticker - no auth required, no CORS issues from server
const CB_TICKER = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';
// Short TTL - still collapses concurrent visitor fan-out into one upstream
// call without the price visibly lagging.
const CACHE_TTL = 5_000;

export async function GET(req: NextRequest) {
  if (!rateLimit(`coinbase-price:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    const price = await cached('coinbase-price', CACHE_TTL, async () => {
      const res = await fetch(CB_TICKER, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('upstream failed');
      const data = await res.json() as { price?: string };
      const p = parseFloat(data.price ?? '');
      if (isNaN(p) || p <= 0) throw new Error('bad price');
      return p;
    });
    return NextResponse.json({ price });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
}
