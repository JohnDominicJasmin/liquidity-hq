/* Paces the alert pass's own exchange calls, so 299 requests spread across the pass instead of
 * landing in a burst. #1651.
 *
 * ── WHY THE EXISTING GUARD IS NOT ENOUGH ──────────────────────────────────────────────────────
 *
 * lib/exchangeGuard.ts already caps Bybit at `BYBIT_WINDOW_MAX = 250` per 5 s, described there as
 * "under half of Bybit's 600 per 5 s per IP". That figure is correct - Bybit documents 600 requests
 * per 5-second window per IP, and `403 Access too frequent` is its documented symptom - but 250 per
 * 5 s is 50 requests a SECOND, so the alert pass's 299 calls all fit inside about six seconds. The
 * guard permits the entire burst; it was sized to stop a runaway loop, not to pace a scheduled fan-out.
 *
 * AND THE 600 IS NOT OURS ALONE. It is per IP, shared by everything this server sends to
 * api.bybit.com - including `/api/proxy?type=bybit-tickers`, which every Arena visitor's browser
 * triggers from this same host. So the pass can sit under its own 250 and still push the IP over 600
 * when a visitor is on the site, which is exactly the shape of the 2026-11-08 incident: two trips on
 * ordinary passes, with the breaker then stopping every Bybit call for 10 and 20 minutes.
 *
 * ── WHY PASS-SCOPED RATHER THAN LOWERING THE GLOBAL CAP ───────────────────────────────────────
 *
 * `BYBIT_WINDOW_MAX` is shared with the visitor-facing proxy path. Lowering it to pace a background
 * cron would make the Arena slower for the people the cron exists to serve. This limits the alert
 * pass only; the guard underneath is untouched and still backstops everything.
 *
 * ── WHAT IT DOES NOT CHANGE ───────────────────────────────────────────────────────────────────
 *
 * Pacing changes WHEN a request leaves, never which requests are made or what is done with them.
 * Every alert evaluates exactly the same data as before; only the pass takes longer. That is the
 * whole reason this is separable from the cadence and bulk-endpoint changes, which do alter
 * behaviour and are deferred.
 */

/** Requests per second the alert pass allows itself to Bybit.
 *
 *  SIZED FOR THE HEADROOM, NOT THE LIMIT. At 5/s a 299-call pass takes about 60 seconds, comfortably
 *  inside the 5-minute cadence, and leaves the IP's documented 600-per-5s budget almost entirely free
 *  for visitor traffic. Raising this trades that headroom for a shorter pass; the incident says the
 *  headroom is what was missing. */
const BYBIT_PER_SECOND = 5;

/** In-flight ceiling. Spacing alone still lets slow requests pile up, and a stall should not turn
 *  into a burst when they all return. */
const BYBIT_MAX_CONCURRENT = 4;

const MIN_GAP_MS = Math.ceil(1000 / BYBIT_PER_SECOND);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let nextSlot = 0;
let inFlight = 0;

/** Stats for the PR's before/after measurement and for a test to assert against. */
let paced = 0;
let maxObservedConcurrency = 0;

/** Wraps one Bybit call so it starts no sooner than its slot and never exceeds the in-flight cap.
 *  Non-Bybit callers do not go through here - this is deliberately narrow. */
export async function paceBybit<T>(task: () => Promise<T>): Promise<T> {
  while (inFlight >= BYBIT_MAX_CONCURRENT) await sleep(MIN_GAP_MS);

  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  if (slot > now) await sleep(slot - now);

  inFlight++;
  paced++;
  if (inFlight > maxObservedConcurrency) maxObservedConcurrency = inFlight;
  try {
    return await task();
  } finally {
    inFlight--;
  }
}

/** Called at the start of a pass so one pass's backlog never delays the next, and so the counters
 *  describe this pass rather than the lifetime of the process. */
export function resetAlertPacer(): void {
  nextSlot = 0;
  paced = 0;
  maxObservedConcurrency = 0;
}

/** What the pass actually did, for the summary line. */
export function alertPacerStats(): { paced: number; maxConcurrent: number; perSecond: number } {
  return { paced, maxConcurrent: maxObservedConcurrency, perSecond: BYBIT_PER_SECOND };
}
