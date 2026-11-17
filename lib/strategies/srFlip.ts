import type { OHLCV } from '../strategyCore.ts';
import { nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* S/R FLIP (owner decision 2026-11-17, #1263). Closed candles only, on the support / resistance levels the chart draws (lib/srLevels.ts).
 *  BUY:  price CLOSED above a level L (a close above it, the close before not above it), and the FIRST later candle that touches L (its low is at or below L) is the last closed candle and closes back above L: the retest.
 *  SELL: the mirror at a level price closed below: the first later candle that touches L (its high at or above L) is the last candle and closes back below it.
 *  Entry  = the retest candle's close.
 *  Stop   = min(L, the retest's low) for a BUY, max(L, its high) for a SELL: just beyond the level, which is the retest wick when the wick went through it. No buffer is added.
 *  Target = the first support / resistance level beyond the entry in the trade's direction that is at least one risk distance (entry to stop) away; none means no target and no R:R.
 *  A touch is exact (no tolerance band). The break is looked for in the last LOOKBACK candles. The call is on the retest candle only. Signals, not predictions. */

export const MIN_CANDLES = 40;
const LOOKBACK = 120;

export function detectSrFlip(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  // The levels as they stood before the retest candle, so the retest itself does not create or move them.
  return flipFromLevels(candles, srPrices(candles.slice(0, n - 1), candles[n - 2].close));
}

/** The rule itself, on a given list of level prices (the chart's levels in the app; a fixture's own level in a test). */
export function flipFromLevels(candles: readonly OHLCV[], levels: readonly number[]): StrategyResult {
  const n = candles.length;
  if (n < 4) return WAIT;
  const k = n - 1, last = candles[k];
  const from = Math.max(1, k - LOOKBACK);
  let best: { broke: number; dir: 'long' | 'short'; level: number } | null = null;
  for (const L of levels) {
    let upBreak = -1, downBreak = -1;
    for (let i = from; i <= k; i++) {
      if (candles[i].close > L && candles[i - 1].close <= L) upBreak = i;
      if (candles[i].close < L && candles[i - 1].close >= L) downBreak = i;
    }
    // BUY: the latest break was upward, and the first candle after it that touches L is the last one, closing back above.
    if (upBreak >= 0 && upBreak > downBreak && upBreak < k) {
      let first = -1;
      for (let i = upBreak + 1; i <= k; i++) if (candles[i].low <= L) { first = i; break; }
      if (first === k && last.close > L && (!best || upBreak > best.broke)) best = { broke: upBreak, dir: 'long', level: L };
    }
    if (downBreak >= 0 && downBreak > upBreak && downBreak < k) {
      let first = -1;
      for (let i = downBreak + 1; i <= k; i++) if (candles[i].high >= L) { first = i; break; }
      if (first === k && last.close < L && (!best || downBreak > best.broke)) best = { broke: downBreak, dir: 'short', level: L };
    }
  }
  if (!best) return WAIT;
  const { dir, level } = best;
  const entry = last.close;
  const stop = dir === 'long' ? Math.min(level, last.low) : Math.max(level, last.high);
  const others = levels.filter(p => p !== level);
  const target = nearestLevel(others, entry, dir, Math.abs(entry - stop));
  return tradeCall({
    ts: last.time, dir, entry, stop, target, params: { level },
    levels: [{ price: level, role: 'ref', fromTs: candles[best.broke].time, labelKey: 'STRAT_OV_FLIPPED' }],
  });
}

export const SR_FLIP: StrategyDef = {
  id: 'sr_flip',
  nameKey: 'STRAT_FLIP_NAME',
  descKey: 'STRAT_FLIP_DESC',
  reasonBuyKey: 'STRAT_FLIP_BUY',
  reasonSellKey: 'STRAT_FLIP_SELL',
  reasonWaitKey: 'STRAT_FLIP_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['1h', '4h'],
  detect: detectSrFlip,
};
