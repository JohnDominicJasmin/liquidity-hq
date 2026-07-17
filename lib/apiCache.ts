// Shared in-memory response cache for API routes that fetch third-party data
// (exchange APIs, macro feeds, or paid Grok calls) that's the same for every
// visitor within a short window. Module-level Map survives across requests on
// the same server instance - same pattern already used in app/api/news-rss.
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
