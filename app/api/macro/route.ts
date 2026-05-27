import { NextResponse } from 'next/server';

// Stooq symbols confirmed to return OHLCV data:
//   dx.f   = DXY futures (close tracks spot DXY ~±0.1)
//   ^spx   = S&P 500 index
//   xauusd = Gold spot (XAU/USD)
//   cl.f   = WTI Crude Oil futures

type StooqItem = {
  symbol?: string;
  close?:  number | string;
  open?:   number | string;
};

function extract(json: unknown): { price: number; chg: number } | null {
  const item = (json as { symbols?: StooqItem[] })?.symbols?.[0];
  if (!item) return null;
  const close = typeof item.close === 'number' ? item.close : parseFloat(String(item.close ?? ''));
  const open  = typeof item.open  === 'number' ? item.open  : parseFloat(String(item.open  ?? ''));
  if (!close || isNaN(close) || close <= 0) return null;
  const chg = (open > 0 && !isNaN(open)) ? ((close - open) / open) * 100 : 0;
  return { price: close, chg };
}

async function stooq(sym: string) {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&e=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },   // cache 5 min on the server
    });
    if (!res.ok) return null;
    return extract(await res.json());
  } catch { return null; }
}

export async function GET() {
  const [oil, dxy, spx, gold] = await Promise.all([
    stooq('cl.f'),
    stooq('dx.f'),     // DXY futures — confirmed working
    stooq('^spx'),
    stooq('xauusd'),
  ]);

  return NextResponse.json(
    { oil, dxy, spx, gold },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
