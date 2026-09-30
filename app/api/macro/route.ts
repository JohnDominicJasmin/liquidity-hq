import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { cached } from '@/lib/apiCache';
import { fetchFredRows } from '@/lib/fred';
import { computeRealYield, REAL_YIELD_SERIES } from '@/lib/realYield';

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

// Health is reported per symbol, and this route is the reason that matters.
// A failing symbol returns null and the response still goes out as a 200 with
// `{ dxy: null }` in it - so Yahoo blocking one series looks identical to a
// quiet market, and the card on the dashboard just renders a dash. Global
// Macro Context has already failed persistently once and was only noticed
// because a user said something.
/* ONE MINUTE PER SYMBOL, HELD IN THIS PROCESS (#1397, #1404).
 *
 * Each Yahoo fetch used to declare `next: { revalidate: 60 }` and nothing else.
 * On /api/econ-calendar that same declaration was MEASURED doing nothing: 50
 * page loads produced 50 upstream calls (see that route). Nobody has measured it
 * here, so it is not claimed broken - but every visitor's page calls this route
 * on load and again every ten minutes (MarketProvider), five Yahoo requests each
 * time, from one IP, to an endpoint that blocks by IP. `cached()` makes the
 * bound certain instead of hoped for: at most one request per symbol per minute
 * per instance, however many visitors there are, with concurrent callers
 * sharing one request rather than each starting their own.
 *
 * The fetch itself is `no-store` so there is exactly one cache with one age,
 * not this one stacked on Next's.
 *
 * A FAILURE IS NEVER REMEMBERED. `cached()` only stores what its fetcher
 * returns, so the fetcher THROWS for every failure shape and `yf` turns the
 * throw back into the `null` the response has always carried. Caching a null
 * would pin a one-off Yahoo hiccup on the dashboard for a minute for everyone. */
const YF_TTL_MS = 60_000;

/** Distinguishes "already reported to health" from an unexpected throw. */
class YfUnavailable extends Error {}

async function fetchYf(sym: string, label: string): Promise<{ price: number; chg: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const source = `yahoo:${label}`;
  try {
    const res = await fetch(`${YF_BASE}/${sym}?interval=1d&range=2d`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      reportHealth(source, 'macro', false, `HTTP ${res.status}`);
      throw new YfUnavailable(`HTTP ${res.status}`);
    }
    const parsed = extract(await res.json());
    // A 200 whose payload has no usable price is a failure here: extract()
    // returns null for a missing or non-positive price, which is precisely the
    // "responded fine, told us nothing" case.
    reportHealth(source, 'macro', parsed != null,
      parsed ? `${parsed.price}` : 'no price in payload');
    if (!parsed) throw new YfUnavailable('no price in payload');
    return parsed;
  } catch (e) {
    // Network error, timeout or a body that is not JSON: not yet reported.
    if (!(e instanceof YfUnavailable)) reportHealth(source, 'macro', false, healthError(e));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function yf(sym: string, label: string) {
  try {
    return await cached(`macro:yahoo:${label}`, YF_TTL_MS, () => fetchYf(sym, label));
  } catch {
    return null;
  }
}

/* The 10Y real yield comes from FRED, not Yahoo (#311).
 *
 * Yahoo has the nominal 10Y (^TNX) but not the inflation-indexed one, and the
 * nominal series cannot separate real rates from inflation expectations - see
 * the note in lib/realYield.ts for why that distinction decides the sign of
 * the signal for crypto.
 *
 * A one-hour module cache rather than the 12h default: DFII10 publishes each
 * business day after the US close, so a 12h cache would leave the new
 * observation unread until the middle of the following day.
 */
async function realYield() {
  const rows = await fetchFredRows(REAL_YIELD_SERIES, 3600_000);
  // An empty result is a failed measurement, not a quiet market - report it as
  // unhealthy so a silent FRED outage does not just render as a dash forever.
  reportHealth('fred:real-yield', 'macro', rows.length >= 2,
    rows.length >= 2 ? `${rows[rows.length - 1][1]}` : 'no usable observations');
  return computeRealYield(rows);
}

export async function GET(req: NextRequest) {
  // Previously fully uncapped (no auth, no rate limit) and cache:'no-store'
  // on every upstream Yahoo Finance call - a scripted caller hitting this in
  // a loop could hammer Yahoo with zero backpressure. Same per-IP pattern as
  // the other public data proxies (app/api/cmc, ath, funding, etc.).
  if (!rateLimit(`macro:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const [oil, dxy, spx, gold, jpy, real10y] = await Promise.all([
    yf('CL%3DF',   'oil'),   // WTI Crude Oil
    yf('DX-Y.NYB', 'dxy'),   // DXY (US Dollar Index)
    yf('%5EGSPC',  'spx'),   // S&P 500
    yf('GC%3DF',   'gold'),  // Gold futures
    yf('JPY%3DX',  'jpy'),   // USD/JPY - yen carry-trade direction (day change %)
    realYield(),             // 10Y real yield - the rates backdrop for a zero-yield asset
  ]);

  return NextResponse.json(
    { oil, dxy, spx, gold, jpy, real10y },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
