import { emaArr, type OHLCV } from '../strategyCore.ts';
import type { LabelKey } from '../labelKeys.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyOverlay, type StrategyResult } from './types.ts';

/* EMA 20 / 50 / 100 / 200 STACK, SIGNALLED ON ITS FORMATION (owner-requested 2026-11-14 as a pullback strategy; PM, 2026-11-19: the pullback signal and a stack that re-armed on every wobble fired on 15-20% of candles at 1h / 2h / 4h in a
 * real-data audit, too noisy to trade). Deterministic rules, closed candles only.
 *
 *  A BULLISH STACK is EMA20 > EMA50 > EMA100 > EMA200 in that order; a BEARISH STACK is the reverse.
 *  FORMATION (the only signal): the closed candle where the full stack forms, with the close on the right side of the 20 (above it for a bullish stack, below it for a bearish one), and only if the stack had been OUT of that order for
 *    at least MIN_UNSTACKED = 10 candles before it. A stack that breaks for a candle or two and re-forms is the same stack and is not a new signal. BUY for a bullish stack, SELL for a bearish one.
 *  The signal is stamped on the formation candle and stays current for FRESH_BARS candles after it while the stack still holds. Needs enough history for a settled EMA200 (MIN_CANDLES).
 *  DETAILS THE RULE HIDES: the four EMAs are SMA-SEEDED (each starts at the plain average of its first `period` closes, lib/strategyCore.ts emaArr), unlike the cross strategy's first-close seed. "Formation" means the FIRST candle of the
 *    current unbroken run of 'stack in order with the close on the trend side of the 20'.
 *  Measured on 30 days of BTC / ETH / SOL (the audit script): signals per cell 15m 302/377/380 -> 33/35/29 (before the change this also signalled the pullbacks), 1h 108/104/109 -> 7/5/3, 4h 14/19/18 -> 1/1/0. The 10-candle gap is what
 *    cuts it: with no gap the same formation rule gave 137/169/175 at 15m; gaps of 1, 3 and 10 candles give about the same counts, so the stack re-arming is the order breaking and re-forming, not a long absence.
 *  Signals, not predictions: this says how price sits against the averages, not where it goes next. */

export const FRESH_BARS = 3;
export const MIN_CANDLES = 230;
export const MIN_UNSTACKED = 10;   // candles the stack must have been out of order before its formation candle
const EMA_BARS = 120; // how many of the latest bars each drawn EMA line covers

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
  /* The four EMAs themselves (the last EMA_BARS of each), labelled at their right end, whatever the verdict: they are what this strategy reads. */
  /* Only EMA 100 is DRAWN: the chart's own ribbon already draws 20, 50 and 200 (PM ruling, #2372), so those three get just a label at their right end (a line of ONE point is a text tag). */
  const emaLine = (arr: number[], period: number, draw: boolean): StrategyOverlay['lines'][number] => ({
    points: candles.slice(draw ? -EMA_BARS : -1).map((c, k, a) => ({ ts: c.time, price: arr[n - a.length + k] })).filter(p => Number.isFinite(p.price)),
    role: 'ref', labelKey: 'STRAT_OV_EMA', labelParams: { n: String(period) },
  });
  const lines = [emaLine(e20, 20, false), emaLine(e50, 50, false), emaLine(e100, 100, true), emaLine(e200, 200, false)];
  const now = order(n - 1);
  if (!now) return { ...WAIT, overlay: { levels: [], zones: [], lines, marker: null } };
  const up = now === 'long';
  const params = (i: number, pullback: boolean, tag: number, inv: number) => ({ pullback, tag, ema20: e20[i], ema50: e50[i], ema100: e100[i], ema200: e200[i], inv });
  const result = (i: number, pullback: boolean, tag: number, inv: number): StrategyResult => ({
    verdict: up ? 'buy' : 'sell', signalTimestamp: candles[i].time, signalDir: now, params: params(n - 1, pullback, tag, inv),
    overlay: { levels: [{ price: inv, role: 'invalid', fromTs: candles[i].time, labelKey: 'STRAT_OV_INVALID' }], zones: [], lines, marker: { ts: candles[i].time, dir: now } },
  });

  // FRESH FORMATION: the first candle of the current unbroken stack-with-close-on-the-right-side run.
  const holds = (i: number) => order(i) === now && (up ? closes[i] > e20[i] : closes[i] < e20[i]);
  if (holds(n - 1)) {
    let first = n - 1;
    while (first - 1 >= 0 && holds(first - 1)) first--;
    /* A ONE-CANDLE WOBBLE DOES NOT RE-ARM IT (PM, 2026-11-19; a real-data audit found 15-20% of candles signalling at 1h / 2h / 4h): the stack must have been OUT of this order for at least MIN_UNSTACKED candles before
       the formation candle. A stack that breaks for a candle or two and re-forms is the same stack. */
    const quietFrom = first - MIN_UNSTACKED;
    if (quietFrom >= 0) {
      let quiet = true;
      for (let q = quietFrom; q < first; q++) if (order(q) === now) { quiet = false; break; }
      if (quiet && first >= n - FRESH_BARS) return result(first, false, 0, e50[n - 1]);
    }
  }
  return { ...WAIT, overlay: { levels: [], zones: [], lines, marker: null } };
}

export const EMA_STACK: StrategyDef = {
  id: 'ema_stack',
  nameKey: 'STRAT_EMASTACK_NAME',
  descKey: 'STRAT_EMASTACK_DESC',
  reasonBuyKey: 'STRAT_EMASTACK_BUY',
  reasonSellKey: 'STRAT_EMASTACK_SELL',
  reasonWaitKey: 'STRAT_EMASTACK_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['15m', '1h', '4h'],
  detect: detectEmaStack,
};
