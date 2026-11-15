import { bollingerBandsArr, type OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* BOLLINGER SQUEEZE BREAKOUT (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  Bands are the usual 20-candle average with 2 standard deviations. BANDWIDTH is (upper - lower) / middle.
 *  A SQUEEZE candle is one whose bandwidth is at or below the SQUEEZE_PCT-th percentile of the bandwidth of the HISTORY candles before it: the bands are unusually tight.
 *  BUY:  a candle CLOSES above the upper band, the previous candle did not, and at least SQUEEZE_BARS of the LOOKBACK candles before it were squeeze candles.
 *  SELL: the mirror below the lower band.
 *  Current only while that candle is one of the last FRESH_BARS closed candles.
 *  Signals, not predictions: a squeeze says price has been quiet, not which way it will leave. */

export const LENGTH = 20;
export const MULT = 2;
export const HISTORY = 100;
export const SQUEEZE_PCT = 20;
export const SQUEEZE_BARS = 5;
export const LOOKBACK = 8;
export const FRESH_BARS = 2;
export const MIN_CANDLES = LENGTH + HISTORY + LOOKBACK + 2;

export function detectBollingerSqueeze(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const closes = candles.map(c => c.close);
  const bb = bollingerBandsArr(closes, LENGTH, MULT);
  const bw = bb.map(b => (b && b.mid > 0 ? (b.up - b.dn) / b.mid : NaN));
  const squeezed = (i: number): boolean => {
    if (!Number.isFinite(bw[i])) return false;
    const hist = bw.slice(i - HISTORY, i).filter(Number.isFinite);
    if (hist.length < HISTORY * 0.9) return false;
    const below = hist.filter(v => v < bw[i]).length;
    return (below / hist.length) * 100 <= SQUEEZE_PCT;
  };
  for (let k = n - 1; k >= n - FRESH_BARS; k--) {
    const b = bb[k], p = bb[k - 1];
    if (!b || !p) continue;
    const up = closes[k] > b.up && !(closes[k - 1] > p.up);
    const dn = closes[k] < b.dn && !(closes[k - 1] < p.dn);
    if (!up && !dn) continue;
    let sq = 0;
    for (let i = k - LOOKBACK; i < k; i++) if (squeezed(i)) sq++;
    if (sq < SQUEEZE_BARS) continue;
    return {
      verdict: up ? 'buy' : 'sell', signalTimestamp: candles[k].time, signalDir: up ? 'long' : 'short',
      params: { band: up ? b.up : b.dn, mid: b.mid, countSqueeze: sq, inv: b.mid },
    };
  }
  return WAIT;
}

export const BOLLINGER_SQUEEZE: StrategyDef = {
  id: 'bb_squeeze',
  nameKey: 'STRAT_BBSQ_NAME',
  descKey: 'STRAT_BBSQ_DESC',
  reasonBuyKey: 'STRAT_BBSQ_BUY',
  reasonSellKey: 'STRAT_BBSQ_SELL',
  reasonWaitKey: 'STRAT_BBSQ_WAIT',
  minCandles: MIN_CANDLES,
  chips: ['BOLL'],
  logTfs: ['15m', '1h', '4h'],
  detect: detectBollingerSqueeze,
};
