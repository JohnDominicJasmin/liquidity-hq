import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* LIQUIDITY SWEEP + MARKET STRUCTURE SHIFT (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  A SWING HIGH/LOW is a candle whose high (low) is strictly beyond the SWING candles on each side; it counts only once those later candles have closed.
 *  A SWEEP is a candle that pokes beyond the most recent confirmed swing (a wick through it) and then CLOSES back inside it: stops resting beyond the level were taken
 *    and price did not stay there.
 *  A STRUCTURE SHIFT is a later candle that CLOSES through the most recent opposite swing that stood before the sweep: the move the other way is confirmed.
 *
 *    SELL: a swing HIGH is swept (high above it, close back below it), then a candle closes BELOW the latest swing LOW that stood before the sweep.
 *    BUY:  the mirror image on a swing LOW, then a close ABOVE the latest swing HIGH.
 *
 *  The signal is the candle that closes through the structure level. It is current only while that candle is one of the last FRESH_BARS closed candles; older is wait.
 *  Liquidation clusters, where the caller has them, only add a note when one sat within LIQ_TOLERANCE of the swept level; they never create or cancel a signal.
 *  Signals, not predictions: this says what the candles did, not what price will do. */

export const SWING = 3;          // candles each side that must be lower/higher
export const LOOKBACK = 80;      // how far back a swing may stand
export const SWEEP_WINDOW = 12;  // how far back the sweep candle may be
export const FRESH_BARS = 2;     // the shift must be one of the last N closed candles
export const LIQ_TOLERANCE = 0.003;

function isSwingHigh(c: readonly OHLCV[], j: number): boolean {
  for (let k = 1; k <= SWING; k++) if (!(c[j].high > c[j - k].high && c[j].high > c[j + k].high)) return false;
  return true;
}
function isSwingLow(c: readonly OHLCV[], j: number): boolean {
  for (let k = 1; k <= SWING; k++) if (!(c[j].low < c[j - k].low && c[j].low < c[j + k].low)) return false;
  return true;
}
/** Index of the most recent swing confirmed BEFORE candle i (j + SWING < i), within LOOKBACK, or -1. */
function lastSwing(c: readonly OHLCV[], i: number, kind: 'high' | 'low'): number {
  for (let j = i - SWING - 1; j >= Math.max(SWING, i - LOOKBACK); j--) {
    if (kind === 'high' ? isSwingHigh(c, j) : isSwingLow(c, j)) return j;
  }
  return -1;
}

function nearLiq(ctx: StrategyContext, level: number): boolean {
  return !!ctx.liqLevels?.some(p => Number.isFinite(p) && level > 0 && Math.abs(p - level) / level <= LIQ_TOLERANCE);
}

export function detectLiquiditySweepMss(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < 30) return WAIT;
  let best: StrategyResult | null = null;
  let bestK = -1;
  for (let i = n - 2; i >= Math.max(SWING * 2 + 1, n - 1 - SWEEP_WINDOW); i--) {
    const sIdx = lastSwing(candles, i, 'high');
    const lIdx = lastSwing(candles, i, 'low');
    if (sIdx < 0 || lIdx < 0) continue;
    const S = candles[sIdx].high;
    const L = candles[lIdx].low;
    // SELL: swing high swept, then a close below the swing low that stood before the sweep.
    if (candles[i].high > S && candles[i].close < S) {
      for (let k = i + 1; k < n; k++) {
        if (candles[k].close < L) {
          if (k >= n - FRESH_BARS && k > bestK) {
            const inv = Math.max(...candles.slice(i, k + 1).map(b => b.high));
            best = { verdict: 'sell', signalTimestamp: candles[k].time, signalDir: 'short', params: { swept: S, mss: L, inv, liq: nearLiq(ctx, S) } };
            bestK = k;
          }
          break;
        }
      }
    }
    // BUY: swing low swept, then a close above the swing high that stood before the sweep.
    if (candles[i].low < L && candles[i].close > L) {
      for (let k = i + 1; k < n; k++) {
        if (candles[k].close > S) {
          if (k >= n - FRESH_BARS && k > bestK) {
            const inv = Math.min(...candles.slice(i, k + 1).map(b => b.low));
            best = { verdict: 'buy', signalTimestamp: candles[k].time, signalDir: 'long', params: { swept: L, mss: S, inv, liq: nearLiq(ctx, L) } };
            bestK = k;
          }
          break;
        }
      }
    }
  }
  return best ?? WAIT;
}

export const LIQUIDITY_SWEEP_MSS: StrategyDef = {
  id: 'liq_sweep_mss',
  nameKey: 'STRAT_LIQ_SWEEP_NAME',
  descKey: 'STRAT_LIQ_SWEEP_DESC',
  reasonBuyKey: 'STRAT_LIQ_SWEEP_BUY',
  reasonSellKey: 'STRAT_LIQ_SWEEP_SELL',
  reasonWaitKey: 'STRAT_LIQ_SWEEP_WAIT',
  minCandles: 30,
  logTfs: ['15m', '1h', '4h'],
  detect: detectLiquiditySweepMss,
};
