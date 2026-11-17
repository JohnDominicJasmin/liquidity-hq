import { computeSRLevels } from '../srLevels.ts';
import type { OHLCV } from '../strategyCore.ts';
import type { OverlayLevel, OverlayZone, StrategyOverlay, StrategyResult } from './types.ts';

/* SHARED PIECES OF THE PHASE-1 STRATEGIES (owner decision 2026-11-17, rules on #1263). Pure, closed candles only. */

/** EMA with the standard 2/(n+1) smoothing, SEEDED WITH THE FIRST CLOSE (the QA oracle's stated choice, qa/fixtures/strategyFixtures.ts), so a cross lands on the same candle as the oracle's. */
export function emaSeeded(values: readonly number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/** The support / resistance levels the chart draws (lib/srLevels.ts), as prices, computed from `candles` at `price`. */
export function srPrices(candles: readonly OHLCV[], price: number): number[] {
  return computeSRLevels(candles.map(c => ({ high: c.high, low: c.low, close: c.close })), price).map(l => l.price);
}

/** The nearest level in the trade's direction (above `entry` for a BUY, below for a SELL) that is at least `minDist` away, or null. Pass the risk distance (entry to stop) as `minDist` for the "first level at least 1R away" rule (PM, 2026-11-17): a closer level would give a reward smaller than the risk, so it is skipped; none left means no target and no R:R. */
export function nearestLevel(prices: readonly number[], entry: number, dir: 'long' | 'short', minDist = 0): number | null {
  const c = prices.filter(p => (dir === 'long' ? p - entry : entry - p) > 0 && Math.abs(p - entry) >= minDist).sort((a, b) => (dir === 'long' ? a - b : b - a));
  return c.length ? c[0] : null;
}

export const rr = (entry: number, stop: number, target: number | null): number | null =>
  target == null || entry === stop ? null : Math.round((Math.abs(target - entry) / Math.abs(entry - stop)) * 10) / 10;

export interface CallInput {
  ts: number;
  dir: 'long' | 'short';
  entry: number;
  stop: number;
  target: number | null;
  /** Numbers for the verdict sentence's placeholders. */
  params?: Record<string, number | boolean>;
  levels?: OverlayLevel[];
  zones?: OverlayZone[];
}

/** A BUY / SELL result with entry, stop, target (when there is one) and R:R, and the standard overlay: Entry, Stop ("wrong if") and Target lines, the signal arrow, plus anything the strategy adds. No target means no R:R. */
export function tradeCall(i: CallInput): StrategyResult {
  const { ts, dir, entry, stop, target } = i;
  const params: Record<string, number | boolean> = { ...(i.params ?? {}), entry, stop, inv: stop };
  if (target != null) params.target = target;
  const r = rr(entry, stop, target);
  if (r != null) params.rr = r;
  const overlay: StrategyOverlay = {
    levels: [
      ...(i.levels ?? []),
      { price: entry, role: 'confirm', fromTs: ts, labelKey: 'STRAT_OV_ENTRY' },
      { price: stop, role: 'invalid', fromTs: ts, labelKey: 'STRAT_OV_STOP' },
      ...(target != null ? [{ price: target, role: 'watch' as const, fromTs: ts, labelKey: 'STRAT_OV_TARGET' as const }] : []),
    ],
    zones: i.zones ?? [],
    lines: [],
    marker: { ts, dir },
  };
  return { verdict: dir === 'long' ? 'buy' : 'sell', signalTimestamp: ts, signalDir: dir, params, overlay };
}

/** 3-bar swing pivots (a high no lower than the 3 candles each side, a low no higher) among the last `look` candles, as indexes and prices, oldest first. The pivots need 3 candles on the right, so the newest 3 never qualify. */
export function swingPivots3(candles: readonly OHLCV[], look = 20): { highs: Array<{ i: number; p: number }>; lows: Array<{ i: number; p: number }> } {
  const from = Math.max(3, candles.length - look);
  const highs: Array<{ i: number; p: number }> = [], lows: Array<{ i: number; p: number }> = [];
  for (let i = from; i < candles.length - 3; i++) {
    const around = [...candles.slice(i - 3, i), ...candles.slice(i + 1, i + 4)];
    if (around.every(x => x.high <= candles[i].high)) highs.push({ i, p: candles[i].high });
    if (around.every(x => x.low >= candles[i].low)) lows.push({ i, p: candles[i].low });
  }
  return { highs, lows };
}

/** 14-candle average true range (the plain mean of the last 14 true ranges). */
export function atr14(candles: readonly OHLCV[], n = 14): number {
  const tr = candles.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - candles[i - 1].close), Math.abs(x.low - candles[i - 1].close))));
  const w = tr.slice(-n);
  return w.reduce((a, v) => a + v, 0) / w.length;
}
