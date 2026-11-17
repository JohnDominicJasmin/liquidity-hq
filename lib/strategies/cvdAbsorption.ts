import type { OHLCV } from '../strategyCore.ts';
import { atr14, nearestLevel, srPrices, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* CVD ABSORPTION (owner decision 2026-11-17, #1263; rules agreed with PM, QA oracle qa/fixtures/strategyFixtures2.ts). Closed candles plus per-candle TAKER volume (Binance klines only), supplied as ctx.taker.
 *  Taker delta per candle = taker buy volume - taker sell volume. THE WINDOW is always the 8 candles immediately BEFORE the trigger candle. Its summed delta is compared with the 100 rolling 8-candle sums that end before the window (z = (delta - mean) / sd).
 *  BUY:  z <= -1.5 (sellers hit the bid), AND price HELD: the window's lowest low is no more than 0.2 ATR below the lowest low of the 20 candles before the window, and its net price change (last close - first open) is at least -0.3 ATR;
 *        TRIGGER = a candle that closes above the previous candle's high.
 *  SELL: the mirror (z >= +1.5, the window's highest high no more than 0.2 ATR above the prior 20-candle high, net change at most +0.3 ATR, trigger = a close below the previous candle's low).
 *  The trigger candle is the last closed candle. Entry = its close. Stop = the window low (BUY) / high (SELL). Target = the first support / resistance level at least one risk distance away, else none (no R:R).
 *  ATR is the 14-candle average true range. A coin without the taker split (Bybit-only) answers wait with "needs taker data". Thresholds (8 candles, 1.5 sigma, 0.2 / 0.3 ATR) are unmeasured proposals: every fire is logged with its sigma and window so they can be tuned.
 *  Signals, not predictions: this says what the flow and the candles did. */

export const MIN_CANDLES = 132;
const WINDOW = 8, HISTORY = 100, Z_MIN = 1.5, HOLD_ATR = 0.2, NET_ATR = 0.3, PRIOR = 20;

export function detectCvdAbsorption(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const taker = ctx.taker;
  if (!taker || taker.size === 0) return { ...WAIT, params: { noTaker: true } };
  const delta = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = taker.get(candles[i].time);
    if (!t) { delta[i] = NaN; continue; }
    delta[i] = t.buy - t.sell;
  }
  const sumAt = (e: number) => { let s = 0; for (let i = e - WINDOW + 1; i <= e; i++) s += delta[i]; return s; };
  /* THE TRIGGER IS THE LAST CLOSED CANDLE (QA's oracle: the window is the 8 candles immediately before it, so a trigger one candle earlier would treat the window's own last candle as the trigger and fire on any steady drift). */
  for (const k of [n - 1]) {
    const end = k - 1;
    if (end - HISTORY - WINDOW + 1 < 0 || end - WINDOW - PRIOR + 1 < 0) continue;
    const prev: number[] = [];
    for (let e = end - HISTORY; e < end; e++) prev.push(sumAt(e));
    const cur = sumAt(end);
    if (!Number.isFinite(cur) || prev.some(v => !Number.isFinite(v))) return { ...WAIT, params: { noTaker: true } };
    const mean = prev.reduce((a, v) => a + v, 0) / prev.length;
    const sd = Math.sqrt(prev.reduce((a, v) => a + (v - mean) ** 2, 0) / prev.length);
    if (!(sd > 0)) continue;
    const z = (cur - mean) / sd;
    const win = candles.slice(end - WINDOW + 1, end + 1), before = candles.slice(end - WINDOW - PRIOR + 1, end - WINDOW + 1);
    const a = atr14(candles.slice(0, end + 1));
    const net = win[win.length - 1].close - win[0].open;
    const winLow = Math.min(...win.map(c => c.low)), winHigh = Math.max(...win.map(c => c.high));
    const x = candles[k], p = candles[k - 1];
    if (z <= -Z_MIN && winLow >= Math.min(...before.map(c => c.low)) - HOLD_ATR * a && net >= -NET_ATR * a && x.close > p.high) {
      const entry = x.close, risk = entry - winLow;
      if (!(risk > 0)) continue;
      return tradeCall({ ts: x.time, dir: 'long', entry, stop: winLow, target: nearestLevel(srPrices(candles, entry), entry, 'long', risk), params: { n: WINDOW, low: winLow, trigger: p.high, sigma: Math.round(z * 100) / 100 } });
    }
    if (z >= Z_MIN && winHigh <= Math.max(...before.map(c => c.high)) + HOLD_ATR * a && net <= NET_ATR * a && x.close < p.low) {
      const entry = x.close, risk = winHigh - entry;
      if (!(risk > 0)) continue;
      return tradeCall({ ts: x.time, dir: 'short', entry, stop: winHigh, target: nearestLevel(srPrices(candles, entry), entry, 'short', risk), params: { n: WINDOW, high: winHigh, trigger: p.low, sigma: Math.round(z * 100) / 100 } });
    }
  }
  return WAIT;
}

export const CVD_ABSORPTION: StrategyDef = {
  id: 'cvd_absorption',
  nameKey: 'STRAT_CVD_NAME',
  descKey: 'STRAT_CVD_DESC',
  reasonBuyKey: 'STRAT_CVD_BUY',
  reasonSellKey: 'STRAT_CVD_SELL',
  reasonWaitKey: 'STRAT_CVD_WAIT',
  reasonKeyFor: r => (r.params.noTaker ? 'STRAT_CVD_NO_TAKER' : null),
  needsTaker: true,
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['1h', '4h'],
  detect: detectCvdAbsorption,
};
