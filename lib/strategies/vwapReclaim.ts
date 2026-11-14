import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* VWAP RECLAIM (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  VWAP here is the SESSION VWAP: volume-weighted average of the typical price ((high + low + close) / 3) from 00:00 UTC of the candle's day, reset each day.
 *  BUY (reclaim): a candle CLOSES above VWAP after at least BELOW_BARS consecutive closes below it.
 *  SELL (loss):   a candle CLOSES below VWAP after at least BELOW_BARS consecutive closes above it.
 *  Current only while that candle is one of the last FRESH_BARS closed candles and the session has at least MIN_SESSION_BARS closed candles.
 *  Works on timeframes up to 1h (a 4h or daily session holds too few candles) and says wait on anything coarser.
 *  Signals, not predictions: this says which side of the day's average price paid, not where price goes next. */

export const BELOW_BARS = 3;
export const FRESH_BARS = 2;
export const MIN_SESSION_BARS = 6;
const DAY = 86_400_000;

export function detectVwapReclaim(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < 10 || !(ctx.tfMs > 0) || ctx.tfMs > 3_600_000) return WAIT;
  const dayOf = (t: number) => Math.floor(t / DAY);
  const day = dayOf(candles[n - 1].time);
  let start = n - 1;
  while (start - 1 >= 0 && dayOf(candles[start - 1].time) === day) start--;
  const session = candles.slice(start);
  if (session.length < MIN_SESSION_BARS) return WAIT;
  const vwap: number[] = [];
  let pv = 0, vol = 0;
  for (const c of session) {
    const v = c.volume > 0 ? c.volume : 0;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;
    vwap.push(vol > 0 ? pv / vol : NaN);
  }
  if (!Number.isFinite(vwap[vwap.length - 1])) return WAIT;
  const m = session.length;
  const side = (i: number): 1 | -1 | 0 => (!Number.isFinite(vwap[i]) ? 0 : session[i].close > vwap[i] ? 1 : session[i].close < vwap[i] ? -1 : 0);
  for (let k = m - 1; k >= Math.max(1, m - FRESH_BARS); k--) {
    const s = side(k);
    if (s === 0) continue;
    let run = 0;
    for (let i = k - 1; i >= 0 && side(i) === -s; i--) run++;
    if (run < BELOW_BARS) continue;
    return {
      verdict: s === 1 ? 'buy' : 'sell', signalTimestamp: session[k].time, signalDir: s === 1 ? 'long' : 'short',
      params: { vwap: vwap[k], countBars: run, inv: vwap[k] },
    };
  }
  return WAIT;
}

export const VWAP_RECLAIM: StrategyDef = {
  id: 'vwap_reclaim',
  nameKey: 'STRAT_VWAP_NAME',
  descKey: 'STRAT_VWAP_DESC',
  reasonBuyKey: 'STRAT_VWAP_BUY',
  reasonSellKey: 'STRAT_VWAP_SELL',
  reasonWaitKey: 'STRAT_VWAP_WAIT',
  minCandles: 10,
  logTfs: ['5m', '15m', '1h'],
  detect: detectVwapReclaim,
};
