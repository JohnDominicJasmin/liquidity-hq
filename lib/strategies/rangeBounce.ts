import type { OHLCV } from '../strategyCore.ts';
import { atr14, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* RANGE BOUNCE (owner decision 2026-11-17, #1263; range rule loosened by PM 2026-11-19 after a real-data audit found the structure detector's range on 3 of about 3500 candles, 4 signals in 30 days). Closed candles only.
 *  THE RANGE is the last RANGE_BARS candles BEFORE the last one: their highest high is the range high, their lowest low the range low, and the band between them is no taller than MAX_BAND_ATR x ATR(14), so price has been
 *    moving sideways inside an ATR-sized band. It needs at least MIN_TOUCHES candles touching EACH edge (a candle touches the high when its high is within TOUCH_FRAC of the band height of it, the low likewise). The last candle
 *    does not move its own edge.
 *  BUY:  the last candle's low is within TOUCH_FRAC of the band height of the range low (or below it) and it closes back inside, in the lower quarter of the range.
 *  SELL: the same at the top: its high touches the range high (within TOUCH_FRAC of the band height, or above it) and it closes back inside, in the upper quarter.
 *  Entry  = the close.
 *  Stop   = beyond the edge: min(range low, the candle's low) for a BUY, max(range high, its high) for a SELL.
 *  Target = the opposite edge of the range, always, so there is always an R:R.
 *  Mid-range, no range (too tall a band or fewer than two touches on a side): wait. Signals, not predictions. */

export const MIN_CANDLES = 60;
export const RANGE_BARS = 30;
export const MAX_BAND_ATR = 4;
const TOUCH_FRAC = 0.1;
const EDGE_ZONE = 0.25;
const MIN_TOUCHES = 2;

/** The range the strategy trades, or null when there is none: the last RANGE_BARS candles BEFORE the last one, a band no taller than MAX_BAND_ATR x ATR(14) with at least MIN_TOUCHES touches on each edge. The detector and the chart's
 *  "watching" drawing (lib/strategies/chartDrawings.ts) both read it, so the band drawn is the band the call is made against. `fromTs` is where the band starts. */
export function currentRange(candles: readonly OHLCV[]): { high: number; low: number; w: number; fromTs: number } | null {
  if (candles.length < MIN_CANDLES) return null;
  const before = candles.slice(0, -1);
  const win = before.slice(-RANGE_BARS);
  const high = Math.max(...win.map(c => c.high)), low = Math.min(...win.map(c => c.low));
  const w = high - low;
  if (!(w > 0) || w > MAX_BAND_ATR * atr14(before.slice(-15), 14)) return null;
  const tol = TOUCH_FRAC * w;
  if (win.filter(c => c.high >= high - tol).length < MIN_TOUCHES || win.filter(c => c.low <= low + tol).length < MIN_TOUCHES) return null;
  return { high, low, w, fromTs: win[0].time };
}

export function detectRangeBounce(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const range = currentRange(candles);
  if (!range) return WAIT;
  const { high, low, w } = range;
  const win = candles.slice(0, -1).slice(-RANGE_BARS);
  const tol = TOUCH_FRAC * w;
  const x = candles[n - 1];
  const edges = [
    { price: high, role: 'watch' as const, fromTs: win[0].time, labelKey: 'STRAT_OV_RANGE_HIGH' as const },
    { price: low, role: 'watch' as const, fromTs: win[0].time, labelKey: 'STRAT_OV_RANGE_LOW' as const },
  ];
  if (x.low <= low + tol && x.close > low && x.close < low + EDGE_ZONE * w) {
    return tradeCall({ ts: x.time, dir: 'long', entry: x.close, stop: Math.min(low, x.low), target: high, params: { low, high }, levels: edges });
  }
  if (x.high >= high - tol && x.close < high && x.close > high - EDGE_ZONE * w) {
    return tradeCall({ ts: x.time, dir: 'short', entry: x.close, stop: Math.max(high, x.high), target: low, params: { low, high }, levels: edges });
  }
  return { ...WAIT, overlay: { levels: edges, zones: [], lines: [], marker: null } };
}

export const RANGE_BOUNCE: StrategyDef = {
  id: 'range_bounce',
  nameKey: 'STRAT_RANGE_NAME',
  descKey: 'STRAT_RANGE_DESC',
  reasonBuyKey: 'STRAT_RANGE_BUY',
  reasonSellKey: 'STRAT_RANGE_SELL',
  reasonWaitKey: 'STRAT_RANGE_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['15m', '1h', '4h'],
  detect: detectRangeBounce,
};
