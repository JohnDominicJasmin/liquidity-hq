import { emaArr, type OHLCV } from '../strategyCore';
import type { LabelKey } from '../labelKeys';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types';

/* EMA 20 / 50 / 100 / 200 STACK, TRADED ON THE PULLBACK (owner-requested, 2026-11-14: trade WITH the stack, wait for price to pull back to the 20 or 50 and show a
 * confirmation, enter in the trend direction). Deterministic rules, closed candles only.
 *
 *  A BULLISH STACK is EMA20 > EMA50 > EMA100 > EMA200 in that order; a BEARISH STACK is the reverse.
 *
 *  PULLBACK (the main signal), in an established stack:
 *    BUY:  a candle's low reaches the 20 (or the 50) and it CLOSES back above the 20. Price dipped into the zone and was bought back.
 *    SELL: the mirror: the high reaches the 20 (or the 50) and the candle closes back below the 20.
 *  FRESH FORMATION (secondary): the closed candle where the full stack first formed, with the close on the right side of the 20.
 *  Either is current only while its candle is one of the last FRESH_BARS closed candles and the stack still holds. params.pullback tells which one fired
 *  (true = pullback, false = formation); params.tag says whether a pullback reached the 20 or the 50. Needs enough history for a settled EMA200.
 *  Signals, not predictions: this says how price sits against the averages, not where it goes next. */

export const FRESH_BARS = 3;
export const MIN_CANDLES = 230;

type Side = 'long' | 'short';

function orderSide(e20: number, e50: number, e100: number, e200: number): Side | null {
  if (![e20, e50, e100, e200].every(Number.isFinite)) return null;
  if (e20 > e50 && e50 > e100 && e100 > e200) return 'long';
  if (e20 < e50 && e50 < e100 && e100 < e200) return 'short';
  return null;
}

export function detectEmaStack(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const closes = candles.map(c => c.close);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e100 = emaArr(closes, 100), e200 = emaArr(closes, 200);
  const order = (i: number) => orderSide(e20[i], e50[i], e100[i], e200[i]);
  const now = order(n - 1);
  if (!now) return WAIT;
  const up = now === 'long';
  const params = (i: number, pullback: boolean, tag: number, inv: number) => ({ pullback, tag, ema20: e20[i], ema50: e50[i], ema100: e100[i], ema200: e200[i], inv });
  const result = (i: number, pullback: boolean, tag: number, inv: number): StrategyResult => ({
    verdict: up ? 'buy' : 'sell', signalTimestamp: candles[i].time, signalDir: now, params: params(n - 1, pullback, tag, inv),
  });

  // PULLBACK: the latest candle (within FRESH_BARS) that reached the 20 and closed back on the trend side of it, with the stack in order on that candle.
  for (let i = n - 1; i >= n - FRESH_BARS; i--) {
    if (order(i) !== now) break;
    const c = candles[i];
    const touched = up ? c.low <= e20[i] && c.close > e20[i] : c.high >= e20[i] && c.close < e20[i];
    if (!touched) continue;
    const reached50 = up ? c.low <= e50[i] : c.high >= e50[i];
    // A candle that went through the 100 has not pulled back into the zone, it has broken it.
    if (up ? c.low < e100[i] : c.high > e100[i]) continue;
    return result(i, true, reached50 ? 50 : 20, up ? c.low : c.high);
  }

  // FRESH FORMATION: the first candle of the current unbroken stack-with-close-on-the-right-side run.
  const holds = (i: number) => order(i) === now && (up ? closes[i] > e20[i] : closes[i] < e20[i]);
  if (holds(n - 1)) {
    let first = n - 1;
    while (first - 1 >= 0 && holds(first - 1)) first--;
    if (first >= n - FRESH_BARS) return result(first, false, 0, e50[n - 1]);
  }
  return WAIT;
}

export const EMA_STACK: StrategyDef = {
  id: 'ema_stack',
  nameKey: 'STRAT_EMASTACK_NAME',
  descKey: 'STRAT_EMASTACK_DESC',
  reasonBuyKey: 'STRAT_EMASTACK_BUY',
  reasonSellKey: 'STRAT_EMASTACK_SELL',
  reasonWaitKey: 'STRAT_EMASTACK_WAIT',
  reasonKeyFor: (r): LabelKey | null => (r.params.pullback === true ? (r.verdict === 'buy' ? 'STRAT_EMASTACK_BUY_PULLBACK' : 'STRAT_EMASTACK_SELL_PULLBACK') : null),
  minCandles: MIN_CANDLES,
  logTfs: ['15m', '1h', '4h'],
  detect: detectEmaStack,
};
