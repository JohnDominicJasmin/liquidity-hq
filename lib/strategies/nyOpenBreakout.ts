import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* NEW YORK OPEN BREAKOUT (owner-requested, 2026-11-14). Deterministic rules, closed candles only.
 *
 *  The NEW YORK OPEN is 09:30 New York time on a weekday: 13:30 UTC while the US is on daylight time, 14:30 UTC on standard time. It is computed from the date
 *  (never fixed), so it moves with the clocks.
 *  The OPENING RANGE is the high and low of the first RANGE_MIN minutes from that open. It exists only once those candles have all closed.
 *  BUY:  after the range, the first candle that closes ABOVE the range high.
 *  SELL: the first candle that closes BELOW the range low.
 *  Only the FIRST close outside the range counts that session, and it is current only while it is one of the last FRESH_BARS closed candles. Before the range
 *  is complete, after a session's first breakout has gone stale, or on a day with no open (weekend) the answer is wait. Needs candles of RANGE_MIN or finer
 *  that divide it evenly (5m, 15m, 30m); on anything coarser it says wait.
 *  Signals, not predictions: this says what the candles did, not what price will do. */

export const RANGE_MIN = 30;
export const FRESH_BARS = 2;
const SESSION_MS = 6 * 3_600_000; // look for the break within 6 h of the open

const NY_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23', weekday: 'short' });

/** UTC ms of 09:30 New York on the UTC calendar day that contains `ms`, or null when that is not a weekday there. */
export function nyOpenUtc(ms: number): number | null {
  const d = new Date(ms);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (const hh of [13, 14]) {
    const t = dayStart + (hh * 60 + 30) * 60_000;
    const parts = NY_HOUR.formatToParts(new Date(t));
    const hour = Number(parts.find(p => p.type === 'hour')?.value);
    if (hour === 9) {
      const wd = parts.find(p => p.type === 'weekday')?.value;
      return wd === 'Sat' || wd === 'Sun' ? null : t;
    }
  }
  return null;
}

export function detectNyOpenBreakout(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  const tfMs = ctx.tfMs;
  const rangeMs = RANGE_MIN * 60_000;
  if (n < 10 || !(tfMs > 0) || tfMs > rangeMs || rangeMs % tfMs !== 0) return WAIT;
  const last = candles[n - 1];
  // The session is the one containing the latest closed candle; if that is before today's open, the previous UTC day's session is the one that counts.
  let open: number | null = null;
  for (const back of [0, 1]) {
    const o = nyOpenUtc(last.time - back * 86_400_000);
    if (o != null && o <= last.time) { open = o; break; }
  }
  if (open == null || last.time >= open + SESSION_MS) return WAIT;
  const rangeEnd = open + rangeMs;
  const inRange = candles.filter(c => c.time >= open! && c.time < rangeEnd);
  if (inRange.length !== rangeMs / tfMs) return WAIT; // range incomplete or the data has a gap
  if (last.time < rangeEnd) return WAIT;
  const hi = Math.max(...inRange.map(c => c.high));
  const lo = Math.min(...inRange.map(c => c.low));
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c.time < rangeEnd) continue;
    if (c.close > hi || c.close < lo) {
      if (i < n - FRESH_BARS) return WAIT; // the first break is old news
      const up = c.close > hi;
      return { verdict: up ? 'buy' : 'sell', signalTimestamp: c.time, signalDir: up ? 'long' : 'short', params: { hi, lo, inv: up ? lo : hi, breakAt: up ? hi : lo } };
    }
  }
  return WAIT;
}

export const NY_OPEN_BREAKOUT: StrategyDef = {
  id: 'ny_open_breakout',
  nameKey: 'STRAT_NYOPEN_NAME',
  descKey: 'STRAT_NYOPEN_DESC',
  reasonBuyKey: 'STRAT_NYOPEN_BUY',
  reasonSellKey: 'STRAT_NYOPEN_SELL',
  reasonWaitKey: 'STRAT_NYOPEN_WAIT',
  minCandles: 10,
  logTfs: ['5m', '15m'],
  detect: detectNyOpenBreakout,
};
