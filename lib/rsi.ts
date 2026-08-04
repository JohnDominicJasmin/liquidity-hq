/* Windowed RSI(14).
 *
 * Moved here verbatim from MarketProvider.tsx so the browser and
 * app/api/market/rsi/route.ts compute the identical number. Two copies would
 * drift silently: the value is rounded to an integer, so a one-line difference
 * in the averaging window shifts a coin across the 30/70 thresholds that drive
 * the oversold/overbought badges without ever looking wrong on screen.
 *
 * This is the simple (non-Wilder-smoothed) variant: a flat mean of the last 14
 * gains and losses rather than an exponential average seeded from the first 14
 * bars. It reads slightly more reactive than TradingView's RSI. Kept as-is
 * deliberately - every threshold, alert rule and backtest in the app was tuned
 * against these numbers, so "correcting" it to Wilder would silently re-tune
 * all of them. Change it only alongside those. */
export function computeRSI14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.slice(-14).map(c => Math.max(c, 0));
  const losses  = changes.slice(-14).map(c => Math.max(-c, 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  return avgLoss === 0 ? 100 : Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}
