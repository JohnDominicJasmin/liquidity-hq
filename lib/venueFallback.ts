/* Try one venue, then the next, and fail only when every one of them has failed (#1263).
 *
 * In lib/ and DEPENDENCY-FREE, the same split as lib/econCoverage.ts and lib/newsTs.ts: the decision
 * should not need a route, a request or a live exchange to exercise.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * Three call sites wrote the same shape and none of them worked:
 *
 *     if (bySym) return fetchBybitKlines(bySym, ...);      // unconditional return
 *     if (bnSym) return fetchBinanceFuturesKlines(bnSym, ...);
 *
 * There is no `try`. The first branch returns on success AND throws on failure, so the second line
 * runs only for a coin the first venue does not list - which is the one case where it is not a
 * fallback at all. `lib/useEMAStrategy.ts` carried the comment "Bybit primary, Binance fallback" above
 * exactly this, so the fallback was documented, reviewed, and absent. The owner reported the symptom:
 * "Signal unavailable right now" under the Arena chart, intermittently, with a working second source
 * one unreached line below.
 *
 * ── WHAT IT GUARANTEES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────
 *
 * Every attempt runs in order until one returns. A `null` entry means "this venue has no symbol for
 * this coin" and is skipped without counting as a failure - so a Bybit-only coin still gets the right
 * error ("no venue") rather than a misleading "all venues failed".
 *
 * When they all fail it throws ONE error naming each venue and its own message, because the useful
 * question after an outage is which sources were tried and how each one failed. Throwing only the last
 * error - the obvious implementation - hides the primary's failure behind the fallback's, and the
 * primary is the one that normally works.
 *
 * It does NOT retry within a venue, time anything out, or reorder by health. Each attempt owns its own
 * retry and timeout (fetchBybitKlinesRetry already does both). Worth knowing before relying on this:
 * a slow failure costs the primary's full timeout BEFORE the fallback starts, so the worst case is the
 * sum, not the max. That is a real latency change for a user on a failing venue and it is the price of
 * getting an answer at all. */

export interface VenueAttempt<T> {
  /** Short name for the error message - 'Bybit', 'Binance futures'. */
  venue: string;
  run: () => Promise<T>;
}

/** Runs each attempt in order and returns the first that resolves.
 *
 *  `null` entries are skipped: they mean the venue has no symbol for this subject, which is not a
 *  failure. If nothing is attemptable the error says so, separately from "everything failed".
 *
 *  `onFallback` fires when an attempt fails and another is left to try. The caller decides whether that
 *  is worth a log line - this module writes nothing, so it stays testable without capturing console. */
export async function firstVenueThatAnswers<T>(
  attempts: ReadonlyArray<VenueAttempt<T> | null | undefined>,
  subject: string,
  onFallback?: (failed: string, err: unknown, next: string) => void,
): Promise<T> {
  const live = attempts.filter((a): a is VenueAttempt<T> => a != null);
  if (live.length === 0) throw new Error(`No venue for ${subject}`);

  const failures: string[] = [];
  for (let i = 0; i < live.length; i++) {
    try {
      return await live[i].run();
    } catch (err) {
      failures.push(`${live[i].venue}: ${err instanceof Error ? err.message : String(err)}`);
      const next = live[i + 1];
      if (next) onFallback?.(live[i].venue, err, next.venue);
    }
  }
  throw new Error(`All venues failed for ${subject} - ${failures.join('; ')}`);
}
