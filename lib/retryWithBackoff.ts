/* Shared retry-with-backoff loop (#1199). Two hand-written copies of this
 * existed - components/AuthProvider.tsx's entitlements fetch (#1119) and
 * components/SettingsProvider.tsx's flushToDb (#1188) - same numbers
 * (3 attempts, [1000, 2000] backoff) because #1188 deliberately copied
 * #1119's shape rather than invent new ones, but two separate copies of the
 * loop mechanics itself. Filed rather than left as a PR comment because
 * this is the SECOND time this exact pattern happened: getAuthToken() had
 * three byte-identical copies before #1166 consolidated them.
 *
 * Deliberately does not decide what "success" means, or do anything with a
 * successful/exhausted result - #1119's caller sets role/trialEndsAt,
 * #1188's caller merges settings and manages unconfirmed-write markers, and
 * neither of those belongs here. This only owns the loop: call attempt(n),
 * stop on the first non-failed result, back off between failures, stop
 * early if the caller says to. The two existing callers' timing is
 * unchanged by construction - same attempt count, same backoff array,
 * same "no wait after the last attempt" rule. */

export interface RetryOptions {
  /** Total attempts, first attempt included (matches both existing callers' `_MAX_ATTEMPTS`). */
  maxAttempts: number;
  /** Delay before attempt n+1, indexed by n-1 - so length maxAttempts-1. Matches both
   *  existing callers' `_RETRY_BACKOFF_MS`. */
  backoffMs: number[];
  /** Checked after every attempt and after every backoff wait. Lets a caller
   *  tied to an effect's cleanup (AuthProvider's `cancelled` closure) stop the
   *  loop without setting state for an unmount it already missed - SettingsProvider
   *  has no such lifecycle and simply omits this. */
  isCancelled?: () => boolean;
}

export interface RetryOutcome<T> {
  /** The last attempt's return value - a success on the first non-failed
   *  attempt, otherwise the final attempt's (failed) result. */
  result: T;
  /** How many attempts actually ran, 1-based. */
  attempts: number;
  /** True if the loop stopped because `isCancelled` returned true, rather
   *  than because an attempt succeeded or every attempt was used up. A
   *  cancelled outcome's `result` is whatever the last attempt returned -
   *  the caller that asked to cancel is expected to ignore it, not act on it. */
  cancelled: boolean;
}

/**
 * Runs `attempt` up to `maxAttempts` times, waiting `backoffMs[n-1]` between
 * a failed attempt n and attempt n+1 (never after the last attempt). Stops
 * at the first attempt whose result has `failed: false`.
 *
 * `attempt` returns whatever the caller needs alongside `failed` - #1119's
 * carries `data`, #1188's carries `accepted`/`rejected`/`settings` - this
 * function never inspects those fields, only `failed`.
 */
export async function retryWithBackoff<T extends { failed: boolean }>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const { maxAttempts, backoffMs, isCancelled } = options;
  let result: T;
  for (let n = 1; n <= maxAttempts; n++) {
    result = await attempt(n);
    if (isCancelled?.()) return { result, attempts: n, cancelled: true };
    if (!result.failed) return { result, attempts: n, cancelled: false };

    if (n < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, backoffMs[n - 1]));
      if (isCancelled?.()) return { result, attempts: n, cancelled: true };
    }
  }
  // Every attempt failed. `result!` is defined: maxAttempts is always >= 1
  // in both existing callers, so the loop body ran at least once.
  return { result: result!, attempts: maxAttempts, cancelled: false };
}
