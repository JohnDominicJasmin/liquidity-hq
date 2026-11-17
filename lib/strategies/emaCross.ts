import type { OHLCV } from '../strategyCore.ts';
import { emaSeeded, nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* GOLDEN / DEATH CROSS, EMA 50 / 200 (owner decision 2026-11-17, #1263). Closed candles only.
 *  BUY:  on the last closed candle the 50 EMA is above the 200 EMA and on the candle before it was not (a golden cross).
 *  SELL: the reverse (a death cross).
 *  Entry  = that candle's close.
 *  Stop   = the lowest low (BUY) / highest high (SELL) of the last 20 candles ending at it.
 *  Target = the nearest support / resistance level in the trade's direction (the levels the chart draws); none means no target and no R:R.
 *  The EMAs use the standard 2/(n+1) smoothing seeded with the first close, so the cross lands on the same candle as QA's oracle. Signals, not predictions: this says what the averages did. */

export const MIN_CANDLES = 201;
const STOP_WINDOW = 20;

export function detectEmaCross(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const cl = candles.map(c => c.close);
  const e50 = emaSeeded(cl, 50), e200 = emaSeeded(cl, 200), k = n - 1;
  const up = e50[k] > e200[k] && !(e50[k - 1] > e200[k - 1]);
  const dn = e50[k] < e200[k] && !(e50[k - 1] < e200[k - 1]);
  if (!up && !dn) return WAIT;
  const dir = up ? 'long' : 'short';
  const entry = candles[k].close;
  const win = candles.slice(k - STOP_WINDOW + 1, k + 1);
  const stop = up ? Math.min(...win.map(c => c.low)) : Math.max(...win.map(c => c.high));
  if (up ? !(stop < entry) : !(stop > entry)) return WAIT;   // a flat window has no stop on the losing side
  const target = nearestLevel(srPrices(candles, entry), entry, dir);
  return tradeCall({ ts: candles[k].time, dir, entry, stop, target, params: { ema50: e50[k], ema200: e200[k] } });
}

export const EMA_CROSS: StrategyDef = {
  id: 'ema_cross',
  nameKey: 'STRAT_CROSS_NAME',
  descKey: 'STRAT_CROSS_DESC',
  reasonBuyKey: 'STRAT_CROSS_BUY',
  reasonSellKey: 'STRAT_CROSS_SELL',
  reasonWaitKey: 'STRAT_CROSS_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['1h', '4h'],
  detect: detectEmaCross,
};
