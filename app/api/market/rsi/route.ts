/**
 * Server-side RSI aggregation for the whole coin list.
 *
 * GET /api/market/rsi
 *   → { rsi: { btc: { rsi5m, rsi1h, rsi4h, rsiDaily, rsiWeekly, rsiMonthly }, ... }, ts }
 *
 * WHY THIS EXISTS
 *
 * MarketProvider used to compute these six numbers in the browser, one kline
 * request per coin per timeframe. At 45 Binance coins plus HYPE that is 276
 * requests fired from the visitor's own IP on every page load, out of ~495
 * Binance requests total. Every visitor repeated all 276, and every one of
 * them returned data that is identical for every visitor - a 1-week RSI does
 * not differ per user.
 *
 * That burst is the suspected cause of the intermittent blank chart: enough
 * concurrent requests to trip Binance's per-IP limit, after which unrelated
 * kline calls start coming back 429 and the chart renders empty. It is worst
 * on shared egress IPs (mobile CGNAT, office NAT, VPNs) and on anyone with
 * two tabs open, where the same limit is being spent several times over.
 *
 * Moving it here makes the upstream cost fixed instead of per-visitor: the
 * server fetches each timeframe group once per TTL and every visitor is served
 * from that one result. Ten concurrent visitors cost the same upstream as one.
 *
 * TWO CACHE GROUPS, NOT ONE
 *
 * The client used to poll 5m RSI every 3 minutes and everything slower every
 * 15. Collapsing that into a single cache would either make 5m RSI stale or
 * re-fetch 230 weekly/monthly candles every 3 minutes for no benefit. So the
 * groups are cached separately with their original cadences and merged into
 * one response - the client can poll at the fast cadence and the slow group
 * simply serves a warm cache most of the time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached } from '@/lib/apiCache';
import { runPool, HttpStatusError, isRateLimitStatus } from '@/lib/pool';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { computeRSI14 } from '@/lib/rsi';

export const dynamic = 'force-dynamic';

/* Match the client cadences these replaced: fetch5mRSI ran every 3 min, the
   1h/4h/1d/1w/1M pollers every 15. */
const FAST_TTL = 3  * 60_000;
const SLOW_TTL = 15 * 60_000;

/* Binance rejects unlimited parallelism from a single IP with 418/429, and 276
   simultaneous sockets is also more than the Render instance should hold open.
   12 keeps a cold fill at roughly 275/12 x ~150ms, a few seconds, which only
   one visitor per TTL window ever pays. */
const CONCURRENCY = 12;

/* Same mirror-walk as app/api/funding: api.binance.com resolves to different
   edges by region and individual ones return 451/503 while the others are
   healthy. Resolved once per cache fill, not per request.
 *
 * Spot first because that is what the client used, so the numbers this route
 * returns are identical to the ones it replaced. The futures host is a last
 * resort, not a preference: only fapi.binance.com is *proven* reachable from
 * Render (app/api/funding and lib/ribbonCandles both call it in production),
 * while nothing server-side has ever called spot from there. If spot turns out
 * to be blocked, falling back to perp candles gives RSI that can differ by a
 * point on a rounded 0-100 scale - worth having, but worth knowing about,
 * which is why the health record names the source that was used.
 *
 * The whole group uses one endpoint, so a fallback never mixes spot and perp
 * candles across coins within a single response. */
const BN_ENDPOINTS = [
  { base: 'https://api.binance.com',  klines: '/api/v3/klines',   ping: '/api/v3/ping',   label: 'spot'    },
  { base: 'https://api1.binance.com', klines: '/api/v3/klines',   ping: '/api/v3/ping',   label: 'spot'    },
  { base: 'https://api2.binance.com', klines: '/api/v3/klines',   ping: '/api/v3/ping',   label: 'spot'    },
  { base: 'https://api3.binance.com', klines: '/api/v3/klines',   ping: '/api/v3/ping',   label: 'spot'    },
  { base: 'https://fapi.binance.com', klines: '/fapi/v1/klines',  ping: '/fapi/v1/ping',  label: 'futures' },
] as const;

type Endpoint = (typeof BN_ENDPOINTS)[number];

/* Binance interval string → the MarketStore field it populates. Limits are the
   ones the client used. computeRSI14 only ever reads the last 14 changes, so
   16 vs 20 candles produces the same number - they are kept as they were so
   this route is a pure move, not a re-tune. */
const BN_TIMEFRAMES = [
  { interval: '5m', limit: 16, field: 'rsi5m'      },
  { interval: '1h', limit: 16, field: 'rsi1h'      },
  { interval: '4h', limit: 16, field: 'rsi4h'      },
  { interval: '1d', limit: 20, field: 'rsiDaily'   },
  { interval: '1w', limit: 20, field: 'rsiWeekly'  },
  { interval: '1M', limit: 20, field: 'rsiMonthly' },
] as const;

/* HYPE has no Binance perp, so its six values come from Bybit, whose interval
   codes are minutes-as-numbers plus D/W/M. Bybit returns newest-first. */
const BB_TIMEFRAMES = [
  { interval: '5',   limit: 16, field: 'rsi5m'      },
  { interval: '60',  limit: 16, field: 'rsi1h'      },
  { interval: '240', limit: 16, field: 'rsi4h'      },
  { interval: 'D',   limit: 20, field: 'rsiDaily'   },
  { interval: 'W',   limit: 20, field: 'rsiWeekly'  },
  { interval: 'M',   limit: 20, field: 'rsiMonthly' },
] as const;

type RsiField = (typeof BN_TIMEFRAMES)[number]['field'];
type RsiMap   = Record<string, Partial<Record<RsiField, number>>>;

/* #1235: BB_TIMEFRAMES above was hype-only (its own dedicated jobs, always
 * Bybit, unconditionally). This is the same table indexed by field so a
 * Binance-listed coin's FAILOVER jobs can look up the matching Bybit
 * interval+limit for whatever field its Binance job didn't answer for -
 * reusing the table rather than a second copy of it. */
const BB_TIMEFRAME_FOR: Record<RsiField, { interval: string; limit: number }> =
  Object.fromEntries(BB_TIMEFRAMES.map(tf => [tf.field, { interval: tf.interval, limit: tf.limit }])) as
    Record<RsiField, { interval: string; limit: number }>;

/* The fast group is 5m alone; the slow group is everything else. Splitting on
   the field keeps the two lists in sync with BN_TIMEFRAMES automatically. */
const FAST_FIELDS = new Set<RsiField>(['rsi5m']);

interface Job { coin: string; field: RsiField; url: (ep: Endpoint) => string; bybit: boolean }

function buildJobs(fast: boolean): Job[] {
  const wanted = (f: RsiField) => FAST_FIELDS.has(f) === fast;
  const jobs: Job[] = [];

  for (const [coin, sym] of Object.entries(BINANCE_SYMS)) {
    for (const tf of BN_TIMEFRAMES) {
      if (!wanted(tf.field)) continue;
      jobs.push({
        coin, field: tf.field, bybit: false,
        url: ep => `${ep.base}${ep.klines}?symbol=${sym}&interval=${tf.interval}&limit=${tf.limit}`,
      });
    }
  }

  const hypeSym = BYBIT_SYMS.hype;
  if (hypeSym) {
    for (const tf of BB_TIMEFRAMES) {
      if (!wanted(tf.field)) continue;
      jobs.push({
        coin: 'hype', field: tf.field, bybit: true,
        url: () => `https://api.bybit.com/v5/market/kline?category=linear&symbol=${hypeSym}&interval=${tf.interval}&limit=${tf.limit}`,
      });
    }
  }

  return jobs;
}

/* 418 (IP banned) or 429 (rate limited) - neither is about the symbol asked
   for, so both stop the pool rather than skipping one job.

   This was a local error class until #665, and snapshot/route.ts defined an
   identical one. Two copies of the same stop condition, each hard-coded into
   its own pool, is what kept either pool from being shared - and the four
   routes on lib/bybitFanout.ts got no pool at all as a result.

   Deliberately NOT lib/pool.ts's isRateLimitStatus, which also treats 403 as
   fatal on Bybit's behalf. Binance does not rate-limit with 403, so adopting it
   here would convert an ordinary per-symbol miss into a whole-batch abort. */
const isBinanceBackoff = (e: unknown): boolean =>
  e instanceof HttpStatusError && (e.status === 418 || e.status === 429);

/* Closes, newest last, from whichever exchange shape came back. Returns null
   rather than throwing so one dead symbol cannot take down the batch - the
   coin simply keeps whatever value the client already had. The one exception
   is 418/429, which is not about this symbol at all. */
async function fetchCloses(job: Job, ep: Endpoint): Promise<number[] | null> {
  const ac  = new AbortController();
  const tid = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(job.url(ep), {
      cache: 'no-store',
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    /* 429 is the warning, 418 is the ban that follows it. Both mean every
       remaining request in this batch would be spent making it worse, and a
       ban is measured in minutes to days. Distinguish from an ordinary miss
       so runPool can stop rather than continue. */
    if (res.status === 418 || res.status === 429) {
      throw new HttpStatusError(res.status, `Binance ${res.status}`);
    }
    if (!res.ok) return null;
    const body = await res.json();

    if (job.bybit) {
      const list = body?.result?.list;
      if (!Array.isArray(list)) return null;
      return [...list].reverse().map((k: string[]) => parseFloat(k[4]));
    }
    if (!Array.isArray(body)) return null;
    return body.map((k: string[]) => parseFloat(k[4]));
  } catch (e) {
    if (e instanceof HttpStatusError) throw e;
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/* Fixed-size worker pool. Promise.all over 276 fetches would open them all at
   once, which is exactly the burst this route exists to stop doing.
 *
 * Aborts the whole batch the moment Binance returns 418/429. This matters more
 * here than it did client-side: one banned visitor lost their own RSI, but one
 * banned Render IP loses it for everyone at once. Spending the remaining 200
 * requests into an active ban only extends it, so the pool stops and the
 * partial result is cached - backing off for the TTL is the correct response
 * to a ban, not something to retry around. */
async function runRsiPool(
  jobs: Job[], ep: Endpoint, out: RsiMap,
): Promise<{ ok: number; banned: boolean }> {
  let ok = 0;

  const banned = await runPool(jobs, CONCURRENCY, async (job) => {
    const closes = await fetchCloses(job, ep);
    /* Same guard the client applied: fewer than 15 closes cannot produce a
       14-period RSI, and a partially-listed coin returns a short array rather
       than an error. */
    if (!closes || closes.length < 15) return;
    const rsi = computeRSI14(closes);
    if (rsi === null) return;
    (out[job.coin] ??= {})[job.field] = rsi;
    ok++;
  }, isBinanceBackoff);

  return { ok, banned };
}

/* Pick a Binance edge that is actually answering before spending the pool on
   it. One weight-1 probe beats discovering the host is 451 on all 276 requests.
 *
 * Returns null when no host answers, which is the state an active IP ban
 * produces - every edge returns 418 because the ban is on us, not on them. The
 * caller drops the Binance jobs entirely in that case rather than spending a
 * pool's worth of requests re-learning it. */
async function resolveEndpoint(): Promise<Endpoint | null> {
  for (const ep of BN_ENDPOINTS) {
    try {
      const ac  = new AbortController();
      const tid = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(`${ep.base}${ep.ping}`, {
        cache: 'no-store', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      clearTimeout(tid);
      if (res.ok) return ep;
    } catch { continue; }
  }
  return null;
}

/* #1235 (#1077 split): whatever a Binance-listed coin didn't get from the
 * primary pass - `ep` unreachable/banned entirely, or one job individually
 * missing - gets a Bybit retry for that exact (coin, field). Same "missing
 * is missing, regardless of why" reasoning as #1233's symbolFanout fallback:
 * a ban stopping the PRIMARY pool early must not turn into every remaining
 * (coin, field) trying the banned host again before falling back, so this
 * runs as its own bounded pool over only what's still missing, using
 * Bybit's own stop condition (`isRateLimitStatus`, which also treats 403 as
 * fatal for Bybit - deliberately NOT `isBinanceBackoff`, which is correct
 * for Binance's own 418/429 but would never fire on a Bybit 403). hype is
 * excluded - it already has no Binance path, and its own jobs above are
 * unconditionally Bybit already, untouched by `ep` or this pass.
 *
 * NO PRICE FACTOR: RSI is scale-invariant. computeRSI14 derives its value
 * from the RATIO of average gains to average losses across the closes it is
 * given - multiplying every close by the same positive constant (exactly
 * what a price-factor conversion would do) changes every gain and loss by
 * that same factor and cancels out of the ratio, leaving RSI identical. So
 * `bybitPriceFactor()` has nothing to correct here even in principle, unlike
 * #1233/#1234 where an actual price or rate crosses into the response body.
 * (Moot in practice too, same as those two: no coin reachable via
 * BINANCE_SYMS has a 1000x BYBIT_SYMS entry.) */
async function fallbackMissing(
  out: RsiMap, fast: boolean,
): Promise<string[]> {
  const wanted = (f: RsiField) => FAST_FIELDS.has(f) === fast;
  const missing: Job[] = [];

  for (const coin of Object.keys(BINANCE_SYMS)) {
    const bbSym = BYBIT_SYMS[coin];
    if (!bbSym) continue; // fet - no Bybit linear perp (lib/coins.ts)
    for (const tf of BN_TIMEFRAMES) {
      if (!wanted(tf.field)) continue;
      if (out[coin]?.[tf.field] != null) continue;
      const bbTf = BB_TIMEFRAME_FOR[tf.field];
      missing.push({
        coin, field: tf.field, bybit: true,
        url: () => `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bbSym}&interval=${bbTf.interval}&limit=${bbTf.limit}`,
      });
    }
  }
  if (missing.length === 0) return [];

  const viaFallback = new Set<string>();
  await runPool(missing, CONCURRENCY, async (job) => {
    // `ep` is irrelevant to a bybit job - fetchCloses's url closure ignores
    // it, same as hype's existing jobs already do above.
    const closes = await fetchCloses(job, BN_ENDPOINTS[0]);
    if (!closes || closes.length < 15) return;
    const rsi = computeRSI14(closes);
    if (rsi === null) return;
    (out[job.coin] ??= {})[job.field] = rsi;
    viaFallback.add(job.coin);
  }, isRateLimitStatus);

  return [...viaFallback];
}

async function buildGroup(fast: boolean): Promise<{ out: RsiMap; viaFallback: string[] }> {
  const out: RsiMap = {};
  const ep = await resolveEndpoint();

  /* No reachable Binance edge: run the Bybit jobs anyway so HYPE still gets
     its RSI, and skip the 45 Binance symbols rather than firing them into a
     wall. */
  const allJobs = buildJobs(fast);
  const jobs = ep ? allJobs : allJobs.filter(j => j.bybit);

  const { ok, banned } = await runRsiPool(jobs, ep ?? BN_ENDPOINTS[0], out);
  const viaFallback = await fallbackMissing(out, fast);

  /* Reported per group so a partial outage is visible: the slow group failing
     while the fast one succeeds means Binance is rate-limiting the heavier
     weekly/monthly calls, which is a different problem from the host being
     unreachable. Separate source name from binance:funding for the same
     reason that route separates its own.
   *
     A ban is called out explicitly because it is the one failure that needs a
     human: it means this server's IP is spending more Binance weight than the
     limit allows, and nothing here recovers from that by itself. */
  reportHealth(
    `binance:rsi-${fast ? 'fast' : 'slow'}`, 'market',
    ok > 0 && !banned && ep !== null,
    (!ep      ? `no reachable Binance endpoint - ${ok} Bybit-only series`
    : banned ? `418/429 on ${ep.label} after ${ok}/${allJobs.length} series - batch aborted`
             : `${ok}/${allJobs.length} series via ${ep.label}`)
      + (viaFallback.length ? `, ${viaFallback.length} coins via bybit-fallback` : ''),
    ok,
  );

  return { out, viaFallback };
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`market-rsi:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    /* allSettled, not all: a failing slow group must still let the fast group
       through. The client merges whatever arrives and leaves the rest at its
       previous value, which is the same degradation the per-coin fetches had
       when an individual symbol 429'd. */
    const [fastRes, slowRes] = await Promise.allSettled([
      cached('market-rsi:fast', FAST_TTL, () => buildGroup(true)),
      cached('market-rsi:slow', SLOW_TTL, () => buildGroup(false)),
    ]);

    if (fastRes.status === 'rejected' && slowRes.status === 'rejected') {
      reportHealth('binance:rsi', 'market', false, healthError(fastRes.reason));
      return apiError('market-rsi', fastRes.reason, 502, 'Upstream unavailable');
    }

    const rsi: RsiMap = {};
    const viaFallback = new Set<string>();
    for (const res of [slowRes, fastRes]) {
      if (res.status !== 'fulfilled') continue;
      for (const [coin, fields] of Object.entries(res.value.out)) {
        Object.assign(rsi[coin] ??= {}, fields);
      }
      for (const coin of res.value.viaFallback) viaFallback.add(coin);
    }

    /* #1235: which coins had at least one field served from Bybit rather
       than Binance this response - additive, omitted when empty so an
       all-Binance response's shape is unchanged, same convention #1233's
       agg-trades and #1234's funding-rate use. Per-coin rather than
       per-(coin,field): the six RSI fields for one coin already merge into
       one object above, and a caller wanting exchange provenance at that
       granularity would need a shape change beyond what #1235 asks for. */
    return NextResponse.json({
      rsi,
      ...(viaFallback.size ? { viaFallback: [...viaFallback] } : {}),
      ts: Date.now(),
    }, {
      /* Public, visitor-independent, and already only as fresh as FAST_TTL.
         Letting any shared cache in front of this serve it costs nothing and
         removes the origin hit entirely for the common case. */
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    });
  } catch (err) {
    return apiError('market-rsi', err, 500, 'Request failed');
  }
}
