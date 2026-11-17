import type { OHLCV } from '../strategyCore.ts';
import { nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* FAIR VALUE GAP (owner decision 2026-11-17, #1263). Closed candles only.
 *  A BULLISH GAP: candle i-2's high is below candle i's low; the gap is [i-2 high, i low]. A BEARISH gap is the mirror (i-2's low above i's high; the gap is [i high, i-2 low]).
 *  BUY:  the FIRST candle after a bullish gap that returns into it (its low is at or below the gap's top) is the last closed candle, the gap is still unfilled (no earlier close below its bottom), and it closes above the gap's bottom.
 *  SELL: the mirror for a bearish gap: the first return (its high at or above the gap's bottom) is the last candle, still unfilled (no close above the top), closing below the gap's top.
 *  Entry  = the close.
 *  Stop   = the gap's far edge: the bottom of a bullish gap, the top of a bearish one. No buffer.
 *  Target = the nearer of the recent swing (the highest high / lowest low of the 20 candles before the gap) and the first support / resistance level at least one risk distance (entry to stop) away, in the trade's direction; none means no target and no R:R.
 *  The gap is looked for in the last LOOKBACK candles. The call is on the return candle only. Signals, not predictions. */

export const MIN_CANDLES = 30;
const LOOKBACK = 100;
const SWING_BARS = 20;

export function detectFairValueGap(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const k = n - 1;
  for (let i = k - 1; i >= Math.max(2, k - LOOKBACK); i--) {
    const bull = candles[i - 2].high < candles[i].low;
    const bear = candles[i - 2].low > candles[i].high;
    if (!bull && !bear) continue;
    const top = bull ? candles[i].low : candles[i - 2].low;
    const bot = bull ? candles[i - 2].high : candles[i].high;
    let first = -1, filled = false;
    for (let j = i + 1; j <= k; j++) {
      if (bull ? candles[j].close < bot : candles[j].close > top) { filled = true; break; }
      if (first < 0 && (bull ? candles[j].low <= top : candles[j].high >= bot)) first = j;
    }
    if (filled || first !== k) continue;
    const pre = candles.slice(Math.max(0, i - SWING_BARS - 2), i - 1);
    const last = candles[k], entry = last.close;
    const zone = { top, bottom: bot, fromTs: candles[i].time, toTs: last.time, kind: (bull ? 'demand' : 'supply') as 'demand' | 'supply', labelKey: 'STRAT_OV_FVG' as const };
    if (bull && last.close > bot) {
      const swing = Math.max(...pre.map(c => c.high));
      const sr = nearestLevel(srPrices(candles, entry), entry, 'long', Math.abs(entry - bot));
      const cand = [swing, sr].filter((v): v is number => v != null && v > entry);
      return tradeCall({ ts: last.time, dir: 'long', entry, stop: bot, target: cand.length ? Math.min(...cand) : null, params: { gapLo: bot, gapHi: top }, zones: [zone] });
    }
    if (bear && last.close < top) {
      const swing = Math.min(...pre.map(c => c.low));
      const sr = nearestLevel(srPrices(candles, entry), entry, 'short', Math.abs(entry - top));
      const cand = [swing, sr].filter((v): v is number => v != null && v < entry);
      return tradeCall({ ts: last.time, dir: 'short', entry, stop: top, target: cand.length ? Math.max(...cand) : null, params: { gapLo: bot, gapHi: top }, zones: [zone] });
    }
  }
  return WAIT;
}

export const FAIR_VALUE_GAP: StrategyDef = {
  id: 'fvg',
  nameKey: 'STRAT_FVG_NAME',
  descKey: 'STRAT_FVG_DESC',
  reasonBuyKey: 'STRAT_FVG_BUY',
  reasonSellKey: 'STRAT_FVG_SELL',
  reasonWaitKey: 'STRAT_FVG_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['1h', '4h'],
  detect: detectFairValueGap,
};
