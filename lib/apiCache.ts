// Shared in-memory response cache for API routes that fetch third-party data
// (exchange APIs, macro feeds, or paid Grok calls) that's the same for every
// visitor within a short window. Module-level Map survives across requests on
// the same server instance - same pattern used by app/api/econ-calendar.
// Not a distributed cache: fine for a small number of long-lived instances,
// not meant for edge/multi-region deployments.

const store = new Map<string, { ts: number; data: unknown }>();

/* IN-FLIGHT REQUESTS, so N concurrent callers produce ONE upstream call (#199).
 *
 * Without this, a TTL cache still stampedes. Checking the store and then
 * awaiting the fetcher is not atomic, so every caller that arrives while the
 * first fetch is in the air sees a miss and starts its own. Measured against
 * the previous implementation:
 *
 *   cached()      20 concurrent cold callers -> 20 upstream calls
 *   cachedStale() 20 concurrent cold callers -> 20 upstream calls
 *   cached()      20 concurrent AT EXPIRY    -> 21 upstream calls
 *
 * Expiry is the worst moment for this: the cache exists because traffic is
 * concentrated, and it dumps that entire concentration on the upstream once per
 * TTL. For /api/funding at a 20s TTL that is three stampedes a minute at
 * Binance, from a cache whose stated purpose is to prevent exactly that.
 *
 * The map is keyed identically to `store` and cleared in a `finally`, so a
 * rejected fetcher does not wedge the key - the next caller retries rather than
 * awaiting a promise that has already failed.
 */
const inflight = new Map<string, Promise<unknown>>();

// Returns the cached value for `key` if it's younger than `ttlMs`, otherwise
// calls `fetcher()`, caches the result, and returns it. Only successful
// results are cached - a throwing fetcher leaves the previous entry (or none)
// in place so a single upstream failure can't poison the cache.
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data as T;

  /* Note the key namespace: `cached` and `cachedStale` share `store`, so they
     share `inflight` too. That is correct - two callers asking for the same key
     want the same upstream call regardless of which helper they used. */
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = (async () => {
    const data = await fetcher();
    store.set(key, { ts: Date.now(), data });
    return data;
  })().finally(() => { inflight.delete(key); });

  inflight.set(key, p);
  return p;
}

/* Same as `cached`, but keeps serving the last good value when the fetcher
 * fails instead of propagating the error.
 *
 * `cached` leaves a stale entry in place on failure but will not hand it back,
 * so a caller gets an exception and typically turns it into a 5xx. For data
 * that barely moves, that is the wrong trade: an all-time high from six hours
 * ago is correct to several decimal places, while a 502 is a hole on the page.
 *
 * Written for /api/ath, which asks CoinGecko's keyless public API for
 * all-time highs. That endpoint rate-limits per IP, and adding a third
 * environment was enough to start tripping it: the qa service returned
 * `{"error":"CoinGecko 429"}` on every attempt while production, on a
 * different instance, was fine. Nothing was wrong with the code - the IP had
 * simply spent its budget, and each failed request re-asked immediately
 * because a 429 is never cached.
 *
 * Only use this where stale is genuinely better than absent. Prices, balances
 * and anything a user acts on directly should fail loudly instead.
 */
export async function cachedStale<T>(
  key: string, ttlMs: number, fetcher: () => Promise<T>,
): Promise<{ data: T; stale: boolean; ageMs: number }> {
  const hit = store.get(key) as { ts: number; data: T } | undefined;
  const age = hit ? Date.now() - hit.ts : Infinity;
  if (hit && age < ttlMs) return { data: hit.data, stale: false, ageMs: age };

  try {
    /* Same single-flight as `cached`, and deliberately the SAME map. The
       in-flight promise always resolves to the raw fetcher value rather than
       this function's `{ data, stale, ageMs }` wrapper, so either helper can
       await a promise the other one started. Wrapping happens per caller,
       after the shared await, because `stale` and `ageMs` are properties of
       the CALLER's moment, not of the upstream request. */
    const existing = inflight.get(key) as Promise<T> | undefined;
    const data = existing ? await existing : await (() => {
      const p = (async () => {
        const d = await fetcher();
        store.set(key, { ts: Date.now(), data: d });
        return d;
      })().finally(() => { inflight.delete(key); });
      inflight.set(key, p);
      return p;
    })();
    return { data, stale: false, ageMs: 0 };
  } catch (e) {
    /* Deliberately does NOT refresh the timestamp. Every subsequent request
       retries the upstream rather than settling into serving stale data
       forever, so recovery is automatic once the rate limit resets. */
    if (hit) return { data: hit.data, stale: true, ageMs: age };
    throw e;   // nothing cached yet - the caller has to handle a real failure
  }
}
