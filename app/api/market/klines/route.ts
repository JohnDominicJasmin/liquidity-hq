/* Candles, fetched once on the server and served to every visitor (#200).
 *
 * 41 distinct call shapes across 12 client files currently go straight from the
 * browser to Binance and Bybit - 550 requests per visitor for the Bybit variant
 * alone, the single largest line in QA's egress measurement. Each browser pays
 * for its own copy of data that is identical for everyone.
 *
 * ── WHY THIS EXISTS RATHER THAN REUSING /api/market/snapshot ────────────────
 *
 * That route returns one fixed shape: 45 symbols, one interval, computed
 * metrics. These callers want an arbitrary (symbol, interval, limit) and two of
 * them paginate over a time range. QA measured the spread: 5 fixed intervals
 * plus several variable, limits from 1 to 1500, and two range-paginating sites.
 * A snapshot endpoint cannot serve that, so this is parameterised.
 *
 * ── THE CACHE IS LOAD-BEARING, NOT AN OPTIMISATION ──────────────────────────
 *
 * Moving these server-side concentrates onto ONE egress IP what is currently
 * spread across thousands of visitor IPs. At the time of writing Binance has
 * already banned the qa and staging IPs for exactly this endpoint:
 *
 *     binance:klines  ok=false  detail="418/429 after 0/45"
 *
 * 418 is Binance's ban code. So this route is only safe because `cached()`
 * collapses N visitors into one upstream call per TTL, and #201's single-flight
 * collapses a burst at expiry into one rather than N. Without both, this would
 * make the problem worse rather than better. Do not remove either.
 *
 * Both of those hold only while the upstream ANSWERS. A refusal used to be
 * stored nowhere, so during a ban each visitor request (except ones that
 * overlapped in time) asked Binance again. KLINES_FAIL_TTL_MS below is the third piece
 * (#1404): a refusal is held per key, so the upstream sees at most one request
 * per key per hold, however many visitors there are.
 *
 * ── AND IT FAILS LOUDLY ─────────────────────────────────────────────────────
 *
 * #228 was an empty `{}` returned with HTTP 200 for hours while the health table
 * recorded the ban. Nothing here returns an empty success: an upstream refusal
 * produces a non-2xx with the upstream's own status attached, so a caller and a
 * probe can both tell "no candles" from "refused".
 */
import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/apiCache';
import { intervalToMs, closedCandleKey, CLOSE_SKEW_MS } from '@/lib/candles';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { BINANCE_SYMS, BINANCE_SPOT_SYMS, BYBIT_SYMS, OKX_SYMS, HL_SYMS, bybitPriceFactor } from '@/lib/coins';
import { COIN_UNIVERSE } from '@/lib/coinUniverse.generated';
import {
  HL_INFO_URL, HL_INTERVALS, hlIntervalToMs, hlCandleSnapshotBody, parseHlCandles,
  hlCandlesToBareArray, hlMultiplier,
} from '@/lib/hyperliquid';
import { OKX_BARS, OKX_MAX_LIMIT, okxBarToMs, okxCandlesParams, okxCandlesToBareArray, okxPageCount, mergeOkxPages } from '@/lib/okx';
import { shouldFailToBybit, canFailoverForRequest, bybitIntervalFor } from '@/lib/klinesFailover';
import { polledCacheControl } from '@/lib/cacheHeaders';
import { exchangeFetch } from '@/lib/exchangeGuard';

/* `okx` added for #1651. Its dialect, its response quirks and the five silent ways it returns the
   wrong window are all in `lib/okx.ts` rather than here - this route holds the plumbing, that
   module holds the decisions, and the decisions are unit-testable without a request. */
type Source = 'bybit' | 'binance' | 'binance-futures' | 'okx' | 'hyperliquid';

// Reverse of BINANCE_SYMS, for #1077's failover: given the Binance symbol a
// caller asked for, find which coin it is so BYBIT_SYMS/bybitPriceFactor can
// answer for it.
const BN_SYM_TO_COIN: Record<string, string> = Object.fromEntries(
  Object.entries(BINANCE_SYMS).map(([coin, sym]) => [sym, coin])
);

/* #1077: reshape a Bybit kline response into the bare-array, oldest-first
 * shape every caller of source=binance/binance-futures already expects -
 * never the caller's own requested shape, which is the whole point of a
 * failover the caller shouldn't have to know happened. Every current caller
 * (lib/useEMAStrategy.ts, components/KLineProChart.tsx,
 * components/HigherTfMoveBadge.tsx, lib/backtestEngine.ts,
 * lib/usePerpSpot.ts) reads only indices 0-5 (time, open, high, low, close,
 * volume) positionally, so those are the only ones populated - fabricating
 * Binance-only fields (closeTime, quoteVolume, trade count...) nothing reads
 * would be inventing data, not converting it.
 *
 * Volume is left in Bybit's own units, unconverted - every caller only ever
 * compares a series against its OWN average/history (see
 * lib/ribbonCandles.ts's identical reasoning), never against Binance's
 * absolute volume scale, so there is nothing to convert TO. */
function bybitKlinesToBinanceShape(body: unknown, priceFactor: number, limitRaw: number): (string | number)[][] | null {
  const list = (body as { result?: { list?: string[][] } })?.result?.list;
  if (!Array.isArray(list)) return null;
  const oldestFirst = [...list].reverse(); // Bybit is newest-first
  const trimmed = oldestFirst.length > limitRaw ? oldestFirst.slice(-limitRaw) : oldestFirst;
  return trimmed.map(row => {
    const [start, open, high, low, close, volume] = row;
    return [
      Number(start),
      String(Number(open) * priceFactor),
      String(Number(high) * priceFactor),
      String(Number(low) * priceFactor),
      String(Number(close) * priceFactor),
      volume,
    ];
  });
}

/* Closed sets, and that is a memory decision as much as a validation one.
 *
 * `cached()` holds a module-level Map that never evicts, so the cache key space
 * has to be finite or this route is a slow leak. QA flagged exactly this on
 * #199: "if any key includes a user id, a timestamp, or free text, it is a
 * leak". Symbols come from the app's own coin list, intervals are an allowlist,
 * and limit is snapped to a bucket - so the worst case is
 * sources x symbols x intervals x buckets, which is bounded and small. */
const SYMBOLS: Record<Source, Set<string>> = {
  /* THE WHOLE UNIVERSE ON THE TWO PERP VENUES, not the editorial 50 (owner report, 2026-11-11).
     Arena offers all 463 `UNIVERSE_COINS` in its selector (`arena/page.tsx:153`) and its scanner
     (`:1850`), while this allowlist was built from `BYBIT_SYMS` - which is derived from
     `RENDERED_IDS`. So ~413 of the coins Arena offers were refused BY NAME here: the chart sat on
     "Loading 15M..." against an empty canvas with the default 0-10 axis, and the scanner printed
     "n/a n/a" for signal and score because the EMA strategy never got candles. Price and VWAP still
     showed, from the universe ticker pass, which is what made it look like a partial outage rather
     than a coin the data layer had never heard of.

     CORRECTION, and it was wrong in this comment first: that pass carries PRICE AND 24H CHANGE
     ONLY (see its own header). It does NOT carry VWAP. The "VWAP" the owner saw on CYBER is the
     live price rendered under a VWAP heading - a separate mislabelling defect QA traced to three
     sites, affecting every coin including the core 50. Left here because this sentence was the
     only written explanation for a VWAP on a non-core coin, and it would have stopped the next
     person looking.

     STILL A REAL ALLOWLIST. Derived from the generated universe, so an arbitrary or delisted symbol
     is rejected exactly as before - the set is bigger, not absent. `bybitPriceFactor()` already
     reads every universe row, so the multipliers these coins need are in place.

     THE SHARED MAPS ARE DELIBERATELY NOT TOUCHED. 35 files read `BYBIT_SYMS`/`BINANCE_SYMS`,
     including the alert cron, so widening those would turn 463 coins into live consumers everywhere
     rather than on the one chart a user actually opened (PM's option C, 2026-11-11).

     THE CACHE KEY SPACE grows with it: the bound above is sources x symbols x intervals x buckets,
     and symbols goes from ~50 to ~462 on these two sources. Still finite, and `cached()` caps
     entries and bytes, so it evicts rather than growing without limit. */
  bybit:             new Set(COIN_UNIVERSE.map(r => r.bybit).filter((s): s is string => !!s)),
  /* SPOT GETS THE SPOT MAP. `BINANCE_SYMS` is generated from `fapi/v1/exchangeInfo`, so it proves a
     FUTURES listing and says nothing about spot - `SPXUSDT` is on futures and not on spot. This set
     used to be `BINANCE_SYMS`, so `source=binance&symbol=SPXUSDT` was admitted and then 400'd at
     Binance. The SPX chart still drew, because KLineProChart falls back to `binance-futures` when
     the spot try fails (components/KLineProChart.tsx:1664-1668) - a real fallback hiding a request
     that could never succeed, exactly as the market snapshot's futures fallback hid the same defect
     in its batched ticker call. Now the refusal is ours and immediate, and the chart takes the same
     fallback one upstream call sooner. See `BINANCE_SPOT_SYMS` in lib/coins.ts. */
  binance:           new Set(Object.values(BINANCE_SPOT_SYMS)),
  /* The universe's `binance` column IS the futures symbol - the generator reads
     `fapi/v1/exchangeInfo` - so it belongs here and NOT in the spot set above, which stays on the
     spot-verified map for the `SPXUSDT` reason given there. There is no spot-verified column for
     the universe, so widening spot would re-create that defect 413 times over. */
  'binance-futures': new Set(COIN_UNIVERSE.map(r => r.binance).filter((s): s is string => !!s)),
  /* 49 of the 50 rendered coins, from the generated `okx` column. Three ids the other two venues
     carry are deliberately absent because OKX names a different asset by that ticker - so this set
     being SMALLER than BYBIT_SYMS for a reason other than listing coverage is correct. */
  okx:               new Set(Object.values(OKX_SYMS)),
  /* FROM `HL_SYMS`, WHICH IS ALREADY FILTERED. A Hyperliquid name whose multiplier is unverified
     is absent from that map by construction, so it cannot be requested here and cannot be priced
     at x1 - see `HL_SYMS` in lib/coins.ts. Mixed case on purpose: `kPEPE`, not `KPEPE`. */
  hyperliquid:       new Set(Object.values(HL_SYMS)),
};

/* Bybit takes minutes as integers plus D/W/M; Binance takes suffixed strings.
   Deliberately not translated between them - each caller already knows which
   dialect it wants, and silently rewriting an interval is how a chart ends up
   showing a timeframe nobody asked for. */
const INTERVALS: Record<Source, Set<string>> = {
  bybit:             new Set(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M']),
  binance:           new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']),
  'binance-futures': new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']),
  /* OKX's own spelling, CASE INCLUDED - minute bars lowercase, hour and day bars uppercase. `4h`
     is `code: '51000' Parameter bar error` while `4H` works, so one `.toLowerCase()` anywhere in
     the chain breaks half the timeframes and leaves the other half working. The list lives in
     lib/okx.ts so the allowlist here and the request builder there cannot disagree. */
  okx:               new Set<string>(OKX_BARS),
  /* ALL FOURTEEN, CASE-SENSITIVE, AND `1m` AND `1M` ARE BOTH IN HERE. A minute and a month,
     differing only by case - so nothing in this route may case-normalise the interval. It does
     not today (`q.get('interval')` is used raw), and that is now load-bearing rather than
     incidental: lowercasing would merge a one-minute series with a one-month one under a single
     cache key. OKX had a case-sensitivity rule; this venue has a case COLLISION. */
  hyperliquid:       new Set<string>(HL_INTERVALS),
};

const UPSTREAM: Record<Source, string> = {
  bybit:             'https://api.bybit.com/v5/market/kline',
  binance:           'https://api.binance.com/api/v3/klines',
  'binance-futures': 'https://fapi.binance.com/fapi/v1/klines',
  okx:               'https://www.okx.com/api/v5/market/candles',
  /* ONE URL FOR EVERY QUERY, SELECTED BY A `type` FIELD IN A POSTED BODY - not a path and not a
     query string. Present here so the `UPSTREAM[source]` existence check above still gates this
     source, but `new URL(...)` + search params is NOT how this venue is called. See
     `fetchHlCandles`. */
  hyperliquid:       HL_INFO_URL,
};

/* Snap `limit` to the next bucket up rather than caching it verbatim.
 *
 * The observed limits are 1, 2, 4, 20, 24, 25, 26, 50, 100, 152, 200, 300, 1000
 * and 1500. Caching each exactly would multiply the key space by 14 for data
 * that is a prefix of the same series - a caller asking for 20 candles and one
 * asking for 24 can both be served from the 25-bucket. Over-fetching slightly
 * and slicing is strictly cheaper than a second upstream call. */
const BUCKETS = [1, 5, 25, 50, 100, 200, 300, 500, 1000, 1500];
const bucketFor = (n: number) => BUCKETS.find(b => b >= n) ?? 1500;

/* Long candles change slowly; short ones do not. A 1-minute bar is stale in a
   minute, a weekly bar is not stale in an hour. One TTL for both would either
   thrash the short intervals or serve wrong short candles. */
function ttlFor(interval: string): number {
  if (/^(1|3|5)$|^(1|3|5)m$/.test(interval))          return 30_000;
  if (/^(15|30)$|^(15|30)m$/.test(interval))          return 60_000;
  if (/^(60|120)$|^(1|2)h$/.test(interval))           return 300_000;
  return 900_000;                                      // 4h and longer
}

/* A REFUSAL IS HELD FOR 30 SECONDS, PER KEY (#1404, the pattern from #1473).
 *
 * `cached()` stores only successes. So while Binance refused this server, every
 * request for a key that did not overlap another made a fresh call - more
 * traffic at the host that is refusing, for as long as it refuses. With the
 * hold, the refusal is rethrown to every caller inside it without a new call,
 * and the first caller after it retries. While the upstream refuses: at most
 * one request per key per 30 seconds. Per KEY, not per host - a ban covers the
 * whole IP, so the upstream still sees one request per distinct (source,
 * symbol, interval, bucket) that pages ask for in each hold. Bounded by the
 * closed sets above, not zero.
 *
 * The primary call and the Bybit fallback both get it. A held primary error
 * still carries its upstream status, so a held Binance key goes straight to
 * the fallback where one exists, and that is served from its own cache entry
 * while the entry is fresh. If Bybit is refusing too, its own hold stops each
 * visitor asking it again.
 *
 * Seconds, not the success TTL, for the reason /api/macro gives: a one-off
 * failure answers every caller for the whole hold - from the Bybit fallback
 * where one exists, as a 502 where none does. 30 seconds is also the shortest
 * TTL above, so no key holds a failure longer than it would hold a success.
 * Range requests are covered by it too since #1649 (they are cached now). */
const KLINES_FAIL_TTL_MS = 30_000;

/** #1649: range requests per minute per IP; ours is the 429, before any upstream call. */
const KLINES_RANGE_PER_MIN = 30;
const RANGE_HISTORY_TTL_MS = 6 * 60 * 60_000;

/** How long a range answer is kept: 6 h once the window ended before the current candle opened (history cannot change), otherwise the
 *  interval's normal TTL. Weekly and monthly have no fixed length (intervalToMs null), so they always take the normal TTL. */
function rangeTtl(interval: string, end: string | null): number {
  const iv = intervalToMs(interval);
  const endMs = end ? Number(end) : NaN;
  if (iv != null && Number.isFinite(endMs) && endMs < closedCandleKey(iv, Date.now())) return RANGE_HISTORY_TTL_MS;
  return ttlFor(interval);
}

/* Trim a bucketed response back to what the caller actually asked for.
 *
 * The bucket is what gets CACHED and fetched; this is what gets RETURNED. QA
 * caught that the previous version documented "over-fetching slightly and
 * slicing" and only implemented the over-fetching, so a caller asking for 20
 * candles received 25 - and anything computing over "the last N" silently used a
 * different N than it asked for.
 *
 * THE TWO UPSTREAMS ORDER CANDLES OPPOSITELY, measured rather than assumed:
 *
 *     bybit    NEWEST-first   -> the recent end is the HEAD, slice(0, n)
 *     binance  OLDEST-first   -> the recent end is the TAIL, slice(-n)
 *
 * Getting that backwards returns the OLDEST n candles instead of the newest -
 * a chart of the wrong period, rendered confidently, which is the same class of
 * failure as serving stale candles and is why that was rejected on #228.
 *
 * Shape is otherwise preserved exactly: Bybit keeps its {retCode, result:{list}}
 * envelope, Binance its bare array, so no client has to change how it reads a
 * response. */
function sliceToLimit(source: Source, body: unknown, n: number): unknown {
  if (source === 'bybit') {
    const b = body as { result?: { list?: unknown[] } };
    const list = b?.result?.list;
    if (!Array.isArray(list) || list.length <= n) return body;
    return { ...b, result: { ...b.result, list: list.slice(0, n) } };
  }
  if (!Array.isArray(body) || body.length <= n) return body;
  return body.slice(-n);
}

export async function GET(req: NextRequest) {
  /* 1200/min, not the 120 this shipped with.
   *
   * 120 was copied from routes a page calls a handful of times. This one is
   * called per symbol per panel: measured on a real page load, /markets issues
   * ~150 kline requests and /correlation ~150, so 120 rejected 54-98 of them per
   * visit with a 429 from OUR OWN route. The pages degraded, and the resulting
   * drop in outbound traffic looked like the cache working - a rate limit
   * masquerading as a saving is a worse outcome than no cache at all, because it
   * reports success.
   *
   * 1200 leaves ~8x headroom over the heaviest measured page. It is deliberately
   * generous: these responses are served from a module-level cache and cost
   * nothing upstream, so the limit exists to stop a scripted flood, not to ration
   * a page doing what it normally does.
   *
   * The real fix is fewer client calls - one request per symbol set rather than
   * per symbol - and that is batch 2. Until then this must not be the thing that
   * breaks a page. */
  const ip = getClientIp(req);
  if (!rateLimit(`klines:${ip}`, 1200, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const q = req.nextUrl.searchParams;
  const source = (q.get('source') ?? 'bybit') as Source;
  /* UPPERCASED FOR EVERY VENUE BUT ONE. Hyperliquid names an instrument by its bare base and
     spells its 1000x listings with a lower-case `k` - `kPEPE`, `kBONK`. `.toUpperCase()` turns
     those into `KPEPE`/`KBONK`, which are not instruments, so the two coins this would break are
     exactly the two where getting the scale wrong costs a factor of 1000.
     Not a general relaxation: the allowlist below is `HL_SYMS`'s own values, so a caller still
     cannot reach an arbitrary name - it must send the exact spelling this app ships. */
  const rawSymbol = q.get('symbol') ?? '';
  const symbol = source === 'hyperliquid' ? rawSymbol : rawSymbol.toUpperCase();
  const interval = q.get('interval') ?? '';
  const limitRaw = Number(q.get('limit') ?? '200');
  const start = q.get('start');
  const end = q.get('end');

  if (!UPSTREAM[source]) {
    return NextResponse.json({ error: `unknown source '${source}'` }, { status: 400 });
  }
  if (!SYMBOLS[source].has(symbol)) {
    /* NAMES THE SOURCE, because "not one this app tracks" is now reachable for a symbol the app
       DOES track - just not on that venue's market. `SPXUSDT` on `source=binance` is the case. */
    return NextResponse.json(
      { error: `symbol '${symbol}' is not one this app tracks on '${source}'` }, { status: 400 },
    );
  }
  if (!INTERVALS[source].has(interval)) {
    return NextResponse.json({ error: `interval '${interval}' is not valid for ${source}` }, { status: 400 });
  }
  if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 1500) {
    return NextResponse.json({ error: 'limit must be between 1 and 1500' }, { status: 400 });
  }
  // #1649 (security review): start/end are millisecond timestamps and nothing else, checked before they reach the exchange or a cache key.
  if ((start && !/^\d{1,13}$/.test(start)) || (end && !/^\d{1,13}$/.test(end))) {
    return NextResponse.json({ error: 'start and end must be millisecond timestamps' }, { status: 400 });
  }

  const limit = bucketFor(limitRaw);

  /* OKX SERVES AT MOST 300 BARS PER CALL, SO LARGER WINDOWS ARE PAGED SERVER-SIDE (see
     fetchUpstream). The first version of this refused `limit > 300` with a 400, which was the
     wrong call and worth recording: `lib/useEMAStrategy.ts:834` asks for **1000** bars, so a
     refusal would have made OKX unusable as a fallback at the one call site this venue was added
     for - the EMA signal - while looking like a tidy guard.

     Paging is only viable because the cursor semantics were MEASURED rather than assumed: with
     `after` set to a page's oldest timestamp, the next page's newest bar is exactly one bar older,
     so four calls return 1200 contiguous bars with no overlap and no hole. 5 pages x 300 = 1500,
     which is the same ceiling `limitRaw` is already checked against above, so no new bound is
     needed here.

     The cost is paid ONCE PER CANDLE, not per caller: the pages are assembled inside
     fetchUpstream, so `cached()` holds the finished window under one key and every caller in that
     bucket shares it. */

  /* RANGE REQUESTS (start/end cursors; two callers paginate with them) - #1649, replacing #1632 H3.
   *
   * They used to skip the cache entirely, because timestamps in the key made the key space unbounded (#199). Two things changed: apiCache is
   * bounded by SIZE since #1634 (48 MB, least recently used first), and an open range was a way to make this server call the exchange as
   * often as anyone liked - the per-IP limit above is sized for cached reads. So now:
   *   - at most 30 range requests per minute per IP (our 429, before any upstream call);
   *   - cached: a window that ended before the current candle opened is history and cannot change, so it is kept 6 h; a window that reaches
   *     the forming candle is kept like any other read of that interval. */
  const isRange = Boolean(start || end);
  /* NO RANGE REQUESTS FOR OKX, and this is a refusal rather than an omission. OKX pages with
     `before`/`after` cursors that are EXCLUSIVE and bounded to 100 rows on a different endpoint
     (`/market/history-candles`), so mapping `start`/`end` onto them is a different implementation
     with a different off-by-one, not a parameter rename. Silently ignoring the window would serve
     the most recent 300 candles to a caller that asked for a specific month - plausible data for
     the wrong period, which is the failure mode this venue already has four of. */
  if (isRange && source === 'okx') {
    return NextResponse.json(
      { error: 'okx does not support start/end here - it pages with before/after cursors on a different endpoint' },
      { status: 400 },
    );
  }
  if (isRange && !rateLimit(`klines-range:${ip}`, KLINES_RANGE_PER_MIN, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const url = new URL(UPSTREAM[source]);
  /* NO `okx` BRANCH HERE ON PURPOSE. It needs one URL PER PAGE, built by `okxCandlesParams` so the
     dialect and the cursor live in one place, so fetchUpstream builds its own and this `url` is
     unused for that source. Two places building the same request is how a parameter rename ends up
     applied to one of them. */
  if (source === 'bybit') {
    url.searchParams.set('category', 'linear');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));
    if (start) url.searchParams.set('start', start);
    if (end)   url.searchParams.set('end', end);
  } else {
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));
    if (start) url.searchParams.set('startTime', start);
    if (end)   url.searchParams.set('endTime', end);
  }

  /* DECLARED HERE, ABOVE `fetchUpstream`, BECAUSE THAT CLOSURE NOW READS IT. It used to sit with
     the TTL block below, which was fine while only the TTL used it. `const` is not hoisted, and
     although `fetchUpstream` is not INVOKED until after that point today, a closure whose
     correctness depends on where it happens to be called from is one refactor away from a
     temporal-dead-zone crash on a billed route. Moved rather than left to luck - the same mistake
     `app/api/grok/route.ts` already records about `logTag`. The TTL block below still explains
     what the flag means; this is only its declaration. */
  const closedOnly = q.get('closed') === '1';

  const fetchUpstream = async () => {
    const r = await exchangeFetch(url, { cache: 'no-store' });
    if (!r.ok) {
      /* Throwing rather than returning an empty body is the #228 lesson applied
         at the point it was learned: `cached()` never stores a rejection as an
         answer, so a ban is held for KLINES_FAIL_TTL_MS and then retried rather
         than pinned for the TTL, and the caller gets a status instead of a
         plausible-looking empty array. */
      const err = new Error(`${source} klines ${r.status}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    const body = await r.json();
    /* OKX IS NORMALISED BEFORE THE CACHE SEES IT, and the ordering is the whole reason this sits
       inside fetchUpstream rather than beside sliceToLimit below.

       `okxCandlesToBareArray` THROWS on a non-zero `code`, and OKX sends its errors on HTTP 200 -
       an unknown instrument is `{ code: '51001', data: [] }` with a 200 status, so the `r.ok`
       check above sees nothing wrong. Throwing here means `cached()` never stores a refusal as an
       answer, which is the #228 lesson this route already applies to non-2xx, extended to the one
       venue whose refusals arrive looking like success. Normalising after the cache would have
       pinned `51001` as "this instrument has no candles" for the whole TTL.

       It also returns the bare oldest-first array, so `sliceToLimit`'s `slice(-n)` branch below is
       already correct for it and no caller learns a third shape.
       `closedOnly` decides the forming bar: dropped for a closed=1 caller, kept otherwise, which
       matches what the other two sources do rather than making OKX stricter. The two variants have
       distinct cache keys (`closedTag`), so one can never be served to the other's caller. */
    return body;
  };

  /* OKX, PAGED AND NORMALISED BEFORE THE CACHE SEES IT. Separate from fetchUpstream above rather
     than a branch inside it, because it is a different number of requests, not a different body
     shape.
     THROWS ON A NON-ZERO `code`, which is the half that matters: OKX sends its errors on HTTP 200,
     so an unknown instrument is `{ code: '51001', data: [] }` with a 200 status and the `r.ok`
     check sees nothing wrong. `okxCandlesToBareArray` throws on it, so `cached()` never stores a
     refusal as an answer - the #228 lesson this route already applies to non-2xx, extended to the
     one venue whose refusals arrive looking like success. Normalising after the cache instead
     would have pinned `51001` as "this instrument has no candles" for the whole TTL. */
  const fetchOkxPaged = async () => {
    const pages = okxPageCount(limit);
    const bodies: unknown[] = [];
    let after: number | undefined;
    for (let page = 0; page < pages; page++) {
      const u = new URL(UPSTREAM.okx);
      for (const [k, v] of okxCandlesParams(symbol, interval, Math.min(limit, OKX_MAX_LIMIT), after)) {
        u.searchParams.set(k, v);
      }
      const r = await exchangeFetch(u, { cache: 'no-store' });
      if (!r.ok) {
        const err = new Error(`okx klines ${r.status}`);
        (err as Error & { status?: number }).status = r.status;
        throw err;
      }
      const body = await r.json();
      bodies.push(body);
      /* The cursor comes from the PARSED page, so a page whose `code` is non-zero throws here
         rather than ending the loop with a short window. Rows are oldest-first, so [0] is this
         page's oldest bar and the next page asks for bars strictly older than it.
         `includeForming: true` for the cursor only - dropping the forming bar before reading the
         cursor would still give the right ANSWER, but a window that happens to contain only a
         forming bar would read as exhausted. */
      const rows = okxCandlesToBareArray(body, { includeForming: true });
      if (rows.length === 0) break;
      after = rows[0][0];
      /* A SHORT PAGE MEANS THE HISTORY RAN OUT, so stop rather than spend the remaining calls on
         answers that will be empty. A coin listed last month cannot fill 1000 4h bars. */
      if (rows.length < OKX_MAX_LIMIT) break;
    }
    return mergeOkxPages(bodies as never[], limit, { includeForming: !closedOnly });
  };

  /* BOUNDARY-ALIGNED EXPIRY for closed-candle callers (#325), FLOORED.
   *
   * ttlFor is a stopwatch unrelated to the data: on a 4h chart it expires 16
   * times per candle to observe one change, and since #316 the signal path
   * recomputes ON the close and then gets a response up to 15 minutes old.
   *
   * A bypass is the wrong fix - candle close is a global event, so the moment
   * you would bypass is the moment the cache matters most.
   *
   * THE FIRST ATTEMPT AT THIS GOT BOTH NON-PROD ENVIRONMENTS BANNED. Without
   * a floor the TTL bottoms out at CLOSE_SKEW_MS just before any close - four
   * seconds, on every interval, at exactly the instant #316 synchronises
   * clients onto. Binance replied 418.
   *
   * closedCandleTtl takes the MAXIMUM of the boundary distance and the
   * caller's existing TTL, so this can only ever lengthen the cache. More
   * upstream traffic than the pre-#325 baseline is impossible by
   * construction rather than by anyone remembering.
   *
   * OPT-IN: it cannot apply globally. Anything wanting the forming bar to
   * keep moving must not be pinned to the last close. Distinct cache key so a
   * boundary-aligned entry is never served to a default caller. Falls back
   * entirely for intervals with no computable boundary (W, M).
   *
   * Declared outside the try so the Bybit stand-in in the catch keeps the
   * same closed/live split (#1515 follow-up): before, its key had no closed
   * tag, so a closed=1 request and a live one shared one stand-in entry. */
  /* HYPERLIQUID: A POSTED BODY, AN EXPLICIT WINDOW, AND A REFUSAL THAT CANNOT BECOME x1.
   *
   * Its own branch for the same reason OKX has one - this is a different REQUEST SHAPE, not a
   * different response body. One URL, a `type` field, and a JSON body; `new URL()` plus search
   * params does not reach it.
   *
   * THE WINDOW IS REQUIRED. `candleSnapshot` has no `limit` - both `startTime` and `endTime` are
   * mandatory (a missing one is one of the measured 422s), so a limit-based request is converted
   * into a window here. `limit + 2` bars back rather than `limit`: one for the forming bar that
   * `closedOnly` may drop, one for the boundary case where `now` sits just inside a new bar.
   * Asking for slightly more and slicing is what every other source here already does.
   *
   * THREE-PART ERROR CHECK, because `r.ok` alone is not enough on this venue (all measured):
   *   unknown coin   HTTP 500, body is literally `null` - it PARSES, so a status-only check
   *                  lets a falsy value through and `?? []` turns it into "no candles"
   *   bad interval   HTTP 422, body is PLAIN TEXT - `JSON.parse` THROWS
   * So the body is read as text, parsed inside a try, and handed to `parseHlCandles`, which
   * throws on `null`, on a string, and on an all-unusable set rather than returning `[]`. An
   * empty array would be cached as "this window has no candles", which is a legitimate answer
   * and not this one - the #228 lesson this route already applies to non-2xx.
   *
   * THE MULTIPLIER IS REFUSED, NOT DEFAULTED. `hlMultiplier` returns null for a name whose
   * factor is unverified. Passing that through as `undefined` would default to 1 inside
   * `parseHlCandles` - a price out by a factor of 1000, which is the exact incident this venue's
   * `k` prefix was measured to avoid. `SYMBOLS.hyperliquid` is built from the already-filtered
   * `HL_SYMS`, so this should be unreachable; it throws anyway, because "should be unreachable"
   * is the argument for a `!` and a `!` on a value that encodes a real state is how an
   * unreachable branch becomes a wrong number. */
  const fetchHlCandles = async () => {
    const ms = hlIntervalToMs(interval);
    if (ms == null) throw new Error(`hyperliquid: no ms for interval ${interval}`);

    const mult = hlMultiplier(symbol);
    if (mult == null) {
      throw new Error(
        `hyperliquid: refusing ${symbol} - its multiplier is unverified, so no price can be `
        + 'derived from it. This name should not be in HL_SYMS.',
      );
    }

    const endTime = end ? Number(end) : Date.now();
    const startTime = start ? Number(start) : endTime - (limit + 2) * ms;
    const r = await exchangeFetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hlCandleSnapshotBody(symbol, interval, startTime, endTime)),
      cache: 'no-store',
    });
    const text = await r.text();
    if (!r.ok) {
      const err = new Error(`hyperliquid klines ${r.status}: ${text.slice(0, 120)}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`hyperliquid returned non-JSON on a 200: ${text.slice(0, 120)}`);
    }
    /* Oldest-first is PRESERVED by the parser, deliberately - the opposite of the OKX and Bybit
       paths, which reverse. See parseHlCandles. */
    return hlCandlesToBareArray(parseHlCandles(body, { closedOnly, multiplier: mult }));
  };

  /* #1626 A: KEYED BY THE CANDLE, not timed from the read. This used `closedCandleTtl(..., Date.now())` as the TTL, and cached() compares an
     entry's age with the TTL of the request READING it - so a read just after a close asked "is this younger than the time to the NEXT close?",
     and an entry written before the close always was. Measured: the Arena ribbon EMAs and SL/TP read the pre-close 4h candles for the hour after
     05:00, and the daily payload was 16 h old. Now the key carries the open time of the current candle (closedCandleKey, CLOSE_SKEW_MS after the
     close it changes), so the first read after a close misses and fetches once (single-flight per key), and every read within the candle hits.
     The entry may live the whole candle (it cannot outlive its key); a period or the old stopwatch, whichever is longer. Still opt-in (closed=1)
     and still a distinct key from a live request. Upstream traffic: one call per key per candle, never more than the old floor allowed. */
  /* OKX'S BARS NEED THEIR OWN ms LOOKUP. `intervalToMs` matches `/^(\d+)(m|h|d)$/` plus bare
     minutes and a bare `D`, all LOWERCASE - so 8 of OKX's 13 bars return null from it, including
     `4H` and `1D`, the two the Arena EMA signal asks for. */
  /* EACH VENUE'S OWN ms LOOKUP, AND THIS LINE IS WHERE THE OKX CACHE COLLISION CAME FROM.
     `intervalToMs` is lowercase-only, so it returns null for 8 of OKX's 13 bars and for 2 of
     Hyperliquid's 14 (`1w`, `1M`) - measured, not assumed. A null here empties `closedTag` below,
     which let a `closed=1` request and a live one share one cache key once already. */
  const ivMs = closedOnly
    ? (source === 'okx' ? okxBarToMs(interval)
      : source === 'hyperliquid' ? hlIntervalToMs(interval)
      : intervalToMs(interval))
    : null;
  const ttl = ivMs != null ? Math.max(ivMs + CLOSE_SKEW_MS, ttlFor(interval)) : ttlFor(interval);
  /* THE TAG SEPARATES CLOSED FROM LIVE EVEN WHEN NO BOUNDARY CAN BE COMPUTED, and that `: ':closed'`
     is a security fix rather than tidying.
     It read `ivMs != null ? ... : ''`, so an interval with no computable boundary - W and M on every
     venue, and until the line above EVERY uppercase OKX bar - produced an EMPTY tag, which put a
     `closed=1` request and a live one on the SAME KEY. That was merely a stale-TTL question while
     both variants returned the same body. It stopped being one in the commit that added
     `includeForming: !closedOnly`: the two now differ by the forming bar, so whichever request
     populated the key first served its answer to the other kind of caller - a closed-candle reader
     getting a bar whose close keeps moving, which is the un-firing signal that `closed=1` exists to
     prevent. And `closed` is a query parameter any client sets, so which variant lands in the
     shared entry was the caller's choice, for everyone.
     Flagged by the automated security review of that commit. The W/M TTL fallback above is
     unchanged - this only separates the keys. */
  const closedTag = closedOnly
    ? (ivMs != null ? `:closed:${closedCandleKey(ivMs, Date.now())}` : ':closed')
    : '';

  try {
    const key = `klines:${source}:${symbol}:${interval}:${limit}${closedTag}`;
    const raw = isRange
      /* The range path gets the Hyperliquid fetcher too, unlike OKX's - `candleSnapshot` takes
         `startTime`/`endTime` natively, so a range is its NATURAL shape rather than a paged
         special case. `fetchUpstream` would build a URL this venue does not answer. */
      ? await cached(`klines:range:${source}:${symbol}:${interval}:${limit}:${start ?? ''}:${end ?? ''}`,
        rangeTtl(interval, end),
        source === 'hyperliquid' ? fetchHlCandles : fetchUpstream,
        { failTtlMs: KLINES_FAIL_TTL_MS })
      : await cached(
        key, ttl,
        source === 'okx' ? fetchOkxPaged : source === 'hyperliquid' ? fetchHlCandles : fetchUpstream,
        { failTtlMs: KLINES_FAIL_TTL_MS },
      );
    /* Slice AFTER the cache read, using the caller's own limit. The cache holds
       one bucket-sized copy that every caller in that bucket shares; each gets
       back the length it asked for. Range requests are returned untouched -
       the caller is paginating and set its own window. */
    const body = isRange ? raw : sliceToLimit(source, raw, limitRaw);

    reportHealth(`${source}:klines-proxy`, 'market', true, `${symbol} ${interval}`);
    return NextResponse.json(body, {
      headers: {
        /* Shared edge cache too, for the day one exists in front of this. It is
           inert on Render today (#198) and correct the moment it is not. */
        ...(isRange ? {} : { 'Cache-Control': polledCacheControl(ttlFor(interval) / 1000) }),
      },
    });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;

    /* #1077: try Bybit before giving up. Only for a Binance source with a
     * fixed limit (never a range request - PM/DevOps's rule: a paginated
     * backfill assembles many requests into one series client-side, and this
     * route has no memory of which exchange answered an earlier page of the
     * same walk, so failing over independently per page could hand back a
     * series that is part-Binance, part-Bybit with an invisible seam in it).
     * Only if this symbol+interval actually has a Bybit equivalent - #228's
     * rule still applies, so a coin/interval with no mapping fails loud here
     * exactly as it always has, rather than a failover that silently returns
     * nothing useful. */
    if (
      (source === 'binance' || source === 'binance-futures') &&
      canFailoverForRequest(isRange) &&
      shouldFailToBybit(status)
    ) {
      const coin = BN_SYM_TO_COIN[symbol];
      const bbInterval = bybitIntervalFor(interval);
      const bbSymbol = coin ? BYBIT_SYMS[coin] : undefined;
      if (coin && bbSymbol && bbInterval) {
        try {
          const fallbackKey = `klines:${source}:bybit-fallback:${symbol}:${interval}:${limit}${closedTag}`;
          const fallbackFetch = async () => {
            const fbUrl = new URL(UPSTREAM.bybit);
            fbUrl.searchParams.set('category', 'linear');
            fbUrl.searchParams.set('symbol', bbSymbol);
            fbUrl.searchParams.set('interval', bbInterval);
            fbUrl.searchParams.set('limit', String(limit));
            const r = await exchangeFetch(fbUrl, { cache: 'no-store' });
            if (!r.ok) {
              const err = new Error(`bybit fallback klines ${r.status}`);
              (err as Error & { status?: number }).status = r.status;
              throw err;
            }
            const body = await r.json();
            // #1249: an empty result.list is a fetch failure, not a success -
            // "no candles" must stay distinguishable from "refused" (#228's
            // rule, applied here too). Throwing here, before `cached()` ever
            // sees a resolved value, matters as much as the check itself:
            // cached() only skips caching a REJECTION (lib/apiCache.ts) - a
            // resolved-but-empty body would otherwise get memoized as if it
            // were a good answer and served to every caller sharing this key
            // for the rest of the TTL, long after Bybit itself would answer
            // correctly again. Confirmed live: the same symbol returned real
            // candles for one interval and an empty list for another,
            // moments apart, while a direct curl against Bybit's real API
            // for both exact queries returned data for both - the emptiness
            // was a one-off that got cached, not Bybit actually having no
            // candles for that interval.
            if (!Array.isArray(body?.result?.list) || body.result.list.length === 0) {
              const err = new Error('bybit fallback klines returned no candles');
              (err as Error & { status?: number }).status = 502;
              throw err;
            }
            return body;
          };
          // Same TTL policy and cache mechanics as the primary path, so
          // every caller sharing this bucket during a sustained Binance
          // outage collapses onto one Bybit fetch rather than each one
          // hammering Bybit the same way the outage started with Binance.
          // The key keeps closed and live apart, like the main key, but the
          // TTL stays ttlFor and not the closed `ttl`. cached() checks an
          // entry's age against the TTL of the request READING it, and the
          // closed TTL is "time to the next close" from now - so just after
          // a close it is ~one whole interval again and an entry written
          // before the close is still served (measured on a 4h main closed
          // entry: written 03:50, served at 04:00, 04:30 and 05:00, refetched
          // at 05:56). ttlFor bounds a stand-in's age at 15 minutes.
          // Same failure hold too (#1404): an empty list is a rejection
          // (above), so it is held as a failure for KLINES_FAIL_TTL_MS and
          // then retried - never stored as candles.
          const rawFallback = await cached(fallbackKey, ttlFor(interval), fallbackFetch,
            { failTtlMs: KLINES_FAIL_TTL_MS });
          const converted = bybitKlinesToBinanceShape(rawFallback, bybitPriceFactor(coin), limitRaw);
          if (converted) {
            reportHealth(`${source}:klines-proxy`, 'market', true, `bybit-fallback ${symbol} ${interval}`);
            return NextResponse.json(converted, {
              headers: {
                // #1077: the only way a caller (or QA) can tell this answer
                // came from the fallback rather than Binance itself - a
                // header rather than a body-shape change, since every caller
                // parses the body positionally and must not have to branch
                // on where it came from to do that.
                'X-Data-Source': 'bybit-fallback',
              },
            });
          }
        } catch { /* Bybit fallback also failed - fall through to the original error below */ }
      }
    }

    reportHealth(`${source}:klines-proxy`, 'market', false, status ? `upstream ${status}` : String(e));
    /* 502 with the upstream status attached: "refused" must be distinguishable
       from "no candles", which is the whole of #228. */
    return apiError('market-klines', e, 502, status === 418 || status === 429
      ? `${source} is rate-limiting this server (${status})`
      : 'Upstream unavailable');
  }
}
