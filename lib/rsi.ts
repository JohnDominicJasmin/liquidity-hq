/* THE RSI. Standard Wilder RSI(14), the one TradingView and the exchanges show (#1626 item C; owner, 2026-10-21: "Standard RSI").
 *
 * WHAT CHANGED AND WHY. This file used to hold a simple (non-Wilder) variant: a flat mean of the last 14 gains and losses, rounded to an
 * integer, fed with whatever candles the caller had, including the one still forming. Measured against TradingView on the same candles it
 * differed a lot (1h 39 vs 55-58, 1W 72 vs 57-58, 1M 38 vs 53) and jumped 39 -> 59 three minutes into a new candle. Every RSI in the app is now
 * this one function, used by the browser and the server alike.
 *
 * THE FORMULA: the first average gain/loss is the simple mean of the first `period` changes; every later one is Wilder's smoothing,
 * avg = (avg * (period - 1) + current) / period; RSI = 100 - 100 / (1 + avgGain / avgLoss). No losses at all reads 100 (a flat series too).
 *
 * WHAT THE CALLER OWES IT:
 *   - CLOSED candles only. Drop the forming candle before calling (lib/candles.ts dropForming, or the exchange's own close time). A forming
 *     candle is what made the old number jump inside a candle.
 *   - Enough history to settle. Wilder's average remembers its seed; with ~100+ closed candles the seed's effect is gone (the fetches that
 *     feed this ask for 120). With only 15 closes this returns the seed itself, which is the simple mean - correct, just not settled.
 *   - NO ROUNDING IN LOGIC. The value is returned unrounded so a 30/70 badge or an alert threshold compares the real number; round only to
 *     display it (formatRsi: one decimal), never before comparing. */

export const RSI_PERIOD = 14;

/** Wilder RSI for every close; NaN where it is not yet defined (the first `period` closes). */
export function wilderRsiSeries(closes: readonly number[], period: number = RSI_PERIOD): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const rsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = rsi(ag, al);
  for (let i = period; i < n - 1; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    out[i + 1] = rsi(ag, al);
  }
  return out;
}

/** The latest Wilder RSI of these closes, unrounded; null with fewer than period + 1 closes or a non-finite input. */
export function wilderRsi(closes: readonly number[], period: number = RSI_PERIOD): number | null {
  if (closes.length < period + 1) return null;
  const v = wilderRsiSeries(closes, period)[closes.length - 1];
  return Number.isFinite(v) ? v : null;
}

/** RSI(14) of these closes. Kept under its old name for its callers; now the standard Wilder value, unrounded (see the header). */
export function computeRSI14(closes: readonly number[]): number | null {
  return wilderRsi(closes, RSI_PERIOD);
}

/** For display only: one decimal, so a value just under 30 never shows as "30" next to an oversold badge. */
export function formatRsi(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '-' : v.toFixed(1);
}
