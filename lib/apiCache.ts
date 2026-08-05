// Shared in-memory response cache for API routes that fetch third-party data
// (exchange APIs, macro feeds, or paid Grok calls) that's the same for every
// visitor within a short window. Module-level Map survives across requests on
// the same server instance - same pattern used by app/api/econ-calendar.
// Not a distributed cache: fine for a small number of long-lived instances,
// not meant for edge/multi-region deployments.

const store = new Map<string, { ts: number; data: unknown }>();

// Returns the cached value for `key` if it's younger than `ttlMs`, otherwise
// calls `fetcher()`, caches the result, and returns it. Only successful
// results are cached - a throwing fetcher leaves the previous entry (or none)
// in place so a single upstream failure can't poison the cache.
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data as T;
  const data = await fetcher();
  store.set(key, { ts: Date.now(), data });
  return data;
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
    const data = await fetcher();
    store.set(key, { ts: Date.now(), data });
    return { data, stale: false, ageMs: 0 };
  } catch (e) {
    /* Deliberately does NOT refresh the timestamp. Every subsequent request
       retries the upstream rather than settling into serving stale data
       forever, so recovery is automatic once the rate limit resets. */
    if (hit) return { data: hit.data, stale: true, ageMs: age };
    throw e;   // nothing cached yet - the caller has to handle a real failure
  }
}
