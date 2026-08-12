/* 10Y real yield (#311) - the macro series with the clearest link to crypto.
 *
 * FRED DFII10: the 10-Year Treasury Inflation-Indexed Security constant
 * maturity. It is the *real* yield - what a dollar earns after inflation - so
 * it is the actual opportunity cost of holding an asset that yields nothing.
 * Bitcoin yields nothing. That is the whole mechanism.
 *
 *     real yield UP    holding cash pays more    tighter    risk-off
 *     real yield DOWN  holding cash pays less    easier     risk-on
 *
 * Why not the nominal 10Y (^TNX, which Yahoo has and we already talk to):
 * nominal moves for two different reasons - real rates, and inflation
 * expectations. Those point opposite ways for crypto. Nominal rising on
 * inflation expectations is arguably bullish; nominal rising on real rates is
 * bearish. The nominal series cannot tell you which, so it is a worse signal
 * despite being the easier one to fetch.
 *
 * ── THE MEASUREMENT IS DAILY, AND CRYPTO IS NOT ──────────────────────────────
 *
 * DFII10 publishes once per business day, after the US close. There is no
 * observation on weekends or US market holidays. Crypto trades through all of
 * them. So for roughly two days in every seven this number is, correctly, old.
 *
 * That is handled rather than hidden: an old observation reports `stale` and
 * the signal degrades to 'unknown'. Presenting Friday's yield as the current
 * reading on a Sunday would be the same defect as #307's economic calendar -
 * an absence rendered as a value.
 */

import type { FredRow } from './fred';

export const REAL_YIELD_SERIES = 'DFII10';

/** Below this, a day's move is noise. Set with the owner on #311. */
export const REAL_YIELD_THRESHOLD_BP = 10;

/**
 * How old an observation may be before we stop calling it current.
 *
 * Five days, not one. A Friday observation is still the latest available on
 * Tuesday morning if Monday was a US market holiday - roughly 4.4 days by the
 * time anyone looks. A tighter bound would flag every long weekend as a data
 * outage, and a warning that cries wolf monthly gets ignored by Christmas.
 */
export const REAL_YIELD_STALE_MS = 5 * 24 * 3600_000;

export type RealYieldSignal = 'tightening' | 'easing' | 'neutral' | 'unknown';

export interface RealYield {
  /** Latest observation, in percent. 1.83 means 1.83%. */
  value: number | null;
  /** Change vs the previous observation, in basis points. 1.83 -> 1.93 is +10. */
  changeBp: number | null;
  /** Observation date, ms UTC. Not the time we fetched it. */
  asOf: number | null;
  /** True when the latest observation predates REAL_YIELD_STALE_MS. */
  stale: boolean;
  signal: RealYieldSignal;
  /** Plain-language line for the UI. Always safe to render. */
  note: string;
}

const UNAVAILABLE: RealYield = {
  value: null, changeBp: null, asOf: null, stale: true, signal: 'unknown',
  note: '10Y real yield unavailable - cannot check the rates backdrop',
};

/**
 * Turn FRED rows into a signal. Pure - `nowMs` is injected so tests do not
 * depend on the clock, and so a stale reading is decided against the time the
 * request was served rather than whenever the module happened to load.
 *
 * Needs two observations, not one: the signal is about the *change*. A single
 * row gives a level with nothing to compare it to, which is not enough to say
 * anything, so it reports unknown rather than guessing at a direction.
 */
export function computeRealYield(rows: readonly FredRow[], nowMs = Date.now()): RealYield {
  if (rows.length < 2) return UNAVAILABLE;

  const [asOf, value] = rows[rows.length - 1];
  const prev = rows[rows.length - 2][1];

  // Basis points, not percent change. A move from 1.80 to 1.90 is +10bp, which
  // is how every rates desk quotes it - but it is also +5.6% in relative terms,
  // and reporting that number next to "DXY -0.3%" would invite reading a
  // routine day as a violent one. The unit matters more than usual here.
  const changeBp = Math.round((value - prev) * 100);
  const stale = nowMs - asOf > REAL_YIELD_STALE_MS;

  if (stale) {
    const days = Math.floor((nowMs - asOf) / 86_400_000);
    return {
      value, changeBp, asOf, stale: true, signal: 'unknown',
      note: `10Y real yield last updated ${days} days ago - rates backdrop cannot be checked`,
    };
  }

  const signal: RealYieldSignal =
    changeBp >= REAL_YIELD_THRESHOLD_BP  ? 'tightening' :
    changeBp <= -REAL_YIELD_THRESHOLD_BP ? 'easing'     : 'neutral';

  const sign = changeBp >= 0 ? '+' : '';
  const move = `${value.toFixed(2)}% (${sign}${changeBp}bp)`;

  return {
    value, changeBp, asOf, stale: false, signal,
    note:
      signal === 'tightening' ? `10Y real yield ${move} - tighter conditions, headwind for risk` :
      signal === 'easing'     ? `10Y real yield ${move} - easier conditions, tailwind for risk` :
                                `10Y real yield ${move} - no meaningful move`,
  };
}
