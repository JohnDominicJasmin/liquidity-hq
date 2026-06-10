import { NextRequest, NextResponse } from 'next/server';

const CMC_KEY = process.env.CMC_API_KEY ?? '';
const BASE    = 'https://pro-api.coinmarketcap.com';

function cmcHeaders() {
  return { 'X-CMC_PRO_API_KEY': CMC_KEY, 'Accept': 'application/json' };
}

export async function GET(req: NextRequest) {
  if (!CMC_KEY) {
    return NextResponse.json({ error: 'CMC_API_KEY not configured' }, { status: 500 });
  }

  const type = req.nextUrl.searchParams.get('type');

  try {
    if (type === 'global') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(`${BASE}/v1/global-metrics/quotes/latest`, {
        headers: cmcHeaders(),
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      return NextResponse.json(d);
    }

    if (type === 'altseason') {
      // Fetch top 100 by market cap with 90-day % change
      const r = await fetch(
        `${BASE}/v1/cryptocurrency/listings/latest?limit=100&sort=market_cap&convert=USD`,
        {
          headers: cmcHeaders(),
          next: { revalidate: 300 },  // cache 5 min — 90d data doesn't move fast
        }
      );
      const d = await r.json();
      return NextResponse.json(d);
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'CMC fetch failed' },
      { status: 500 }
    );
  }
}
