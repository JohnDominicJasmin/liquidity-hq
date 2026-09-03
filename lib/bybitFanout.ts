/* Fan out one Bybit per-symbol endpoint across every tracked coin, once (#200).
 *
 * Bybit's account-ratio and open-interest endpoints take ONE symbol per request
 * and have no batch parameter. The client currently loops over ~50 symbols, so
 * every visitor issues ~50 requests for data that is identical for all of them -
 * 393 and 392 calls respectively in QA's measurement, together 60% of what is
 * left after batch 1.
 *
 * A per-symbol proxy route would have moved that loop onto our server without
 * collapsing it: still 50 upstream calls per visitor, just from one IP instead
 * of thousands. Worse, not better - that IP is the one Binance already banned
 * once (#228).
 *
 * So the fan-out happens HERE, behind one cache entry per (endpoint, params).
 * The first visitor in a TTL window pays 50 upstream calls; everyone else pays
 * zero. #201's single-flight means a burst at expiry produces one fan-out rather
 * than one per concurrent visitor, which is the difference between a cache and a
 * thundering herd.
 *
 * The browser side goes from ~50 requests to 1.
 */
import { cached } from './apiCache';
import { BYBIT_SYMS } from './coins';
import { runPool, DEFAULT_CONCURRENCY, HttpStatusError, isRateLimitStatus } from './pool';

/** Every symbol this app tracks on Bybit. A closed set, which is what keeps the
 *  cache key space finite - see the note in app/api/market/klines/route.ts. */
const SYMBOLS = Object.values(BYBIT_SYMS);

export interface FanoutResult {
  /** symbol -> whatever the caller's `pick` returned. Missing symbols are absent
   *  rather than null: a caller can then tell "we did not get it" from "it is
   *  legitimately zero". */
  data: Record<string, unknown>;
  /** How many symbols came back. Exposed so the route can report health and so a
   *  probe can tell a partial fan-out from a complete one - the #228 lesson: an
   *  empty result must never look like a successful one. */
  ok: number;
  total: number;
  /** True when the run was cut short by a rate-limit stop (418/429/403) rather
   *  than by individual symbols failing (#665, QA's review of #667).
   *
   *  Without this, `ok: 12, total: 49` is ambiguous: it reads identically for
   *  "we were banned on the 13th request and stopped deliberately" and "37
   *  symbols each failed on their own". Those call for opposite responses -
   *  back off for the TTL, versus look at why the upstream is patchy.
   *
   *  Same reason /api/market/snapshot reports `banned` separately from a short
   *  map, and the same reason `partial` exists on its response at all. */
  stopped: boolean;
}

/**
 * @param key      cache key, must encode every parameter that changes the result
 * @param ttlMs    how long one fan-out serves
 * @param buildUrl given a symbol, the upstream URL to call
 * @param pick     extract the bit worth keeping from one symbol's response
 *
 * One symbol failing must not lose the other 49 - the same reasoning as
 * /api/market/snapshot's three-way split, and the same trap, so the caller is
 * told how many succeeded rather than being handed a quietly short map.
 *
 * This said "`allSettled`, not `all`" until #665. The tolerance it describes is
 * unchanged; runPool swallows an ordinary per-item failure exactly as
 * `allSettled` did. What changed is that the requests are now BOUNDED - the old
 * shape opened all ~45 at once, which is what produced the missing symbols this
 * text promised the caller would be told about.
 */
export async function bybitFanout(
  key: string,
  ttlMs: number,
  buildUrl: (symbol: string) => string,
  pick: (body: unknown) => unknown,
): Promise<FanoutResult> {
  return symbolFanout(SYMBOLS, key, ttlMs, buildUrl, pick);
}

/**
 * The same collapse for any closed symbol list, not just Bybit's.
 *
 * Added for the Binance sweeps in #200 batch 3 - `aggTrades` (360 calls) and
 * `fundingRate` (45). Both are the identical shape: one request per symbol over
 * the app's own coin list, with no batch parameter upstream.
 *
 * `symbols` must be a CLOSED set for the same reason the Bybit version uses one:
 * the cache key is per (endpoint, params), and the fan-out width is the symbol
 * count, so free-text symbols would be both a key leak and an egress amplifier.
 */
export async function symbolFanout(
  symbols: string[],
  key: string,
  ttlMs: number,
  buildUrl: (symbol: string) => string,
  pick: (body: unknown) => unknown,
): Promise<FanoutResult> {
  return cached(key, ttlMs, async () => {
    /* Bounded, not `symbols.map` inside allSettled (#665).
     *
     * That fired every symbol simultaneously - ~45 requests from one server IP
     * in one burst, at hosts that rate-limit per IP. Losers threw and landed
     * ABSENT from `data`, which the pages render as a blank cell, so the
     * symptom was an arbitrary few symbols missing and a DIFFERENT few on the
     * next run. A mapping bug or an upstream gap would have blanked the same
     * ones every time; that non-determinism is what identified this.
     *
     * `allSettled` was never the problem and the reasoning in the doc comment
     * above still holds - one symbol failing must not lose the other 49. The
     * defect was the WIDTH of the burst. runPool keeps that tolerance and adds
     * the bound,
     * plus the 418/429/403 stop that the two hand-rolled pools in
     * snapshot/route.ts and rsi/route.ts already had and this path did not.
     *
     * Two of the four callers point at Binance - funding-rate at fapi and
     * agg-trades at api.binance.com on a 60s TTL - which is the host that
     * already banned this IP once (#228). */
    const data: Record<string, unknown> = {};

    const stopped = await runPool(symbols, DEFAULT_CONCURRENCY, async (sym) => {
      const r = await fetch(buildUrl(sym), { cache: 'no-store' });
      if (!r.ok) throw new HttpStatusError(r.status, `${sym} ${r.status}`);
      const v = pick(await r.json());
      if (v != null) data[sym] = v;
    }, isRateLimitStatus);

    /* Throwing on a total wipeout rather than caching an empty map. `cached()`
       does not store a rejection, so a refused upstream is retried by the next
       caller instead of being pinned for the TTL - and the route turns this into
       a non-2xx rather than an empty success. */
    if (Object.keys(data).length === 0) {
      throw new Error(`fan-out returned nothing for all ${symbols.length} symbols`);
    }

    return { data, ok: Object.keys(data).length, total: symbols.length, stopped };
  });
}
