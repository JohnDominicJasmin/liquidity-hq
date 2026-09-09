/* Shared retry for /api/market/klines?source=bybit - #1080.
 *
 * #1079/#1081 found this exact shape (one fetch, no retry, empty on 502)
 * broken in KLineProChart.tsx's getBars: the old 5s poll architecture had
 * accidental resilience through sheer repetition - a failed poll was
 * invisible, the next one 5s later just worked - and the one-shot fetch
 * that replaced it had none. #1080 found the same shape at 13 more call
 * sites, two of them confirmed hitting a real 502 live during testing.
 * This is the shared definition #1081's PR recommended rather than pasting
 * the same loop 14 times - the same "one helper beats N private copies"
 * lesson as bucketSz (#1075).
 */

/** The shared response envelope every /api/market/klines?source=bybit call
 *  gets back - see app/api/market/klines/route.ts's own sliceToLimit
 *  comment: Bybit keeps its {retCode, result:{list}} shape untouched. */
export interface BybitKlinesResponse {
  result?: { list?: string[][] };
}

export interface FetchBybitKlinesRetryOptions {
  /** Extra query params beyond source/symbol/interval/limit - e.g.
   *  `{ closed: '1' }` for a caller that wants boundary-aligned candles. */
  extraParams?: Record<string, string>;
  /** Checked before each attempt (including the first) and once more right
   *  after a fetch resolves, so a caller tracking its own cancellation (a
   *  coin/tf switch, a component unmount) can bail out of an in-flight
   *  sequence rather than let it run to completion for data nobody wants
   *  anymore - KLineProChart's own `stale()` is exactly this. Omit for a
   *  caller with no such tracking; the sequence just runs to completion or
   *  exhaustion. */
  isStale?: () => boolean;
  /** Passed straight to `fetch()`. For callers already using
   *  `AbortSignal.timeout(...)` (useEMAStrategy, backfillGapBybit) as an
   *  overall ceiling on the whole sequence, not a per-attempt budget. */
  signal?: AbortSignal;
}

/** Retries Bybit's klines endpoint up to 3 times (immediate, +500ms,
 *  +1500ms) before giving up - the shape #1081 shipped for KLineProChart's
 *  `getBars`, long enough to ride out one bad response, short enough not
 *  to make a real outage feel hung.
 *
 *  THE `r.ok` CHECK IS THE HALF THAT ACTUALLY CLOSES THE HOLE, not the
 *  retry. `app/api/market/klines/route.ts` returns a non-2xx (502, upstream
 *  status attached) rather than a fake-empty 200 when Bybit refuses - code
 *  that skips this check parses the error body's shape (`{error:...}`) as
 *  `{result:{list:undefined}}` and silently treats a REFUSAL as "zero
 *  candles," indistinguishable from a coin that genuinely has none. That
 *  conflation is what made #1079's symptom silent, and it would still be a
 *  live defect even with infinite retries layered on top of it.
 *
 *  Returns `null` only when every attempt failed - a caller uses that to
 *  tell "upstream refused every time" apart from "upstream answered OK with
 *  a genuinely empty list" (`{result:{list:[]}}`, returned as-is, not as
 *  null). What a caller DOES with that distinction is its own call - a
 *  chart might show a banner, a background strategy read might throw so its
 *  own existing error path picks it up, a sparkline might just skip the
 *  update. This function has no opinion on exhaustion UI and bakes none in. */
export async function fetchBybitKlinesRetry(
  symbol: string,
  interval: string,
  limit: number,
  opts: FetchBybitKlinesRetryOptions = {},
): Promise<BybitKlinesResponse | null> {
  const { extraParams, isStale, signal } = opts;
  const params = new URLSearchParams({
    source: 'bybit', symbol, interval, limit: String(limit), ...extraParams,
  });
  for (let attempt = 0; attempt < 3 && !(isStale?.() ?? false); attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, attempt === 1 ? 500 : 1500));
    if (isStale?.()) break;
    try {
      const r = await fetch(`/api/market/klines?${params.toString()}`, signal ? { signal } : undefined);
      if (r.ok) return await r.json() as BybitKlinesResponse;
    } catch { /* network error or abort - fall through to the next attempt */ }
  }
  return null;
}
