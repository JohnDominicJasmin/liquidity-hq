// RSI divergence - a possible-reversal warning, distinct from the EMA ribbon's
// trend-continuation signal. The ribbon signal is a LAGGING confirmation (it
// waits for price to prove itself); divergence is a LEADING exhaustion read
// (momentum fading while price still pushes to a new extreme). The two are
// meant to complement each other, not replace one another.
import type { OHLCV } from './strategyCore.ts';
import { wilderRsiSeries } from './rsi.ts';

/** Wilder RSI series - the app's one RSI (lib/rsi.ts, #1626 C). Kept under this name for its callers. */
export function rsiArr(closes: number[], period = 14): number[] {
  return wilderRsiSeries(closes, period);
}

interface Swing { index: number; price: number; rsi: number }

export interface DivergenceEvent {
  index:       number;   // candle index of the second (confirming) swing
  timestamp:   number;
  anchorPrice: number;   // the swing extreme itself - marker placement
  dir:         'bullish' | 'bearish'; // bullish = possible reversal UP, bearish = possible reversal DOWN
  priorSwingIndex: number;
}

const SWING_LOOKBACK = 3; // bars either side - matches computeSRLevels' swing-pivot convention

/** Local swing highs and lows over the whole candle array, each tagged with its RSI reading. */
function findSwings(candles: OHLCV[], rsi: number[]): { highs: Swing[]; lows: Swing[] } {
  const highs: Swing[] = [], lows: Swing[] = [];
  for (let i = SWING_LOOKBACK; i < candles.length - SWING_LOOKBACK; i++) {
    if (!isFinite(rsi[i])) continue;
    const hi = candles[i].high, lo = candles[i].low;
    const isHigh = candles.slice(i - SWING_LOOKBACK, i).every(b => b.high <= hi)
      && candles.slice(i + 1, i + SWING_LOOKBACK + 1).every(b => b.high <= hi);
    const isLow = candles.slice(i - SWING_LOOKBACK, i).every(b => b.low >= lo)
      && candles.slice(i + 1, i + SWING_LOOKBACK + 1).every(b => b.low >= lo);
    if (isHigh) highs.push({ index: i, price: hi, rsi: rsi[i] });
    if (isLow)  lows.push({ index: i, price: lo, rsi: rsi[i] });
  }
  return { highs, lows };
}

/**
 * Compares each swing to the PREVIOUS swing of the same type:
 * - Bearish divergence: price makes a higher high, RSI makes a lower high - upside momentum fading.
 * - Bullish divergence: price makes a lower low, RSI makes a higher low - downside momentum fading.
 * One event per confirmed pair, at the later (confirming) swing.
 */
export function detectRSIDivergence(candles: OHLCV[], period = 14): DivergenceEvent[] {
  if (candles.length < period + SWING_LOOKBACK * 2 + 2) return [];
  const closes = candles.map(c => c.close);
  const rsi = rsiArr(closes, period);
  const { highs, lows } = findSwings(candles, rsi);

  const events: DivergenceEvent[] = [];

  for (let i = 1; i < highs.length; i++) {
    const prev = highs[i - 1], cur = highs[i];
    if (cur.price > prev.price && cur.rsi < prev.rsi) {
      events.push({
        index: cur.index, timestamp: candles[cur.index].time,
        anchorPrice: cur.price, dir: 'bearish', priorSwingIndex: prev.index,
      });
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const prev = lows[i - 1], cur = lows[i];
    if (cur.price < prev.price && cur.rsi > prev.rsi) {
      events.push({
        index: cur.index, timestamp: candles[cur.index].time,
        anchorPrice: cur.price, dir: 'bullish', priorSwingIndex: prev.index,
      });
    }
  }

  return events.sort((a, b) => a.index - b.index);
}
