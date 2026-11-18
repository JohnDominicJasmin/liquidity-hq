import type { OHLCV } from '../strategyCore.ts';
import { atr14, nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* FAIR VALUE GAP (owner decision 2026-11-17, #1263). Closed candles only.
 *  A BULLISH GAP: candle i-2's high is below candle i's low; the gap is [i-2 high, i low]. A BEARISH gap is the mirror (i-2's low above i's high; the gap is [i high, i-2 low]).
 *  BUY:  the FIRST candle after a bullish gap that returns into it (its low is at or below the gap's top) is the last closed candle, the gap is still unfilled (no earlier close below its bottom), and it closes above the gap's bottom.
 *  SELL: the mirror for a bearish gap: the first return (its high at or above the gap's bottom) is the last candle, still unfilled (no close above the top), closing below the gap's top.
 *  Entry  = the close.
 *  Stop   = the gap's far edge: the bottom of a bullish gap, the top of a bearish one. No buffer.
 *  Target = the nearer of the recent swing (the highest high / lowest low of the 20 candles before the gap) and the first support / resistance level at least one risk distance (entry to stop) away, in the trade's direction; none means no target and no R:R.
 *  SIZE FILTERS (PM, 2026-11-19; a real-data audit found 10-15% of candles signalling, many on gaps of a few ticks): the gap must be at least MIN_GAP_ATR = 0.5 x ATR(14) tall (ATR at the gap's third candle), and the call's risk (entry to stop)
 *  at least MIN_RISK_ATR = 0.5 x ATR(14) at the return candle. 0.3, 0.4 and 0.5 were measured on 30 days of BTC / ETH / SOL: 0.5 lands at 2-5% of candles on 15m, 1h and 4h.
 *  The gap is looked for in the last LOOKBACK candles. The call is on the return candle only. Signals, not predictions. */

export const MIN_CANDLES = 30;
export const MIN_GAP_ATR = 0.5;    // a gap smaller than this many ATRs is noise, not a gap worth returning to
export const MIN_RISK_ATR = 0.5;   // a call whose risk (entry to stop) is smaller than this many ATRs is not taken
const LOOKBACK = 100;
const SWING_BARS = 20;

/** The target rule for a trade off the gap whose third candle is `i`: the nearer of the recent swing (the highest high / lowest low of the SWING_BARS candles before the gap) and the first support /
 *  resistance level at least one risk distance (entry to stop) away, in the trade's direction; null when neither is beyond the entry. Shared with lib/strategies/bosFvg.ts. */
export function gapTarget(candles: readonly OHLCV[], i: number, entry: number, stop: number, dir: 'long' | 'short'): number | null {
  const pre = candles.slice(Math.max(0, i - SWING_BARS - 2), i - 1);
  const sr = nearestLevel(srPrices(candles, entry), entry, dir, Math.abs(entry - stop));
  if (dir === 'long') {
    const cand = [Math.max(...pre.map(c => c.high)), sr].filter((v): v is number => v != null && v > entry);
    return cand.length ? Math.min(...cand) : null;
  }
  const cand = [Math.min(...pre.map(c => c.low)), sr].filter((v): v is number => v != null && v < entry);
  return cand.length ? Math.max(...cand) : null;
}

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
    if (top - bot < MIN_GAP_ATR * atr14(candles.slice(Math.max(0, i - 14), i + 1), 14)) continue;   // a tiny gap
    let first = -1, filled = false;
    for (let j = i + 1; j <= k; j++) {
      if (bull ? candles[j].close < bot : candles[j].close > top) { filled = true; break; }
      if (first < 0 && (bull ? candles[j].low <= top : candles[j].high >= bot)) first = j;
    }
    if (filled || first !== k) continue;
    const last = candles[k], entry = last.close;
    const atrK = atr14(candles.slice(Math.max(0, k - 14), k + 1), 14);
    const zone = { top, bottom: bot, fromTs: candles[i].time, toTs: last.time, kind: (bull ? 'demand' : 'supply') as 'demand' | 'supply', labelKey: 'STRAT_OV_FVG' as const };
    if (bull && last.close > bot && Math.abs(entry - bot) >= MIN_RISK_ATR * atrK) {
      return tradeCall({ ts: last.time, dir: 'long', entry, stop: bot, target: gapTarget(candles, i, entry, bot, 'long'), params: { gapLo: bot, gapHi: top }, zones: [zone] });
    }
    if (bear && last.close < top && Math.abs(entry - top) >= MIN_RISK_ATR * atrK) {
      return tradeCall({ ts: last.time, dir: 'short', entry, stop: top, target: gapTarget(candles, i, entry, top, 'short'), params: { gapLo: bot, gapHi: top }, zones: [zone] });
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
