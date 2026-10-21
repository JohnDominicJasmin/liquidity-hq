import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { cached } from '@/lib/apiCache';
import { fetchFredRows } from '@/lib/fred';
import { computeRealYield, REAL_YIELD_SERIES } from '@/lib/realYield';
import { polledCacheControl } from '@/lib/cacheHeaders';

// Yahoo Finance v8 works fine server-to-server (no CORS restriction from a server).
// It only blocks browser requests via proxies (proxy IPs get 401).
// Confirmed working symbols:
//   DX-Y.NYB = DXY (99.24)   ^GSPC = SPX (7524)
//   GC=F     = Gold (4487)   CL=F  = Oil (88.85)
//   ^TNX     = US 10Y Treasury yield, nominal, in percent (4.12 = 4.12%)

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

type YFMeta = {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketChangePercent?: number;
};

function extract(json: unknown): { price: number; chg: number } | null {
  try {
    const r0 = (json as { chart?: { result?: Array<{ meta?: YFMeta; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } })
      ?.chart?.result?.[0];
    const result = r0?.meta;
    if (!result) return null;
    const price = result.regularMarketPrice;
    if (!price || price <= 0) return null;
    /* #1631 C: the ONE-day change, from the last two daily closes. This used `previousClose ?? chartPreviousClose`, and on a range query
       Yahoo leaves previousClose out, so chartPreviousClose - the close BEFORE the window - made "24h" a two-session change (S&P +0.69%
       where the day was +0.28%). The last close is today's (live during the session), the one before it is yesterday's. */
    // The newest bar is the latest session (its close can still be null mid-session): compare with the last close BEFORE it.
    const bars = r0?.indicators?.quote?.[0]?.close ?? [];
    const before = bars.slice(0, -1).filter((c): c is number => typeof c === 'number' && c > 0);
    const prev = before.length > 0 ? before[before.length - 1] : (result.previousClose ?? 0);
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
 * time, from one IP, to an endpoint that blocks by IP. `cached()` bounds it:
 * while Yahoo answers, at most one request per symbol per minute per instance,
 * however many visitors there are, with concurrent callers sharing one request
 * rather than each starting their own.
 *
 * The fetch itself is `no-store` so there is exactly one cache with one age,
 * not this one stacked on Next's.
 *
 * A FAILURE IS HELD FOR 30 SECONDS, NOT A MINUTE (QA and PM/DevOps, #1473).
 * Without a hold, the bound above is gone exactly when it matters: while Yahoo
 * blocks this IP, every visitor load retries every failing series. With it, a
 * refusing Yahoo gets at most one request per symbol per 30 seconds. Shorter
 * than the success TTL because a one-off hiccup is served as a dash to everyone
 * for the whole hold. The fetcher THROWS for every failure shape, `cached()`
 * holds the throw, and `yf` turns it back into the `null` the response has
 * always carried. */
const YF_TTL_MS = 60_000;
const YF_FAIL_TTL_MS = 30_000;

/** Distinguishes "already reported to health" from an unexpected throw. */
class YfUnavailable extends Error {}

async function fetchYf(sym: string, label: string): Promise<{ price: number; chg: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const source = `yahoo:${label}`;
  try {
    // 5 days of daily bars so a weekend or holiday still leaves two closes to compare (#1631 C).
    const res = await fetch(`${YF_BASE}/${sym}?interval=1d&range=5d`, {
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
    return await cached(`macro:yahoo:${label}`, YF_TTL_MS, () => fetchYf(sym, label),
      { failTtlMs: YF_FAIL_TTL_MS });
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

  const [oil, dxy, spx, gold, jpy, tnx, real10y] = await Promise.all([
    yf('CL%3DF',   'oil'),   // WTI Crude Oil
    yf('DX-Y.NYB', 'dxy'),   // DXY (US Dollar Index)
    yf('%5EGSPC',  'spx'),   // S&P 500
    yf('GC%3DF',   'gold'),  // Gold futures
    yf('JPY%3DX',  'jpy'),   // USD/JPY - yen carry-trade direction (day change %)
    // #1631 C: the NOMINAL 10Y, which is what a trader means by "the 10Y yield". The real yield below is a different number.
    yf('%5ETNX',   'tnx'),
    realYield(),             // 10Y real yield - the rates backdrop for a zero-yield asset
  ]);

  return NextResponse.json(
    { oil, dxy, spx, gold, jpy, tnx, real10y },
    { headers: { 'Cache-Control': polledCacheControl(300) } },
  );
}
