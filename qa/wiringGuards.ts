/* Source-reading guards shared between a test and a probe.
 *
 * It lives here rather than inside the test file so that a probe can run the EXACT function the test
 * runs. A probe that re-implements the check is testing its own transcription, and the whole reason
 * this module exists is a guard that was subtly wrong about what it matched.
 *
 * QA-owned (`qa/`). It reads application source as text; it never imports it. */

/** Pins that the candles a signal detector consumes were filtered, without pinning a call shape.
 *
 * THE HISTORY, because it is the reason the signature looks like this. The original assertion was
 * `/closedCandles\(await fetchRibbonCandles\(/` - the two identifiers adjacent in the source. #2080
 * paced the fetch:
 *
 *     const candles = closedCandles(await paceBybit(() => fetchRibbonCandles(coin, tf)), tf);
 *
 * The fetched candles still pass through `closedCandles`, so the invariant held - and the guard
 * failed anyway, reporting that the route "reads fetchRibbonCandles directly". Six CI runs were
 * killed on it across two days.
 *
 * A near-miss worth recording: the first proposed repair was
 * `/closedCandles\(await [^)]*fetchRibbonCandles\(/`, allowing an intervening wrapper. It does not
 * work - `() =>` contains a `)`, so `[^)]*` cannot reach the fetch. Checked rather than eyeballed,
 * which is the only reason it was not committed.
 *
 * What is pinned instead: the variable handed to the detector is the one assigned from
 * `closedCandles(...)`. Indifferent to wrappers inside those arguments and to an intermediate
 * variable - both preserve the behaviour. Still fails when a detector receives an unfiltered series.
 *
 * @param body     the source text of ONE function - a whole file would let an unrelated call satisfy it
 * @param detector the detector called in that function, e.g. `detectEMASignals`
 * @returns null when the property holds, else the reason it does not
 */
export function unfilteredCandlesReachDetector(body: string, detector: string): string | null {
  const assigned = body.match(/const\s+(\w+)\s*=\s*(?:await\s+)?closedCandles\(/);
  if (!assigned) return 'nothing here is assigned from closedCandles(...), so no candle is filtered at all';
  const filtered = assigned[1];

  const callAt = body.indexOf(`${detector}(`);
  if (callAt < 0) return `${detector} is not called here`;
  /* The first argument only, by slice rather than by parsing: `candles.map(c => ({ ... }))` is a
     legitimate first argument, so a bracket-balanced read buys nothing over a bounded window. */
  const argHead = body.slice(callAt + detector.length + 1, callAt + detector.length + 61);
  if (/^\s*await\s/.test(argHead)) return `${detector} is passed an awaited call directly, bypassing the filter`;
  if (!new RegExp(`\\b${filtered}\\b`).test(argHead)) {
    return `${detector} is called with ${JSON.stringify(argHead.trim().slice(0, 40))} rather than \`${filtered}\``
      + ' - the filtered candles are computed and then not used';
  }
  return null;
}

/** The two cron alert functions and the detector each one calls. */
export const CRON_ALERT_PATHS = [
  ['checkEMASignal', 'detectEMASignals'],
  ['checkStructureSignal', 'detectStructureSignals'],
] as const;
