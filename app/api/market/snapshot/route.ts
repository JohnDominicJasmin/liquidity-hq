/**
 * Server-side market snapshot: 24h ticker, 15m kline metrics, long/short ratios.
 *
 * GET /api/market/snapshot
 *   → { ticker: {...}, klines: {...}, lsr: {...}, ts }
 *
 * WHY THIS EXISTS
 *
 * Measured on a real /dashboard load, this is what the browser used to ask
 * Binance for directly, per visitor:
 *
 *   aggTrades                     45 req   180 weight
 *   ticker/24hr (45 symbols)       2 req   160 weight
 *   fapi/v1/klines                45 req    90 weight
 *   globalLongShortAccountRatio   46 req    46 weight
 *   topLongShortPositionRatio     45 req    45 weight
 *   everything else               10 req    33 weight
 *   ------------------------------------------------
 *   TOTAL                        193 req   554 weight
 *
 * This route takes the three biggest that are safe to move — ticker, klines and
 * the two ratio endpoints — which is 138 of those requests and 341 of that
 * weight, and serves them to every visitor from one cached result.
 *
 * The point is not that any single visitor was close to Binance's limit. It is
 * that the cost was per-visitor and therefore unbounded: two tabs doubled it,
 * ten visitors multiplied it by ten, and Binance rate-limits by IP, which on
 * mobile CGNAT or an office NAT is shared. Once an IP is limited Binance
 * returns 418 to everything from it, including the chart's own calls, so the
 * app appears completely broken with nothing on screen explaining why. Doing it
 * here makes the upstream cost fixed instead.
 *
 * WHAT IS DELIBERATELY LEFT IN THE BROWSER
 *
 * `aggTrades` (45 requests, 180 weight — the single largest remaining item)
 * stays client-side on purpose. It does two jobs: a pure CVD sum, which would
 * move happily, and whale detection, which dispatches a `whale-trade` DOM event
 * for each new large trade and dedupes against a per-client `lastAggId`. Moving
 * it would need a server→client push channel and a shared notion of "already
 * seen", i.e. a different design rather than a relocation. It is a known
 * remainder, not an oversight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { BINANCE_SYMS } from '@/lib/coins';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached } from '@/lib/apiCache';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { computeKlineMetrics, type KlineMetrics } from '@/lib/klineMetrics';

export const dynamic = 'force-dynamic';

/* Cadences the client used, kept so nothing gets fresher or staler than it was:
   fetchVolume ran every 3 minutes, fetchLSR every 5. */
const KLINES_TTL = 3 * 60_000;
const TICKER_TTL = 3 * 60_000;
const LSR_TTL    = 5 * 60_000;

/* 45 symbols x 2 ratio endpoints is 90 requests. Unbounded parallelism is what
   this route exists to stop doing, and it is also more sockets than the Render
   instance should hold open at once. */
const CONCURRENCY = 12;

/* Same mirror-walk as /api/funding and /api/market/rsi: individual Binance
   edges return 451/503 by region while the others are healthy. Resolved once
   per cache fill rather than per request. */
const SPOT_HOSTS    = ['https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const FUTURES_HOSTS = ['https://fapi.binance.com', 'https://fapi1.binance.com', 'https://fapi2.binance.com'];

const SYMS = Object.entries(BINANCE_SYMS).filter(([c]) => c !== 'hype');

interface TickerEntry { price: number; change: number; high: number; low: number; vol24: number }
interface LsrEntry {
  bnLongRatio?: number; bnShortRatio?: number;
  bnWhaleLongRatio?: number; bnWhaleShortRatio?: number;
}

/** 418 = IP banned, 429 = rate limited. Neither is about the symbol asked for. */
class BinanceBackoff extends Error {}

async function get(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (res.status === 418 || res.status === 429) throw new BinanceBackoff(`Binance ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (e instanceof BinanceBackoff) throw e;
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/* Cheap probe so a dead edge is found once, not 90 times.
 *
 * Swallows BinanceBackoff deliberately. A 418 on the ping means this IP is
 * banned, which is a reason to report "no reachable host" and return an empty
 * section - not to throw and take the other two sections down with it. Letting
 * it propagate is what made the ticker come back empty *and* rejected while
 * klines and ratios were fine. */
async function resolveHost(hosts: readonly string[], pingPath: string): Promise<string | null> {
  for (const h of hosts) {
    try {
      const ok = await get(`${h}${pingPath}`, 5000);
      if (ok !== null) return h;
    } catch { /* banned or rate-limited on this edge - try the next */ }
  }
  return null;
}

/* Fixed-size worker pool that stops the moment Binance signals a limit -
   spending the remaining requests into an active ban only extends it. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<boolean> {
  let next = 0, banned = false;
  const worker = async () => {
    for (;;) {
      if (banned) return;
      const i = next++;
      if (i >= items.length) return;
      try { await work(items[i]); }
      catch (e) { if (e instanceof BinanceBackoff) { banned = true; return; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return banned;
}

async function buildTicker(): Promise<Record<string, TickerEntry>> {
  const out: Record<string, TickerEntry> = {};
  const byCoin = Object.fromEntries(SYMS.map(([c, s]) => [s, c]));

  const absorb = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const d of arr as Record<string, string>[]) {
      const coin = byCoin[d.symbol];
      if (!coin) continue;
      out[coin] = {
        price:  parseFloat(d.lastPrice || '0'),
        change: parseFloat(d.priceChangePercent || '0'),
        high:   parseFloat(d.highPrice || '0'),
        low:    parseFloat(d.lowPrice || '0'),
        vol24:  parseFloat(d.quoteVolume || '0'),
      };
    }
  };

  /* Spot first: one batched call for all 45 symbols, exactly as the client
     did. Weight 80 either way - the saving is that it happens once per TTL
     rather than once per visitor. */
  const spot = await resolveHost(SPOT_HOSTS, '/api/v3/ping');
  if (spot) {
    const batch = encodeURIComponent(JSON.stringify(SYMS.map(([, s]) => s)));
    absorb(await get(`${spot}/api/v3/ticker/24hr?symbols=${batch}`));
  }

  /* Futures fallback. Spot and futures are separate rate-limit buckets, and in
     practice they fail independently - this was found with spot returning 418
     for a banned IP while futures answered normally on the same machine and
     the same second. Without this, one banned bucket meant no 24h volume
     anywhere in the app.
     The futures endpoint takes no `symbols` array, so this asks for everything
     (weight 40) and filters. Perp volume is not identical to spot volume for
     the same pair, so this is a degraded answer rather than an equal one -
     which is why it is a fallback and not the default. */
  const source = Object.keys(out).length > 0 ? 'spot' : 'futures';
  if (Object.keys(out).length === 0) {
    const fut = await resolveHost(FUTURES_HOSTS, '/fapi/v1/ping');
    if (fut) absorb(await get(`${fut}/fapi/v1/ticker/24hr`));
  }

  reportHealth('binance:ticker', 'market', Object.keys(out).length > 0,
    `${Object.keys(out).length} coins via ${source}`);
  return out;
}

async function buildKlines(): Promise<Record<string, KlineMetrics>> {
  /* Futures klines, with spot as fallback - the client preferred fapi because
     its taker buy/sell split is the one perp traders act on. */
  const fut  = await resolveHost(FUTURES_HOSTS, '/fapi/v1/ping');
  const spot = fut ? null : await resolveHost(SPOT_HOSTS, '/api/v3/ping');
  const out: Record<string, KlineMetrics> = {};
  if (!fut && !spot) { reportHealth('binance:klines', 'market', false, 'no reachable host'); return out; }

  const banned = await pool(SYMS, CONCURRENCY, async ([coin, sym]) => {
    const url = fut
      ? `${fut}/fapi/v1/klines?symbol=${sym}&interval=15m&limit=100`
      : `${spot}/api/v3/klines?symbol=${sym}&interval=15m&limit=100`;
    const raw = await get(url);
    if (!Array.isArray(raw)) return;
    const m = computeKlineMetrics(raw as string[][]);
    if (m) out[coin] = m;
  });

  reportHealth('binance:klines', 'market', Object.keys(out).length > 0 && !banned,
    banned ? `418/429 after ${Object.keys(out).length}/${SYMS.length}`
           : `${Object.keys(out).length}/${SYMS.length} via ${fut ? 'futures' : 'spot'}`);
  return out;
}

async function buildLsr(): Promise<Record<string, LsrEntry>> {
  const host = await resolveHost(FUTURES_HOSTS, '/fapi/v1/ping');
  const out: Record<string, LsrEntry> = {};
  if (!host) { reportHealth('binance:lsr', 'market', false, 'no reachable futures host'); return out; }

  const banned = await pool(SYMS, CONCURRENCY, async ([coin, sym]) => {
    const [g, w] = await Promise.all([
      get(`${host}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`),
      get(`${host}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=5m&limit=1`),
    ]);
    const gi = Array.isArray(g) ? (g[0] as Record<string, string>) : null;
    const wi = Array.isArray(w) ? (w[0] as Record<string, string>) : null;
    const e: LsrEntry = {};
    if (gi) { e.bnLongRatio = parseFloat(gi.longAccount || '0.5'); e.bnShortRatio = parseFloat(gi.shortAccount || '0.5'); }
    if (wi) { e.bnWhaleLongRatio = parseFloat(wi.longAccount || '0.5'); e.bnWhaleShortRatio = parseFloat(wi.shortAccount || '0.5'); }
    if (Object.keys(e).length) out[coin] = e;
  });

  reportHealth('binance:lsr', 'market', Object.keys(out).length > 0 && !banned,
    banned ? `418/429 after ${Object.keys(out).length}/${SYMS.length}` : `${Object.keys(out).length}/${SYMS.length}`);
  return out;
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`market-snapshot:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    /* Three independent caches with their original cadences, merged into one
       response. allSettled, not all: a failing kline fill must not take the
       ticker down with it - the client merges whatever arrives and leaves the
       rest at its previous value, which is how the per-coin version behaved
       when one symbol failed. */
    const [t, k, l] = await Promise.allSettled([
      cached('mkt:ticker', TICKER_TTL, buildTicker),
      cached('mkt:klines', KLINES_TTL, buildKlines),
      cached('mkt:lsr',    LSR_TTL,    buildLsr),
    ]);

    if (t.status === 'rejected' && k.status === 'rejected' && l.status === 'rejected') {
      reportHealth('binance:snapshot', 'market', false, healthError(t.reason));
      return apiError('market-snapshot', t.reason, 502, 'Upstream unavailable');
    }

    /* NAME THE PARTS THAT CAME BACK EMPTY (#228).
     *
     * `allSettled` above is right and stays: one dead upstream must not take the
     * other two down. What was wrong is what the caller was told afterwards - a
     * failed part became `{}` alongside HTTP 200, so the response asserted
     * success while the health table recorded failure, and nothing reconciled
     * them.
     *
     * Found when `klines` was empty on qa and staging for hours while prod served
     * 45. The cause was upstream: `binance:klines` health read
     * `418/429 after 0/45` - 418 is Binance's IP-ban code, so those two services
     * were banned for that endpoint while ticker and lsr on the same host kept
     * working. Nothing about the response said so.
     *
     * EMPTY COUNTS AS FAILED, not just rejected. `buildKlines` returns `{}`
     * rather than throwing when no host is reachable, so a rejection check alone
     * would still have missed this exact incident.
     *
     * SPECIFIC, NOT BOOLEAN: `['klines']` tells a caller what to hide. `true`
     * only tells it that something is wrong, which leaves it guessing or hiding
     * everything.
     *
     * AND DELIBERATELY NOT `cachedStale()`. That was my first instinct and QA
     * talked me out of it, correctly: an all-time high six hours old is right to
     * several decimals, but candles six hours old are a chart of the wrong six
     * hours, drawn confidently. lib/apiCache.ts already draws this line - "only
     * use this where stale is genuinely better than absent". An empty chart is
     * visibly empty; a stale one is silently wrong, and people draw trendlines on
     * these. */
    const ticker = t.status === 'fulfilled' ? t.value : {};
    const klines = k.status === 'fulfilled' ? k.value : {};
    const lsr    = l.status === 'fulfilled' ? l.value : {};

    const partial = [
      ['ticker', ticker] as const,
      ['klines', klines] as const,
      ['lsr',    lsr]    as const,
    ].filter(([, v]) => Object.keys(v).length === 0).map(([name]) => name);

    return NextResponse.json({
      ticker,
      klines,
      lsr,
      /* Omitted entirely when everything is healthy, so the common response is
         unchanged and `'partial' in body` is a valid check. */
      ...(partial.length ? { partial } : {}),
      ts: Date.now(),
    }, {
      /* Public and visitor-independent, and already only as fresh as the
         shortest TTL. Letting any shared cache in front of this serve it
         removes the origin hit for the common case. */
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    });
  } catch (e) {
    return apiError('market-snapshot', e, 500, 'Request failed');
  }
}
