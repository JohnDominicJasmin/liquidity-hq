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

/* TWO LIMITS, AND WHICH ONE BINDS DEPENDS ON LATENCY - that is the whole of QA's #2080 finding and
 * the reason the old header's "comfortably inside the 5-minute cadence" was only true when Bybit was
 * fast. Throughput is min(BYBIT_PER_SECOND, BYBIT_MAX_CONCURRENT / latency). The rate cap binds while
 * Bybit is quick; the concurrency cap takes over once a call takes longer than
 * MAX_CONCURRENT / PER_SECOND seconds, and from there the pass gets slower in proportion to latency.
 *
 * A pass that runs past the 5-minute cadence OVERLAPS THE NEXT ONE, which puts two passes' calls on
 * the wire at once and undoes the pacing this file exists to provide. So the number that matters is
 * the latency at which a 299-call pass reaches 300 seconds:
 *
 *     concurrency  4  ->  binds above 0.8s  ->  overruns past   4.01s   (was shipped)
 *     concurrency  8  ->  binds above 1.6s  ->  overruns past   8.03s   (reviewed, superseded)
 *     concurrency 12  ->  binds above 2.4s  ->  overruns past  12.04s   (now)
 *
 * MEASURED, NOT ASSERTED - 299 * latency / concurrency, against the timeouts of the calls paceBybit
 * ACTUALLY WRAPS, which is a shorter list than "timeouts in the alert route":
 *
 *     fetchBybitCandles (and fetchBybitKlines, which delegates to it)   7s
 *     fetchRibbonCandles (lib/ribbonCandles.ts:70, :108)                9s   <- the ceiling
 *
 * An earlier version of this note also listed 10s at alert/route.ts:446. THAT IS THE TELEGRAM
 * sendMessage, and it is not paced - it is not wrapped in paceBybit and it is not a Bybit call at
 * all. Caught by QA. Worth recording because the mistake was to census the file's timeouts rather
 * than the paced call sites', which inflated the ceiling and would have made every figure here
 * pessimistic in a way that looked careful.
 *
 * 12 CLEARS THE 9s CEILING WITH ROOM, which 8 did not. 8 put the break-even at 8.03s - above the 7s
 * timeout but BELOW the 9s one - so a pass whose klines all sat at their timeout still took ~336s and
 * still overlapped. At 12 that same worst case is 299 * 9 / 12 = 224s against a 300s cadence, about
 * 25% margin, and the break-even moves to 12.04s.
 *
 * WHAT THAT DOES AND DOES NOT PROMISE. It bounds the pass by the slowest latency the paced calls can
 * reach, so timeout-driven overlap is gone. It does NOT make overlap impossible - a pass delayed
 * before pacing starts, more than 299 calls, or a shorter cadence would each reopen it. The claim is
 * "no latency these timeouts permit can overrun the cadence", not "this pass can never overlap".
 *
 * RAISING CONCURRENCY DOES NOT SPEND THE IP BUDGET, and that is why 12 is affordable. MIN_GAP_MS
 * enforces the per-second rate no matter how many calls are in flight, so the 600-per-5s-per-IP
 * headroom is protected by BYBIT_PER_SECOND alone - 12 in flight still leaves at 5/s. MAX_CONCURRENT
 * only bounds how many sockets are open and stops a stall from becoming a burst when they all return
 * at once. So the two numbers answer different risks: PER_SECOND protects the shared IP, and
 * MAX_CONCURRENT protects the cadence. Confusing them is how 4 came to look like the safe choice. */

/** Requests per second the alert pass allows itself to Bybit.
 *
 *  SIZED FOR THE HEADROOM, NOT THE LIMIT. At 5/s a 299-call pass takes about 60 seconds and leaves
 *  the IP's documented 600-per-5s budget almost entirely free for visitor traffic. Raising this
 *  trades that headroom for a shorter pass; the incident says the headroom is what was missing.
 *  This is the cap that protects the shared IP budget - see the note above. */
const BYBIT_PER_SECOND = 5;

/** In-flight ceiling. Spacing alone still lets slow requests pile up, and a stall should not turn
 *  into a burst when they all return.
 *
 *  RAISED 4 -> 12 FOR #2080 (8 first, then 12 once the timeouts were measured). At 4 this bound throughput to 4/latency, so it took over above 0.8s and
 *  a 4-second average pushed the pass to the full 5-minute cadence - where it overlaps the next pass
 *  and the pacing stops meaning anything. The paced calls time out at 7s and 9s, so 4 seconds was
 *  well inside reach. See the note above for what 12 does and does not cover. */
const BYBIT_MAX_CONCURRENT = 12;

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
