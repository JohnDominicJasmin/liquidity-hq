import { NextResponse } from 'next/server';

// Coinbase Exchange public ticker — no auth required, no CORS issues from server
const CB_TICKER = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';

export async function GET() {
  try {
    const res = await fetch(CB_TICKER, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'upstream failed' }, { status: 502 });
    const data = await res.json() as { price?: string };
    const price = parseFloat(data.price ?? '');
    if (isNaN(price) || price <= 0) return NextResponse.json({ error: 'bad price' }, { status: 502 });
    return NextResponse.json({ price });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
}
