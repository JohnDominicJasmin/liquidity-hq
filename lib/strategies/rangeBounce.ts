import { detectStructures } from '../chartStructureDetect.ts';
import { lineValueAt, type StructureCandle } from '../chartStructures.ts';
import type { OHLCV } from '../strategyCore.ts';
import { tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* RANGE BOUNCE (owner decision 2026-11-17, #1263). Closed candles only, on the structure detector's own flat range (lib/chartStructureDetect.ts): two flat rails, at least three touches on each.
 *  The range is the one found on the candles BEFORE the last one, so the bounce candle does not move its own edge.
 *  BUY:  the last candle's low touches the range low (within 0.1% of it) and it closes back inside, in the lower quarter of the range.
 *  SELL: the same at the top: its high touches the range high (within 0.1%) and it closes back inside, in the upper quarter.
 *  Entry  = the close.
 *  Stop   = beyond the edge: min(range low, the candle's low) for a BUY, max(range high, its high) for a SELL.
 *  Target = the opposite edge of the range, always, so there is always an R:R.
 *  Mid-range, no range, or fewer than three touches on a side: wait. Signals, not predictions. */

export const MIN_CANDLES = 60;
const TOUCH_TOL = 0.001;
const EDGE_ZONE = 0.25;
const MIN_TOUCHES = 3;

const toStructure = (c: OHLCV): StructureCandle => ({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });

export function detectRangeBounce(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const before = candles.slice(0, -1);
  const res = detectStructures(before.map(toStructure), { timeframe: ctx.tf });
  const range = res.structures.find(s => s.kind === 'range');
  if (!range || range.rails.length !== 2) return WAIT;
  const lowRail = range.rails.find(r => r.side === 'low'), highRail = range.rails.find(r => r.side === 'high');
  if (!lowRail || !highRail) return WAIT;
  if (lowRail.quality.touchCount < MIN_TOUCHES || highRail.quality.touchCount < MIN_TOUCHES) return WAIT;
  const idx = before.length - 1;
  const low = lineValueAt(lowRail.fit, idx), high = lineValueAt(highRail.fit, idx);
  const w = high - low;
  if (!(w > 0)) return WAIT;
  const x = candles[n - 1];
  const edges = [
    { price: high, role: 'watch' as const, fromTs: candles[Math.max(0, n - 60)].time, labelKey: 'STRAT_OV_RANGE_HIGH' as const },
    { price: low, role: 'watch' as const, fromTs: candles[Math.max(0, n - 60)].time, labelKey: 'STRAT_OV_RANGE_LOW' as const },
  ];
  if (x.low <= low * (1 + TOUCH_TOL) && x.close > low && x.close < low + EDGE_ZONE * w) {
    return tradeCall({ ts: x.time, dir: 'long', entry: x.close, stop: Math.min(low, x.low), target: high, params: { low, high }, levels: edges });
  }
  if (x.high >= high * (1 - TOUCH_TOL) && x.close < high && x.close > high - EDGE_ZONE * w) {
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
  logTfs: ['1h', '4h'],
  detect: detectRangeBounce,
};
