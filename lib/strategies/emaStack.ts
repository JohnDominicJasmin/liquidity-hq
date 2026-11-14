import { emaArr, type OHLCV } from '../strategyCore';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types';

/* EMA 20 / 50 / 100 / 200 STACK (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  BULLISH STACK: EMA20 > EMA50 > EMA100 > EMA200, in that order, with the candle closing above EMA20.
 *  BEARISH STACK: EMA20 < EMA50 < EMA100 < EMA200, with the candle closing below EMA20.
 *
 *  The signal is the closed candle where the full stack FIRST formed. It is current only while that candle is one of the last FRESH_BARS closed candles and the
 *  stack still holds on the latest one. A stack that has been in place for long is a trend already running, not a new signal: it reads wait (the card says so).
 *  Needs enough history for a settled EMA200.
 *  Signals, not predictions: this says how the averages are ordered, not where price goes next. */

export const FRESH_BARS = 3;
export const MIN_CANDLES = 230;

type Side = 'long' | 'short';

function stackSide(e20: number, e50: number, e100: number, e200: number, close: number): Side | null {
  if (![e20, e50, e100, e200].every(Number.isFinite)) return null;
  if (e20 > e50 && e50 > e100 && e100 > e200 && close > e20) return 'long';
  if (e20 < e50 && e50 < e100 && e100 < e200 && close < e20) return 'short';
  return null;
}

export function detectEmaStack(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const closes = candles.map(c => c.close);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e100 = emaArr(closes, 100), e200 = emaArr(closes, 200);
  const sideAt = (i: number) => stackSide(e20[i], e50[i], e100[i], e200[i], closes[i]);
  const now = sideAt(n - 1);
  if (!now) return WAIT;
  // Walk back while the same stack held; the formation candle is the first of that run.
  let first = n - 1;
  while (first - 1 >= 0 && sideAt(first - 1) === now) first--;
  if (first < n - FRESH_BARS) return WAIT;
  return {
    verdict: now === 'long' ? 'buy' : 'sell',
    signalTimestamp: candles[first].time,
    signalDir: now,
    params: { ema20: e20[n - 1], ema50: e50[n - 1], ema100: e100[n - 1], ema200: e200[n - 1], inv: e50[n - 1] },
  };
}

export const EMA_STACK: StrategyDef = {
  id: 'ema_stack',
  nameKey: 'STRAT_EMASTACK_NAME',
  descKey: 'STRAT_EMASTACK_DESC',
  reasonBuyKey: 'STRAT_EMASTACK_BUY',
  reasonSellKey: 'STRAT_EMASTACK_SELL',
  reasonWaitKey: 'STRAT_EMASTACK_WAIT',
  minCandles: MIN_CANDLES,
  logTfs: ['15m', '1h', '4h'],
  detect: detectEmaStack,
};
