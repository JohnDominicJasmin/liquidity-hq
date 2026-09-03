/* Fixed-size worker pool, shared (#665).
 *
 * This existed TWICE before this file did - app/api/market/snapshot/route.ts
 * and app/api/market/rsi/route.ts each define their own worker pool AND their
 * own `class BinanceBackoff`, each with a comment explaining why the pool is
 * necessary. It was copied rather than extracted, and copying is exactly what
 * stopped it travelling: four routes going through lib/bybitFanout.ts fanned
 * out with `symbols.map` inside `Promise.allSettled` - every symbol at once,
 * no pool, no backoff - at hosts that rate-limit per IP.
 *
 * A second copy proves the idea was understood twice and still did not reach
 * the callers that needed it. So this is the extraction, not a third copy.
 *
 * The stop condition is a PREDICATE rather than an exception class, because
 * the two existing copies both hard-code `instanceof BinanceBackoff` and that
 * is why neither could serve Bybit. What counts as "stop everything" is the
 * caller's knowledge, not the pool's.
 */

/** Concurrency the Binance paths already chose, adopted rather than re-picked.
 *  See snapshot/route.ts:63 - a value with a reason behind it beats a new one
 *  with none. */
export const DEFAULT_CONCURRENCY = 12;

/**
 * Runs `work` over `items`, at most `limit` at a time.
 *
 * Ordinary failures are swallowed - one bad item must not lose the rest, which
 * is the same reasoning as the `allSettled` in symbolFanout. A failure the
 * caller marks FATAL via `isFatal` stops every worker immediately: spending the
 * remaining requests into an active ban only extends it, and a ban on a shared
 * server IP is lost data for every visitor at once rather than for one.
 *
 * @returns true if the run was stopped early by a fatal error.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  isFatal: (e: unknown) => boolean = () => false,
): Promise<boolean> {
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        await work(items[i]);
      } catch (e) {
        if (isFatal(e)) { stopped = true; return; }
        /* Ordinary miss - the caller's `work` decides what that means for its
           own output. The pool's only job is to keep going. */
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return stopped;
}

/** Carries the HTTP status so a caller's `isFatal` can read it without parsing
 *  a message string. The two older copies encoded this as a bespoke Error
 *  subclass per route, which is what made them un-shareable. */
export class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

/* 429 is the warning and 418 is the ban that follows it on Binance. Bybit
   answers 403 when a per-IP limit is exceeded. None of the three is about the
   symbol that happened to be asked for, so all three mean stop rather than
   skip. */
export const isRateLimitStatus = (e: unknown): boolean =>
  e instanceof HttpStatusError && (e.status === 418 || e.status === 429 || e.status === 403);
