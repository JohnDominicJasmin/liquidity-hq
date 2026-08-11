/**
 * Server-side proxy for CORS-restricted external APIs.
 * Replaces client-side corsproxy.io calls - no CORS issues server-side.
 *
 * GET /api/proxy?type=coinglass-flow     → Coinglass BTC exchange net flow
 * GET /api/proxy?type=coinglass-liq      → Coinglass BTC liquidation levels
 * GET /api/proxy?type=trends             → Google Trends bitcoin (7-day score)
 * GET /api/proxy?type=etf                → SoSoValue BTC + ETH ETF net flows
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached } from '@/lib/apiCache';
import { etfFlowMillions } from '@/lib/etfFlows';
import { trackHealth, reportHealth } from '@/lib/apiHealth';

// Google Trends' 7-day bitcoin score barely moves hour to hour, and the
// unofficial endpoint blocks aggressively under repeated hits - cache long.
const TRENDS_TTL = 60 * 60_000;

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// Same shape as /api/cmc and /api/econ-calendar: intentionally unauthenticated
// (public data, called for signed-out visitors too) - a bearer token is
// attached when the caller happens to be signed in, so a COINGLASS_API_KEY
// quota spike (coinglass-flow / coinglass-liq) is attributable to an account,
// not just an IP.
async function attributedUser(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return 'anon';
  try {
    const { data } = await sb(token).auth.getUser();
    return data.user?.id ?? 'anon';
  } catch {
    return 'anon';
  }
}

/* Shared edge cache (#177) - this route fans out to several third-party APIs
   and was calling them again for every visitor.

   `ok` is a parameter rather than assumed because two of the paths below can
   return a 200 that is really a failure: Coinglass forwards its error bodies
   verbatim, and the trends path deliberately converts an upstream block into an
   empty 200 so the page degrades quietly. Caching either would hold a dead
   response at the edge for five minutes. Only genuine payloads get the header. */
const PROXY_CACHE = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };
const proxyCache = (ok: boolean) => (ok ? PROXY_CACHE : undefined);

/* PASSTHROUGH TYPES (#238).
 *
 * #200 moved every SWEEP - one request per symbol across the whole coin list -
 * behind cached routes, and stopped at 117 calls on the grounds that the rest
 * were too small to be worth a route each. QA corrected that framing and was
 * right: the titled problem is "the browser calls Binance and Bybit directly",
 * so 117 is a smaller instance of the same problem rather than a different one.
 * The finish line is ZERO, not a lower number.
 *
 * These are not sweeps. Each is one call for one thing - a single symbol, or a
 * global figure - so a fan-out is the wrong shape. What they need is a proxy,
 * and this route already is one: allowlisted, cached, rate-limited, and carrying
 * the proxyCache(ok) guard that refuses to cache an upstream error as a success.
 *
 * A TABLE RATHER THAN FIFTEEN BRANCHES, because fifteen near-identical if-blocks
 * is where a copy-paste error hides.
 *
 * PARAMS ARE ALLOWLISTED PER ENTRY, which is a cache-key decision as much as a
 * security one: an unbounded param space means unbounded keys in a Map that
 * never evicts (#199), and a free-text passthrough would turn this route into an
 * open proxy to two exchanges.
 */
interface PassEntry {
  url: string;
  params: readonly string[];
  ttlMs: number;
  fixed?: Record<string, string>;
}

const PASSTHROUGH: Record<string, PassEntry> = {
  /* Bybit. Note for anyone slicing these later: Bybit returns NEWEST-first and
     Binance OLDEST-first - the bug qa/e2e/klines-route.spec.ts now guards. */
  'recent-trade':    { url: 'https://api.bybit.com/v5/market/recent-trade',
                       params: ['symbol', 'limit'], fixed: { category: 'linear' }, ttlMs: 30_000 },
  'bybit-tickers':   { url: 'https://api.bybit.com/v5/market/tickers',
                       params: [], fixed: { category: 'linear' }, ttlMs: 30_000 },
  'account-ratio-1': { url: 'https://api.bybit.com/v5/market/account-ratio',
                       params: ['symbol', 'period', 'limit'], fixed: { category: 'linear' }, ttlMs: 120_000 },
  'open-interest-1': { url: 'https://api.bybit.com/v5/market/open-interest',
                       params: ['symbol', 'intervalTime', 'limit'], fixed: { category: 'linear' }, ttlMs: 120_000 },
  'funding-history': { url: 'https://api.bybit.com/v5/market/funding/history',
                       params: ['symbol', 'limit', 'startTime', 'endTime'], fixed: { category: 'linear' }, ttlMs: 900_000 },

  /* Binance spot and futures */
  'binance-24hr':    { url: 'https://api.binance.com/api/v3/ticker/24hr',
                       params: ['symbols', 'symbol'], ttlMs: 30_000 },
  'depth':           { url: 'https://api.binance.com/api/v3/depth',
                       params: ['symbol', 'limit'], ttlMs: 15_000 },
  'premium-index':   { url: 'https://fapi.binance.com/fapi/v1/premiumIndex',
                       params: ['symbol'], ttlMs: 60_000 },
  'oi-hist':         { url: 'https://fapi.binance.com/futures/data/openInterestHist',
                       params: ['symbol', 'period', 'limit'], ttlMs: 120_000 },
  'lsr-global':      { url: 'https://fapi.binance.com/futures/data/globalLongShortAccountRatio',
                       params: ['symbol', 'period', 'limit'], ttlMs: 120_000 },
  'lsr-top':         { url: 'https://fapi.binance.com/futures/data/topLongShortPositionRatio',
                       params: ['symbol', 'period', 'limit'], ttlMs: 120_000 },
  'funding-rate-1':  { url: 'https://fapi.binance.com/fapi/v1/fundingRate',
                       params: ['symbol', 'limit', 'startTime', 'endTime'], ttlMs: 900_000 },

  /* Not exchanges, but the same reasoning: still the browser talking to a third
     party on every visit, and each is one global figure the whole app shares. */
  'fng':             { url: 'https://api.alternative.me/fng/',
                       params: ['limit'], ttlMs: 900_000 },
  'deribit-book':    { url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency',
                       params: ['currency', 'kind'], ttlMs: 60_000 },
  'llama-stables':   { url: 'https://stablecoins.llama.fi/stablecoins',
                       params: ['includePrices'], ttlMs: 900_000 },
};

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  /* 600/min, not 20. The old figure suited a route four callers used a handful
     of times; #238 adds fifteen passthrough types a single page load can hit many
     times over. The same oversight on the klines route rejected 54-98 requests
     per visit with a 429 from our OWN route, and the resulting drop in outbound
     traffic looked exactly like the cache working - a rate limit masquerading as
     a saving. These responses are cache reads and cost nothing upstream, so the
     limit is there to stop a scripted flood, not to ration a normal page. */
  if (!rateLimit(`proxy:${ip}`, 600, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const type = req.nextUrl.searchParams.get('type');
  const user = await attributedUser(req);
  console.log(`[proxy] ip=${ip} user=${user} type=${type}`);

  try {
    /* ── Coinglass: BTC exchange net flow - DEAD UPSTREAM ──────────────────
     * Both coinglass-* branches below call the retired /public/v2/ API, which
     * returns HTTP 500 for every symbol even with COINGLASS_API_KEY set. The
     * v4 replacement rejects this account's tier with
     * `{"code":"401","msg":"Upgrade plan"}`, and Coinglass has no free API
     * tier. Verified 2026-07-30.
     *
     * MarketProvider no longer calls either branch. They are left here, rather
     * than deleted, so that migrating to open-api-v4.coinglass.com is a change
     * to these two URLs plus the response parsing - see pendings/PENDING.md.
     * Do NOT wire a new caller to them expecting data.
     *
     * Deliberately NOT health-tracked. They are known dead by decision, not by
     * accident, and nothing calls them - reporting would park two permanently
     * red rows on /ops for a state nobody intends to fix until there is
     * revenue, which trains the eye to ignore red. Add tracking as part of the
     * v4 migration, when the answer starts mattering again.
     */
    if (type === 'coinglass-flow') {
      const cgKey = process.env.COINGLASS_API_KEY;
      const r = await fetch(
        'https://open-api.coinglass.com/public/v2/exchange_amount_chart?symbol=BTC&time_type=h24',
        { next: { revalidate: 300 }, headers: cgKey ? { 'coinglassSecret': cgKey } : {} }
      );
      return NextResponse.json(await r.json(), { headers: proxyCache(r.ok) });
    }

    /* ── Coinglass: BTC liquidation levels ── */
    if (type === 'coinglass-liq') {
      const cgKey = process.env.COINGLASS_API_KEY;
      const r = await fetch(
        'https://open-api.coinglass.com/public/v2/liquidation_chart?symbol=BTC&time_type=h4',
        { next: { revalidate: 300 }, headers: cgKey ? { 'coinglassSecret': cgKey } : {} }
      );
      return NextResponse.json(await r.json(), { headers: proxyCache(r.ok) });
    }

    /* ── Google Trends: bitcoin 7-day search score (2-step) ── */
    if (type === 'trends') {
      const EMPTY = { default: { timelineData: [] } };
      try {
        // Inside cached(), so a cache hit does not re-report success - with a
        // 1h TTL that would otherwise keep the source green for an hour after
        // Google started blocking. The catch below turns a block into an empty
        // 200, which is exactly the shape that hides a dead upstream.
        const json = await cached('trends', TRENDS_TTL, () => trackHealth(
          'google-trends:bitcoin', 'other', async () => {
          // Step 1: get widget token
          const exploreReq = JSON.stringify({
            comparisonItem: [{ keyword: 'bitcoin', geo: '', time: 'now 7-d' }],
            category: 0,
            property: '',
          });
          const exploreUrl =
            'https://trends.google.com/trends/api/explore?hl=en-US&tz=480&req=' +
            encodeURIComponent(exploreReq);

          const exploreRes = await fetch(exploreUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(8000),
          });

          // Google blocked / rate-limited - throw so this failure isn't cached
          if (!exploreRes.ok) throw new Error('trends explore blocked');

          const raw1 = await exploreRes.text();
          const json1 = JSON.parse(raw1.replace(/^\)\]\}'\n?/, ''));
          const widgets: Array<{ id: string; token: string; request: unknown }> =
            json1?.widgets ?? [];
          const ts = widgets.find(w => w.id === 'TIMESERIES');
          if (!ts?.token || !ts?.request) throw new Error('trends token missing');

          // Step 2: fetch timeline data
          const dataUrl =
            'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=480&req=' +
            encodeURIComponent(JSON.stringify(ts.request)) +
            '&token=' + encodeURIComponent(ts.token);

          const dataRes = await fetch(dataUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(8000),
          });

          if (!dataRes.ok) throw new Error('trends data blocked');

            const raw2 = await dataRes.text();
            return JSON.parse(raw2.replace(/^\)\]\}'\n?/, ''));
          },
          j => {
            const n = (j as { default?: { timelineData?: unknown[] } })?.default?.timelineData?.length ?? 0;
            return { ok: n > 0, detail: n > 0 ? `${n} points` : 'no timeline data', items: n };
          },
        ));
        return NextResponse.json(json, { headers: PROXY_CACHE });
      } catch {
        // Google Trends blocked / timed out - return empty, never 500, never cached
        return NextResponse.json(EMPTY);
      }
    }

    /* ── SoSoValue: BTC + ETH spot ETF net flows ── */
    if (type === 'etf') {
      /* REWRITTEN 2026-08-10 (#175). The previous version scraped an
         unauthenticated JSON path and had NEVER succeeded - 301 consecutive
         failures with last_ok_at NULL in prod's health table. Measured before
         rewriting rather than assumed:

             https://sosovalue.com/api/etf/us-btc-spot   -> HTTP 404
             https://api.sosovalue.com/etf/us-btc-spot   -> DNS does not resolve

         So it was not a 403 or a region block, which is what the old comment
         theorised and what its browser-headers workaround was solving for. The
         endpoint was gone, and its `.xyz -> .com` migration had never been
         verified against a live response.

         SoSoValue now runs an authenticated API:
           GET https://openapi.sosovalue.com/openapi/v1/etfs/summary-history
           header  x-soso-api-key
           params  symbol=BTC|ETH, country_code=US, limit

         QUOTA IS THE CONSTRAINT, and it is why this caches aggressively.
         The account is on the Demo plan: 10,000 calls/month and 10/min. Two
         calls per refresh (BTC + ETH) at one refresh per hour is 48/day, about
         1,460/month - roughly 15% of the allowance, leaving room for the other
         environments if a key is ever added to one.

         An hour is generous for the data itself: `total_net_inflow` is a DAILY
         figure and only changes after a US trading session closes. */
      const ETF_TTL_MS = 60 * 60 * 1000;

      async function fetchSoSoFlow(symbol: 'BTC' | 'ETH'): Promise<number | null> {
        const apiKey = process.env.SOSOVALUE_API_KEY;
        /* No key: make no call and report nothing. Reporting a failure here
           would fill the health table on every environment that deliberately
           has no key, which is the noise #176 is about. Not configured is not
           unhealthy. */
        if (!apiKey) return null;

        return cached(`sosovalue:etf:${symbol}`, ETF_TTL_MS, async () => {
          const url = 'https://openapi.sosovalue.com/openapi/v1/etfs/summary-history'
            + `?symbol=${symbol}&country_code=US&limit=1`;
          const r = await fetch(url, {
            headers: { 'x-soso-api-key': apiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) throw new Error(`sosovalue ${symbol} HTTP ${r.status}`);
          const body = await r.json();

          /* Parsing and the unit conversion live in lib/etfFlows.ts so both are
             testable without a key or a network call - see the comment there
             for why the unit is the dangerous half. Throws on an unusable
             payload, which the caller turns into a health failure rather than
             a silent zero. */
          return etfFlowMillions(body);
        });
      }

      const [btcRes, ethRes] = await Promise.allSettled([
        fetchSoSoFlow('BTC'),
        fetchSoSoFlow('ETH'),
      ]);
      const btc = btcRes.status === 'fulfilled' ? btcRes.value : null;
      const eth = ethRes.status === 'fulfilled' ? ethRes.value : null;

      /* Only report health when a key exists. Otherwise every keyless
         environment reports a failure for a call it never made. */
      if (process.env.SOSOVALUE_API_KEY) {
        const got = [btc, eth].filter(v => v != null).length;
        const why = [btcRes, ethRes]
          .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
          .map(x => String(x.reason?.message ?? x.reason)).join('; ');
        reportHealth('sosovalue:etf-flows', 'market', got === 2,
          got === 2 ? 'btc + eth' : why || (got === 1 ? 'only one of btc/eth' : 'no data'),
          got);
      }

      /* btc/eth are now plain numbers in MILLIONS, or null.

         This DID need a client change and my first comment here claimed it did
         not. MarketProvider read four nested shapes off the raw payload
         (`btc?.data?.list?.[0]?.totalNetInflow` and friends); every one of them
         is undefined on a number, so the store would silently never have been
         set and the panel would have stayed exactly as broken as before, with
         the health table now green. Updated alongside this. */
      return NextResponse.json({ btc, eth }, { headers: PROXY_CACHE });
    }

    /* Table-driven passthrough (#238). Placed after the hand-written branches so
       none of their behaviour changes. */
    const entry = type ? PASSTHROUGH[type] : undefined;
    if (entry) {
      const u = new URL(entry.url);
      for (const [k, v] of Object.entries(entry.fixed ?? {})) u.searchParams.set(k, v);
      for (const k of entry.params) {
        const v = req.nextUrl.searchParams.get(k);
        if (v != null && v !== '') u.searchParams.set(k, v);
      }

      const go = async () => {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) {
          /* FAIL LOUDLY (#228). Throwing means cached() stores nothing, so a ban
             is retried rather than pinned, and the caller gets a status instead
             of a plausible-looking empty body. */
          const err = new Error(`${type} upstream ${r.status}`);
          (err as Error & { status?: number }).status = r.status;
          throw err;
        }
        return r.json();
      };

      try {
        /* Keyed on the FULL resolved query, so two callers with different params
           cannot share an entry. ttlMs 0 skips the cache, for callers paginating
           a time range - their cursors are timestamps and would make the key
           space unbounded (#199). */
        const body = entry.ttlMs > 0
          ? await cached(`proxy:${type}:${u.search}`, entry.ttlMs, go)
          : await go();
        return NextResponse.json(body, { headers: entry.ttlMs > 0 ? PROXY_CACHE : undefined });
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        return apiError('proxy', e, 502, status
          ? `${type} upstream returned ${status}`
          : 'Upstream unavailable');
      }
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return apiError('proxy', e, 500, 'Proxy fetch failed');
  }
}
