import type { OHLCV } from '../strategyCore.ts';
import { tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* ASIA / LONDON SESSION SWEEP (owner decision 2026-11-17, #1263; hours confirmed with QA's oracle). Closed candles only, UTC.
 *  Asia is 00:00-08:00 and London 07:00-12:00 UTC. A session's RANGE is the lowest low and highest high of the candles that OPEN inside it, on the last candle's UTC day.
 *  The call is on the last closed candle when it opens from 0 to 4 hours after the session ends (hour end to end+4):
 *  BUY:  its low is below the session low and it CLOSES back at or above the session low (a wick below, back inside).
 *  SELL: its high is above the session high and it CLOSES at or below the session high.
 *  Entry  = the close.
 *  Stop   = the sweep wick: the candle's low (BUY) / high (SELL).
 *  Target = the opposite side of the session range.
 *  Needs candles of 1h or finer (5m to 1h), and at least 80% of the session's candles present. Anything coarser, an incomplete session or no sweep: wait. Signals, not predictions. */

export const MIN_CANDLES = 12;
const H = 3_600_000;
const COVERAGE = 0.8;
export const SESSIONS = [{ id: 'asia', startH: 0, endH: 8 }, { id: 'london', startH: 7, endH: 12 }] as const;

export function detectSessionSweep(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES || !(ctx.tfMs > 0) || ctx.tfMs > H) return WAIT;
  const x = candles[n - 1];
  const d = new Date(x.time);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hr = d.getUTCHours();
  for (const s of SESSIONS) {
    if (hr < s.endH || hr > s.endH + 4) continue;
    const inS = candles.filter(c => c.time >= day + s.startH * H && c.time < day + s.endH * H);
    if (inS.length < COVERAGE * (((s.endH - s.startH) * H) / ctx.tfMs)) continue;
    const lo = Math.min(...inS.map(c => c.low)), hi = Math.max(...inS.map(c => c.high));
    const fromTs = inS[0].time;
    const edges = (up: boolean) => [{ price: up ? hi : lo, role: 'ref' as const, fromTs, labelKey: (up ? 'STRAT_OV_SESSION_HIGH' : 'STRAT_OV_SESSION_LOW') as 'STRAT_OV_SESSION_HIGH' | 'STRAT_OV_SESSION_LOW' }];
    if (x.low < lo && x.close >= lo) return tradeCall({ ts: x.time, dir: 'long', entry: x.close, stop: x.low, target: hi, params: { sessionLo: lo, sessionHi: hi }, levels: edges(false) });
    if (x.high > hi && x.close <= hi) return tradeCall({ ts: x.time, dir: 'short', entry: x.close, stop: x.high, target: lo, params: { sessionLo: lo, sessionHi: hi }, levels: edges(true) });
  }
  return WAIT;
}

export const SESSION_SWEEP: StrategyDef = {
  id: 'session_sweep',
  nameKey: 'STRAT_SESSION_NAME',
  descKey: 'STRAT_SESSION_DESC',
  reasonBuyKey: 'STRAT_SESSION_BUY',
  reasonSellKey: 'STRAT_SESSION_SELL',
  reasonWaitKey: 'STRAT_SESSION_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['5m', '15m', '1h'],
  detect: detectSessionSweep,
};
