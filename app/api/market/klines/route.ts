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
 * ── AND IT FAILS LOUDLY ─────────────────────────────────────────────────────
 *
 * #228 was an empty `{}` returned with HTTP 200 for hours while the health table
 * recorded the ban. Nothing here returns an empty success: an upstream refusal
 * produces a non-2xx with the upstream's own status attached, so a caller and a
 * probe can both tell "no candles" from "refused".
 */
import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/apiCache';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';

type Source = 'bybit' | 'binance' | 'binance-futures';

/* Closed sets, and that is a memory decision as much as a validation one.
 *
 * `cached()` holds a module-level Map that never evicts, so the cache key space
 * has to be finite or this route is a slow leak. QA flagged exactly this on
 * #199: "if any key includes a user id, a timestamp, or free text, it is a
 * leak". Symbols come from the app's own coin list, intervals are an allowlist,
 * and limit is snapped to a bucket - so the worst case is
 * sources x symbols x intervals x buckets, which is bounded and small. */
const SYMBOLS: Record<Source, Set<string>> = {
  bybit:             new Set(Object.values(BYBIT_SYMS)),
  binance:           new Set(Object.values(BINANCE_SYMS)),
  'binance-futures': new Set(Object.values(BINANCE_SYMS)),
};

/* Bybit takes minutes as integers plus D/W/M; Binance takes suffixed strings.
   Deliberately not translated between them - each caller already knows which
   dialect it wants, and silently rewriting an interval is how a chart ends up
   showing a timeframe nobody asked for. */
const INTERVALS: Record<Source, Set<string>> = {
  bybit:             new Set(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M']),
  binance:           new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']),
  'binance-futures': new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']),
};

const UPSTREAM: Record<Source, string> = {
  bybit:             'https://api.bybit.com/v5/market/kline',
  binance:           'https://api.binance.com/api/v3/klines',
  'binance-futures': 'https://fapi.binance.com/fapi/v1/klines',
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
  const symbol = (q.get('symbol') ?? '').toUpperCase();
  const interval = q.get('interval') ?? '';
  const limitRaw = Number(q.get('limit') ?? '200');
  const start = q.get('start');
  const end = q.get('end');

  if (!UPSTREAM[source]) {
    return NextResponse.json({ error: `unknown source '${source}'` }, { status: 400 });
  }
  if (!SYMBOLS[source].has(symbol)) {
    return NextResponse.json({ error: `symbol '${symbol}' is not one this app tracks` }, { status: 400 });
  }
  if (!INTERVALS[source].has(interval)) {
    return NextResponse.json({ error: `interval '${interval}' is not valid for ${source}` }, { status: 400 });
  }
  if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 1500) {
    return NextResponse.json({ error: 'limit must be between 1 and 1500' }, { status: 400 });
  }

  const limit = bucketFor(limitRaw);

  /* RANGE REQUESTS ARE NOT CACHED, on purpose.
   *
   * Two callers paginate with start/end cursors. Those are timestamps, so
   * including them in the key makes the key space unbounded - the leak #199
   * warns about. They are also one-shot by nature: a backfill walks each window
   * exactly once, so a cache entry would never be read again anyway.
   *
   * Passing them through means those two keep their current upstream cost. That
   * is honest rather than ideal, and it is called out in the PR rather than
   * quietly counted as a win. */
  const isRange = Boolean(start || end);

  const url = new URL(UPSTREAM[source]);
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

  const fetchUpstream = async () => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      /* Throwing rather than returning an empty body is the #228 lesson applied
         at the point it was learned: `cached()` does not store a rejection, so a
         ban is retried rather than pinned, and the caller gets a status instead
         of a plausible-looking empty array. */
      const err = new Error(`${source} klines ${r.status}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    return r.json();
  };

  try {
    const key = `klines:${source}:${symbol}:${interval}:${limit}`;
    const raw = isRange ? await fetchUpstream() : await cached(key, ttlFor(interval), fetchUpstream);
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
        ...(isRange ? {} : { 'Cache-Control': `public, s-maxage=${Math.floor(ttlFor(interval) / 1000)}, stale-while-revalidate=600` }),
      },
    });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    reportHealth(`${source}:klines-proxy`, 'market', false, status ? `upstream ${status}` : String(e));
    /* 502 with the upstream status attached: "refused" must be distinguishable
       from "no candles", which is the whole of #228. */
    return apiError('market-klines', e, 502, status === 418 || status === 429
      ? `${source} is rate-limiting this server (${status})`
      : 'Upstream unavailable');
  }
}
