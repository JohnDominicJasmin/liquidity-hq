import { NextResponse } from 'next/server';

// Yahoo Finance v8 works fine server-to-server (no CORS restriction from a server).
// It only blocks browser requests via proxies (proxy IPs get 401).
// Confirmed working symbols:
//   DX-Y.NYB = DXY (99.24)   ^GSPC = SPX (7524)
//   GC=F     = Gold (4487)   CL=F  = Oil (88.85)

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

type YFMeta = {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketChangePercent?: number;
};

function extract(json: unknown): { price: number; chg: number } | null {
  try {
    const result = (json as { chart?: { result?: Array<{ meta?: YFMeta }> } })
      ?.chart?.result?.[0]?.meta;
    if (!result) return null;
    const price = result.regularMarketPrice;
    if (!price || price <= 0) return null;
    const prev = result.previousClose ?? result.chartPreviousClose ?? 0;
    const chg  = prev > 0
      ? ((price - prev) / prev) * 100
      : (result.regularMarketChangePercent ?? 0);
    return { price, chg };
  } catch { return null; }
}

async function yf(sym: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${YF_BASE}/${sym}?interval=1d&range=2d`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return extract(await res.json());
  } catch { clearTimeout(timer); return null; }
}

export async function GET() {
  const [oil, dxy, spx, gold, jpy] = await Promise.all([
    yf('CL%3DF'),      // WTI Crude Oil
    yf('DX-Y.NYB'),    // DXY (US Dollar Index)
    yf('%5EGSPC'),     // S&P 500
    yf('GC%3DF'),      // Gold futures
    yf('JPY%3DX'),     // USD/JPY — yen carry-trade direction (day change %)
  ]);

  return NextResponse.json(
    { oil, dxy, spx, gold, jpy },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
