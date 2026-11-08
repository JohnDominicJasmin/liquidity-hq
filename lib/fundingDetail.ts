/* The Funding Rate condition row's text (#1651).
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A TERNARY IN THE HOOK. It was a ternary in the hook, and
 * that is how it went wrong: `useEMAStrategy` only produces `conditions` after candles are
 * cached, so a test that renders the hook without stubbing the candle fetch asserts against
 * STRATEGY_LOADING's EMPTY `conditions` array and passes without checking anything. Pulling the
 * rule out makes the three states testable with no React and no fetch - which is the only way the
 * test for this can fail when the rule is wrong.
 *
 * It is not in strategyCore.ts on purpose: that file opens with "No React, no fetch - just math
 * over a candle array" and has zero imports, and this needs the coin registry.
 *
 * ── THREE STATES, NOT TWO ─────────────────────────────────────────────────────────────────────
 *
 * `fundingRate == null` carries two different meanings and the old text asserted the wrong one:
 *
 *   - For a coin WITH a Bybit symbol, null means NOT ARRIVED YET. components/MarketProvider.tsx:367
 *     is the only writer of `fundingRate` in the app, it writes from the Bybit ticker list, and it
 *     runs client-side after mount. So null is the normal state for the first moments of a page,
 *     and "unavailable" - a settled word - was wrong on 49 of our 50 coins.
 *   - For a coin WITHOUT a Bybit symbol, null is FINAL. No writer can ever fill it, so this must
 *     not sit on "loading…" for the full grace period before admitting it. Today that is `fet`,
 *     the one member of COINS absent from BYBIT_SYMS.
 *
 * This is #1613's rule ("a value that has not arrived yet must read as LOADING, never as a final
 * word") applied to the surface #1613 missed: it reached eight files and not this one.
 */
import { BYBIT_SYMS } from './coins.ts';

export const FUNDING_UNAVAILABLE = 'Funding unavailable';
export const FUNDING_LOADING     = 'Funding loading…';

/** True when a funding rate can ever arrive for this coin at all - i.e. something writes it. */
export function coinHasFundingSource(coin: string): boolean {
  return coin in BYBIT_SYMS;
}

/**
 * @param coin           the selected coin id
 * @param fundingRate    the rate as a fraction (0.0001 = 0.01%), or null when not known
 * @param fundingOK      the tri-state verdict; only read when `fundingRate` is non-null
 * @param feedGraceOver  #1613's grace period, owned by the page so one timer answers for every surface
 */
export function fundingDetail(
  coin: string,
  fundingRate: number | null,
  fundingOK: boolean | null,
  feedGraceOver: boolean,
): string {
  if (fundingRate != null) {
    const pct = (fundingRate * 100).toFixed(4);
    return `${pct}% - ${fundingOK ? 'safe, proceed' : 'excessive, skip entry (bleed/squeeze risk)'}`;
  }
  // Null is final for a coin nothing can write a rate for: say so now, not in 15 seconds.
  if (!coinHasFundingSource(coin)) return FUNDING_UNAVAILABLE;
  return feedGraceOver ? FUNDING_UNAVAILABLE : FUNDING_LOADING;
}
