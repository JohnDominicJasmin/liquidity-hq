import type { OHLCV } from '../strategyCore.ts';
import { computeSRLevels } from '../srLevels.ts';
import { atr14, nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* S/R FLIP (owner decision 2026-11-17, #1263; tightened by PM 2026-11-19 after a real-data audit found it signalling on 13-21% of candles). Closed candles only, on the support / resistance levels the chart draws (lib/srLevels.ts).
 *  LEVELS WATCHED: only the levels the chart draws (at most 6, the nearest to the last close). The chart keeps only resistances ABOVE the price and supports BELOW it, so a level that has just been broken is no longer in its list; the levels watched
 *    are therefore the chart's levels as they stood just before each break in the last LOOKBACK candles, with levels within 0.3% of each other merged into one, then the 6 nearest to the last close.
 *  Only levels that at least 2 swing points make (the chart's 'touches' count) are watched: a level drawn from a single swing is not a flip.
 *  BREAK:  a close at least 0.1 x ATR(14) beyond the level (above it for an upward break, below it for a downward one), the close before it not already that far beyond. A close a tick over the level is not a break.
 *  BUY:  after an UPWARD break of level L, the FIRST candle that touches L (its low is at or below L) and comes at least 4 candles after the break candle (at least 3 candles between them; PM suggested 2, the real-data audit needed 3 to land near 5%) is the last closed candle and closes back above L.
 *  SELL: the mirror after a downward break (the first such candle's high is at or above L and it closes back below L).
 *  ONE FLIP PER LEVEL AND DIRECTION until price closes back through the level: only the first qualifying touch after a break counts, and a new break needs a close back on the other side first.
 *  Entry  = the retest candle's close.
 *  Stop   = min(L, the retest's low) for a BUY, max(L, its high) for a SELL: just beyond the level, which is the retest wick when the wick went through it. No buffer is added.
 *  Target = the first support / resistance level beyond the entry in the trade's direction that is at least one risk distance (entry to stop) away; none means no target and no R:R.
 *  A touch is exact (no tolerance band). The break is looked for in the last LOOKBACK candles. The call is on the retest candle only. Signals, not predictions. */

export const MIN_CANDLES = 40;
const LOOKBACK = 120;
export const MIN_BREAK_ATR = 0.1;   // a break closes at least this many ATRs beyond the level
export const MIN_BARS_BETWEEN = 3;  // candles BETWEEN the break candle and the retest candle (the retest is at least 4 candles after the break)
export const MIN_TOUCHES = 2;       // a level the chart draws from at least this many swing points (a single swing is not a level worth flipping)
export const MAX_LEVELS = 6;        // the chart draws at most 3 resistances and 3 supports
const MERGE_PCT = 0.003;            // levels this close are one level (the chart's own cluster width)

export function detectSrFlip(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  /* THE LEVEL THAT FLIPPED IS THE ONE THE CHART DREW AT THE BREAK (QA oracle AO2, #1263 box 18). The chart keeps only resistances ABOVE the price and supports BELOW it, so after a break and a retest the
     broken level is on the other side and is no longer in the chart's list: reading the levels at the retest made this strategy say WAIT on every real flip. So the levels this rule watches are, for each
     candle in the window that closed through one, the chart's levels as they stood just before that candle. */
  const k = n - 1;
  const atBreak: number[] = [];
  for (let i = Math.max(1, k - LOOKBACK); i < k; i++) {
    const c = candles[i].close, p = candles[i - 1].close;
    for (const lv of computeSRLevels(candles.slice(0, i).map(x => ({ high: x.high, low: x.low, close: x.close })), p)) if (lv.touches >= MIN_TOUCHES && ((c > lv.price && p <= lv.price) || (c < lv.price && p >= lv.price))) atBreak.push(lv.price);
  }
  // The TARGET stays on the chart's levels as they stand at the retest (the lines the trader sees), so the retest itself does not create or move them.
  return flipFromLevels(candles, watchedLevels(atBreak, candles[k].close), srPrices(candles.slice(0, n - 1), candles[n - 2].close));
}

/** Levels within MERGE_PCT of each other are ONE level (the chart's centres drift a little from candle to candle, so the same level appears as many near-identical prices), and at most MAX_LEVELS are kept: the nearest to `price`. */
export function watchedLevels(levels: readonly number[], price: number): number[] {
  const merged: number[] = [];
  for (const L of [...levels].sort((a, b) => a - b)) {
    const last = merged[merged.length - 1];
    if (last != null && Math.abs(L - last) / last < MERGE_PCT) continue;
    merged.push(L);
  }
  return merged.sort((a, b) => Math.abs(a - price) - Math.abs(b - price)).slice(0, MAX_LEVELS);
}

/** The rule itself, on a given list of level prices (the levels at their breaks in the app; a fixture's own level in a test). `targets` are the levels a target is picked from (the chart's own at the retest; defaults to `levels`). */
export function flipFromLevels(candles: readonly OHLCV[], levels: readonly number[], targets: readonly number[] = levels): StrategyResult {
  const n = candles.length;
  if (n < 4) return WAIT;
  const k = n - 1, last = candles[k];
  const from = Math.max(1, k - LOOKBACK);
  // ATR(14) at each candle (the plain mean of the last 14 true ranges up to it), computed once: a break must close at least MIN_BREAK_ATR of it beyond the level.
  const atr = candles.map((_, i) => atr14(candles.slice(Math.max(0, i - 14), i + 1), 14));
  let best: { broke: number; dir: 'long' | 'short'; level: number } | null = null;
  for (const L of levels) {
    let upBreak = -1, downBreak = -1;
    for (let i = from; i <= k; i++) {
      const m = MIN_BREAK_ATR * atr[i], mp = MIN_BREAK_ATR * atr[i - 1];
      if (candles[i].close >= L + m && !(candles[i - 1].close >= L + mp)) upBreak = i;
      if (candles[i].close <= L - m && !(candles[i - 1].close <= L - mp)) downBreak = i;
    }
    // BUY: the latest break was upward; the first candle at least MIN_BARS_BETWEEN + 1 candles after it that touches L is the last one, closing back above.
    if (upBreak >= 0 && upBreak > downBreak && upBreak < k) {
      let first = -1;
      for (let i = upBreak + MIN_BARS_BETWEEN + 1; i <= k; i++) if (candles[i].low <= L) { first = i; break; }
      if (first === k && last.close > L && (!best || upBreak > best.broke)) best = { broke: upBreak, dir: 'long', level: L };
    }
    if (downBreak >= 0 && downBreak > upBreak && downBreak < k) {
      let first = -1;
      for (let i = downBreak + MIN_BARS_BETWEEN + 1; i <= k; i++) if (candles[i].high >= L) { first = i; break; }
      if (first === k && last.close < L && (!best || downBreak > best.broke)) best = { broke: downBreak, dir: 'short', level: L };
    }
  }
  if (!best) return WAIT;
  const { dir, level } = best;
  const entry = last.close;
  const stop = dir === 'long' ? Math.min(level, last.low) : Math.max(level, last.high);
  const others = targets.filter(p => p !== level);
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
