import { calcEMA, calcSMA, calcRSI, type ChartData } from './grok.ts';
import { detectPatterns } from './patterns.ts';
import { priceDigits } from './numberFormat.ts';
import type { OHLCV } from './strategyCore.ts';

/* THE ARENA'S CHART HALF OF A READ, BUILT FROM CANDLES THE SERVER FETCHED (#1605). PURE: candles in, ChartData out, no network.
 *
 * WHY. `/api/grok` assembles its prompt on the server and, since #1631 step 2, reads every numeric market field itself - but the chart half
 * (EMA9, SMA200, RSI, the last 15 candles, high/low, the detected patterns) still arrived from the browser, so a hand-made request could
 * describe candles of its own, or fast-timeframe candles under a slow `tf`. This builds the same object from the exchange's candles.
 *
 * IT MIRRORS THE BROWSER, LINE FOR LINE (app/(main)/arena/page.tsx, readMarket): the same 80-candle window, the same calcEMA / calcSMA /
 * calcRSI (RSI over CLOSED candles only, #1626 C), the same 15-candle text with priceDigits and the same volume abbreviation, the same
 * high/low over the window, and detectPatterns on the same window. A drift between the two is exactly what would make the server read differ
 * from the one the user sees, so any change to one is a change to both.
 *
 * KNOWN, SMALL DIFFERENCE: the browser reads Binance SPOT klines, the server's shared fetch (lib/ribbonCandles.ts) reads Binance FUTURES
 * (and Bybit as the fallback), as the alerts do. The same candles to within a basis; QA's parity check on a live coin measures it. */

export const ARENA_CHART_MIN_CANDLES = 60;
const WINDOW = 80;
const RECENT = 15;

const volText = (v: number): string => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));

/** The chart object for `tf`, or null when there are too few usable candles to say anything (the caller then keeps what it had). */
export function chartFromCandles(tf: string, candles: readonly OHLCV[]): ChartData | null {
  const clean = candles.filter(c => [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite));
  if (clean.length < ARENA_CHART_MIN_CANDLES) return null;
  const closes = clean.map(c => c.close);
  const vis = clean.slice(-WINDOW);
  const pats = detectPatterns(vis.map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close })));
  return {
    tf,
    ema9: calcEMA(closes, 9).at(-1) ?? null,
    sma200: calcSMA(closes, 200).at(-1) ?? null,
    rsi: calcRSI(closes.slice(0, -1), 14).at(-1) ?? null,
    recent20: vis.slice(-RECENT).map(c => `O:${priceDigits(c.open)} H:${priceDigits(c.high)} L:${priceDigits(c.low)} C:${priceDigits(c.close)} V:${volText(c.volume)}`).join(' | '),
    hi: Math.max(...vis.map(c => c.high)),
    lo: Math.min(...vis.map(c => c.low)),
    lastClose: vis[vis.length - 1].close,
    detectedPatterns: pats.length ? pats.join('; ') : undefined,
  };
}
