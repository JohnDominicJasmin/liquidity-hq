import { emaArr, type OHLCV } from '../strategyCore.ts';
import type { LabelKey } from '../labelKeys.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* SUPPLY / DEMAND ZONE RETEST, WITH A BTC CHECK (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  An IMPULSE is a candle whose body is at least IMPULSE_ATR times the average true range of the ATR_LEN candles before it, and which closes beyond the whole range of the
 *    candle just before it (the BASE). A bullish impulse leaves a DEMAND zone = the base candle's range; a bearish one leaves a SUPPLY zone.
 *  A zone is alive until a candle closes through its far side. It is used ONCE: the first candle after the impulse that trades back into the zone is the retest.
 *  BUY:  the retest candle's low reaches the demand zone (at or below its top) and it CLOSES back above the zone's top, a rejection. SELL: the mirror on a supply zone.
 *  Current only while the retest candle is one of the last FRESH_BARS closed candles.
 *  BTC CHECK (every coin except BTC): a buy needs BTC to close above its own EMA50 on the same timeframe, a sell needs BTC below it. If BTC is against the trade the answer is
 *    wait and the reason says so. Without BTC candles the strategy does not answer (the caller treats that as unknown, never as wait).
 *  Signals, not predictions: this says what price did at a level, not what it will do. */

export const ATR_LEN = 14;
export const IMPULSE_ATR = 1.5;
export const LOOKBACK = 80;
export const FRESH_BARS = 2;
export const BTC_EMA = 50;
export const MIN_CANDLES = 60;

function atrBefore(c: readonly OHLCV[], j: number): number {
  let sum = 0;
  for (let k = j - ATR_LEN; k < j; k++) sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
  return sum / ATR_LEN;
}

/** +1 when BTC's last close is above its EMA50, -1 below, 0 when not enough data. */
export function btcSide(btc: readonly OHLCV[] | undefined): 1 | -1 | 0 {
  if (!btc || btc.length < BTC_EMA + 5) return 0;
  const closes = btc.map(c => c.close);
  const e = emaArr(closes, BTC_EMA)[closes.length - 1];
  if (!Number.isFinite(e)) return 0;
  return closes[closes.length - 1] > e ? 1 : closes[closes.length - 1] < e ? -1 : 0;
}

export function detectSupplyDemand(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  let best: { k: number; up: boolean; zHi: number; zLo: number } | null = null;
  for (let j = n - 3; j >= Math.max(ATR_LEN + 1, n - LOOKBACK); j--) {
    const atr = atrBefore(candles, j);
    const c = candles[j], base = candles[j - 1];
    if (!(atr > 0) || Math.abs(c.close - c.open) < IMPULSE_ATR * atr) continue;
    const up = c.close > c.open;
    if (up ? !(c.close > base.high) : !(c.close < base.low)) continue;
    const zHi = base.high, zLo = base.low;
    for (let k = j + 1; k < n; k++) {
      const x = candles[k];
      if (up ? x.close < zLo : x.close > zHi) break;                     // zone broken
      const touched = up ? x.low <= zHi : x.high >= zLo;
      if (!touched) continue;
      const rejected = up ? x.close > zHi : x.close < zLo;               // first touch decides: used once
      if (rejected && k >= n - FRESH_BARS && (!best || k > best.k)) best = { k, up, zHi, zLo };
      break;
    }
  }
  if (!best) return WAIT;
  const isBtc = ctx.coin === 'btc';
  const side = isBtc ? (best.up ? 1 : -1) : btcSide(ctx.btcCandles);
  const params: Record<string, number | boolean> = { zoneHi: best.zHi, zoneLo: best.zLo, inv: best.up ? best.zLo : best.zHi, btcChecked: !isBtc };
  if (!isBtc && side === 0) return { ...WAIT, params: { ...params, btcUnknown: true } };
  if (side !== (best.up ? 1 : -1)) return { ...WAIT, params: { ...params, btcBlocked: true } };
  return { verdict: best.up ? 'buy' : 'sell', signalTimestamp: candles[best.k].time, signalDir: best.up ? 'long' : 'short', params };
}

export const SUPPLY_DEMAND: StrategyDef = {
  id: 'supply_demand',
  nameKey: 'STRAT_SD_NAME',
  descKey: 'STRAT_SD_DESC',
  reasonBuyKey: 'STRAT_SD_BUY',
  reasonSellKey: 'STRAT_SD_SELL',
  reasonWaitKey: 'STRAT_SD_WAIT',
  reasonKeyFor: (r): LabelKey | null => (r.params.btcBlocked === true ? 'STRAT_SD_WAIT_BTC' : r.verdict === 'wait' ? null : r.params.btcChecked === true ? (r.verdict === 'buy' ? 'STRAT_SD_BUY_BTC' : 'STRAT_SD_SELL_BTC') : null),
  needsBtc: true,
  minCandles: MIN_CANDLES,
  logTfs: ['15m', '1h', '4h'],
  detect: detectSupplyDemand,
};
