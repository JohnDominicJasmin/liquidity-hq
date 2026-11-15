import { detectRSIDivergence } from '../divergence.ts';
import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyOverlay, type StrategyResult } from './types.ts';

/* RSI DIVERGENCE, WITH A TRIGGER (owner-requested, 2026-11-14). Deterministic rules, closed candles only. The divergence itself is the Arena's existing detector.
 *
 *  BULLISH divergence: price makes a lower low while RSI makes a higher low (selling is fading). BEARISH: price makes a higher high while RSI makes a lower high.
 *  A divergence alone is not a signal (it can run for a long time), so it needs a TRIGGER: a candle after the swing that CLOSES back through the swing candle's far side
 *    (above its high after a bullish one, below its low after a bearish one). BUY / SELL is the first candle on which both are known: the divergence is confirmed
 *    (CONFIRM_BARS after the swing) and the trigger has happened.
 *  The divergence stays valid only while price has not made a new extreme beyond the swing since it formed, only while the swing is no older than MAX_AGE candles,
 *  and that signal candle must be one of the last FRESH_BARS closed candles.
 *  Signals, not predictions: this says momentum and price disagreed and price then turned, not that the turn will hold. */

export const MAX_AGE = 20;
export const FRESH_BARS = 2;
export const CONFIRM_BARS = 3;   // lib/divergence.ts confirms a swing this many candles after it, so the divergence is only KNOWN then
export const MIN_CANDLES = 60;

export function detectRsiDivergenceTrigger(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const events = detectRSIDivergence([...candles]);
  /* The line joining the two price swings of a divergence (lows for a bullish one, highs for a bearish one), and for a WAIT the trigger it is waiting for. */
  const drawing = (ev: (typeof events)[number], withInvalid: boolean, signalAt: number | null): StrategyOverlay => {
    const bull = ev.dir === 'bullish';
    const a = candles[ev.priorSwingIndex], b = candles[ev.index];
    const pa = bull ? a.low : a.high, pb = bull ? b.low : b.high;
    const levels: StrategyOverlay['levels'] = [{ price: bull ? b.high : b.low, role: withInvalid ? 'confirm' : 'watch', fromTs: b.time, labelKey: 'STRAT_OV_TRIGGER' }];
    if (withInvalid) levels.push({ price: pb, role: 'invalid', fromTs: b.time, labelKey: 'STRAT_OV_INVALID' });
    return { levels, zones: [], lines: [{ points: [{ ts: a.time, price: pa }, { ts: b.time, price: pb }], role: 'ref', labelKey: 'STRAT_OV_DIVERGENCE' }], marker: signalAt == null ? null : { ts: candles[signalAt].time, dir: bull ? 'long' : 'short' } };
  };
  let watching: StrategyOverlay | null = null;
  for (let e = events.length - 1; e >= 0; e--) {
    const ev = events[e];
    if (ev.index < n - 1 - MAX_AGE) break;
    const bull = ev.dir === 'bullish';
    const sw = candles[ev.index];
    let invalid = false;
    let trigger = -1;
    for (let k = ev.index + 1; k < n; k++) {
      const x = candles[k];
      if (bull ? x.low < sw.low : x.high > sw.high) { invalid = true; break; }   // a new extreme: the divergence failed
      if (trigger < 0 && (bull ? x.close > sw.high : x.close < sw.low)) { trigger = k; }
    }
    if (invalid) continue;
    if (trigger < 0) { if (!watching && ev.priorSwingIndex >= 0) watching = drawing(ev, false, null); continue; }
    /* The signal is the first candle on which BOTH are known: the divergence is confirmed and a candle has closed back through the swing. */
    const signalAt = Math.max(trigger, ev.index + CONFIRM_BARS);
    if (signalAt >= n || signalAt < n - FRESH_BARS) continue;
    return {
      verdict: bull ? 'buy' : 'sell', signalTimestamp: candles[signalAt].time, signalDir: bull ? 'long' : 'short',
      params: { swing: bull ? sw.low : sw.high, trigger: bull ? sw.high : sw.low, inv: bull ? sw.low : sw.high },
      overlay: ev.priorSwingIndex >= 0 ? drawing(ev, true, signalAt) : undefined,
    };
  }
  return watching ? { ...WAIT, overlay: watching } : WAIT;
}

export const RSI_DIVERGENCE: StrategyDef = {
  id: 'rsi_divergence',
  nameKey: 'STRAT_RSIDIV_NAME',
  descKey: 'STRAT_RSIDIV_DESC',
  reasonBuyKey: 'STRAT_RSIDIV_BUY',
  reasonSellKey: 'STRAT_RSIDIV_SELL',
  reasonWaitKey: 'STRAT_RSIDIV_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['15m', '1h', '4h'],
  detect: detectRsiDivergenceTrigger,
};
