import { detectStructures, type DetectedStructure } from '../chartStructureDetect.ts';
import { findSwingPivots, lineValueAt, type StructureCandle } from '../chartStructures.ts';
import { computeSRLevels } from '../srLevels.ts';
import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type OverlayLine, type StrategyContext, type StrategyDef, type StrategyOverlay, type StrategyResult } from './types.ts';

/* CHANNEL BREAKOUT (owner-requested, 2026-11-17, #1263). Deterministic rules, CLOSED candles only, the existing channel detector (lib/chartStructureDetect.ts) at its current fit thresholds
 * (at least three pivots per rail).
 *
 *  A CHANNEL is the detector's own: two near-parallel rails, both falling or both rising, measured on the candles BEFORE the breakout candle.
 *  BUY:  the candle CLOSES above the upper rail of a FALLING channel and the candle before it did not (the first close outside).
 *  SELL: the candle CLOSES below the lower rail of a RISING channel and the candle before it did not.
 *  Current only while that candle is one of the last FRESH_BARS closed candles. Otherwise WAIT.
 *
 *  LEVELS (the owner's 2026-11-17 decision, superseding the 2026-10-31 "no target, no entry" rule of lib/drawStructure.ts FOR LEVELS THAT COME FROM A STRATEGY'S OWN RULES ONLY):
 *    entry  = the breakout candle's close.
 *    stop   = the last swing on the other side, inside the channel (the last swing low for a BUY, swing high for a SELL); the channel's own opposite rail at that candle when no swing qualifies.
 *    target = the nearest support / resistance level in the trade's direction, the SAME levels the chart draws (lib/srLevels.ts). None in that direction: no target and no R:R.
 *  Signals, not predictions: this says what the candles did and where the levels are, never where price will go. No predicted path is produced or drawn. */

export const FRESH_BARS = 2;
export const MIN_CANDLES = 60;
export const PIVOT_STRENGTH = 3;
/** Half-width of the support / resistance band drawn around a level, as a fraction of its price (the chart clusters swings within 0.3%, so a band of 0.3% in total). */
export const SR_BAND_PCT = 0.0015;

const toStructure = (c: OHLCV): StructureCandle => ({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });

export interface ChannelFit { upper: DetectedStructure['rails'][number]; lower: DetectedStructure['rails'][number]; dir: 'falling' | 'rising' | 'flat'; }

/** The channel the detector finds on `candles` (all of them), as two rails and a direction; null when there is none. Indices are into `candles`. */
export function findChannel(candles: readonly OHLCV[], timeframe: string): ChannelFit | null {
  const res = detectStructures(candles.map(toStructure), { timeframe });
  const ch = res.structures.find(s => s.kind === 'channel');
  if (!ch || ch.rails.length !== 2) return null;
  const lower = ch.rails.find(r => r.side === 'low'), upper = ch.rails.find(r => r.side === 'high');
  if (!lower || !upper) return null;
  const sl = lower.fit.slope, su = upper.fit.slope;
  const dir = sl < 0 && su < 0 ? 'falling' : sl > 0 && su > 0 ? 'rising' : 'flat';
  return { upper, lower, dir };
}

/** The rail's two endpoints for drawing: from the rail's first pivot to the candle at `endIndex`. */
function railLine(candles: readonly OHLCV[], rail: ChannelFit['upper'], endIndex: number, role: OverlayLine['role'], labelKey: OverlayLine['labelKey']): OverlayLine {
  const startIdx = Math.max(0, Math.min(...rail.pivots.map(p => p.index), endIndex));
  return {
    points: [
      { ts: candles[startIdx].time, price: lineValueAt(rail.fit, startIdx) },
      { ts: candles[endIndex].time, price: lineValueAt(rail.fit, endIndex) },
    ],
    role, labelKey,
  };
}

/** Pure, shared with the chart: the entry / stop / target of a breakout at candle `k`. `candles` are all the closed candles; the swings and the levels use only what came BEFORE and AT `k`. */
export function breakoutLevels(candles: readonly OHLCV[], k: number, dir: 'long' | 'short', fit: ChannelFit): { entry: number; stop: number; target: number | null; rr: number | null; zone: { top: number; bottom: number } | null } {
  const entry = candles[k].close;
  const before = candles.slice(0, k).map(toStructure);
  const { highs, lows } = findSwingPivots(before, PIVOT_STRENGTH, PIVOT_STRENGTH);
  const stopFallback = dir === 'long' ? lineValueAt(fit.lower.fit, k) : lineValueAt(fit.upper.fit, k);
  let stop = stopFallback;
  if (dir === 'long') {
    const piv = [...lows].reverse().find(p => p.price < entry);
    if (piv) stop = piv.price;
  } else {
    const piv = [...highs].reverse().find(p => p.price > entry);
    if (piv) stop = piv.price;
  }
  // The stop must be on the losing side of the entry; a degenerate rail value there is not a stop.
  if (dir === 'long' ? !(stop < entry) : !(stop > entry)) stop = dir === 'long' ? candles[k].low : candles[k].high;
  const levels = computeSRLevels(candles.slice(0, k + 1).map(c => ({ high: c.high, low: c.low, close: c.close })), entry);
  const ahead = dir === 'long'
    ? levels.filter(l => l.type === 'resistance' && l.price > entry).sort((a, b) => a.price - b.price)[0]
    : levels.filter(l => l.type === 'support' && l.price < entry).sort((a, b) => b.price - a.price)[0];
  const target = ahead ? ahead.price : null;
  const risk = Math.abs(entry - stop);
  const rr = target != null && risk > 0 ? Math.abs(target - entry) / risk : null;
  const zone = ahead ? { top: ahead.price * (1 + SR_BAND_PCT), bottom: ahead.price * (1 - SR_BAND_PCT) } : null;
  return { entry, stop, target, rr, zone };
}

export function detectChannel(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  for (let k = n - 1; k >= n - FRESH_BARS; k--) {
    const fit = findChannel(candles.slice(0, k), ctx.tf);   // the channel as it stood BEFORE the breakout candle
    if (!fit || fit.dir === 'flat') continue;
    const upK = lineValueAt(fit.upper.fit, k), upP = lineValueAt(fit.upper.fit, k - 1);
    const loK = lineValueAt(fit.lower.fit, k), loP = lineValueAt(fit.lower.fit, k - 1);
    const buy = fit.dir === 'falling' && candles[k].close > upK && !(candles[k - 1].close > upP);
    const sell = fit.dir === 'rising' && candles[k].close < loK && !(candles[k - 1].close < loP);
    if (!buy && !sell) continue;
    const dir = buy ? 'long' : 'short';
    const lv = breakoutLevels(candles, k, dir, fit);
    const params: Record<string, number | boolean> = { rail: buy ? upK : loK, entry: lv.entry, stop: lv.stop, inv: lv.stop };
    if (lv.target != null) params.target = lv.target;
    if (lv.rr != null) params.rr = Math.round(lv.rr * 10) / 10;
    const ts = candles[k].time;
    const overlay: StrategyOverlay = {
      levels: [
        { price: lv.entry, role: 'confirm', fromTs: ts, labelKey: 'STRAT_OV_ENTRY' },
        { price: lv.stop, role: 'invalid', fromTs: ts, labelKey: 'STRAT_OV_STOP' },
        ...(lv.target != null ? [{ price: lv.target, role: 'watch' as const, fromTs: ts, labelKey: 'STRAT_OV_TARGET' as const }] : []),
      ],
      zones: lv.zone ? [{ top: lv.zone.top, bottom: lv.zone.bottom, fromTs: ts, toTs: ts, kind: buy ? 'supply' : 'demand', labelKey: buy ? 'STRAT_OV_SUPPLY' : 'STRAT_OV_DEMAND' }] : [],
      lines: [
        railLine(candles, fit.upper, k, 'ref', 'STRAT_OV_CHANNEL_TOP'),
        railLine(candles, fit.lower, k, 'ref', 'STRAT_OV_CHANNEL_BOTTOM'),
      ],
      marker: { ts, dir },
    };
    return { verdict: buy ? 'buy' : 'sell', signalTimestamp: ts, signalDir: dir, params, overlay };
  }
  /* WAIT: what it is watching, the channel on the candles so far, when there is one. */
  const fit = findChannel(candles, ctx.tf);
  if (!fit || fit.dir === 'flat') return WAIT;
  return {
    ...WAIT,
    overlay: {
      levels: [], zones: [], marker: null,
      lines: [
        railLine(candles, fit.upper, n - 1, 'watch', 'STRAT_OV_CHANNEL_TOP'),
        railLine(candles, fit.lower, n - 1, 'watch', 'STRAT_OV_CHANNEL_BOTTOM'),
      ],
    },
  };
}

export const CHANNEL_BREAKOUT: StrategyDef = {
  id: 'channel',
  nameKey: 'STRAT_CHANNEL_NAME',
  descKey: 'STRAT_CHANNEL_DESC',
  reasonBuyKey: 'STRAT_CHANNEL_BUY',
  reasonSellKey: 'STRAT_CHANNEL_SELL',
  reasonWaitKey: 'STRAT_CHANNEL_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['1h', '4h'],
  detect: detectChannel,
};
