import { findChannel } from './channel.ts';
import { lastSwing } from './liquiditySweepMss.ts';
import { RANGE_MIN, nyOpenUtc } from './nyOpenBreakout.ts';
import { RANGE_BARS, currentRange } from './rangeBounce.ts';
import { emaSeeded, srPrices, swingPivots3 } from './shared.ts';
import { lineValueAt } from '../chartStructures.ts';
import { bollingerBandsArr, type OHLCV } from '../strategyCore.ts';
import { priceText } from '../numberFormat.ts';
import type { LabelKey } from '../labelKeys.ts';
import type { OverlayLevel, OverlayLine, OverlayZone, StrategyContext, StrategyDef, StrategyOverlay, StrategyResult } from './types.ts';

/* WHAT A STRATEGY DRAWS WHEN IT HAS NO CALL (owner, 2026-11-19: "we must show something ON THE CHART, not text alone"). Pure, from the SAME closed candles as the verdict. A strategy that says WAIT still has
 * something it is WATCHING, and the trader sees it on the chart: the channel's rails, the support / resistance levels a flip is waiting on, the open gap boxes, the session's high and low, the Bollinger
 * bands, the two EMAs. This module only ADDS drawings: it never changes a verdict, a level of a call, or what a detector already draws (a strategy that returns its own overlay keeps it), so the rules
 * QA pins stay exactly as they were. Two things live here:
 *   1. watchedDrawing(): the "watching" drawing of a WAIT that has none of its own (role 'watch', drawn dashed in the accent colour).
 *   2. recentSignals(): the arrows of the strategy's last few PAST signals on the visible candles, found by running the same detector over the earlier candles (never a different rule).
 * Strategies that read live-only inputs (funding, open interest) have no past to replay, so they get no arrows and no invented ones. */

const WATCH_BARS = 60;
const FVG_LOOKBACK = 100;
const MAX_FVG_BOXES = 3;
const MAX_SR = 6;
const BB_BARS = 80;
const EMA_BARS = 160;
const H = 3_600_000;

const SESSIONS = [{ startH: 0, endH: 8 }, { startH: 7, endH: 12 }] as const;

const level = (price: number, fromTs: number, labelKey: LabelKey, labelParams?: Record<string, string>): OverlayLevel => ({ price, role: 'watch', fromTs, labelKey, ...(labelParams ? { labelParams } : {}) });

function emaLines(candles: readonly OHLCV[]): OverlayLine[] {
  const cl = candles.map(c => c.close);
  const from = Math.max(0, candles.length - EMA_BARS);
  return [50, 200].flatMap((n): OverlayLine[] => {
    if (candles.length <= n) return [];
    const e = emaSeeded(cl, n);
    const points = [];
    for (let i = Math.max(from, n); i < candles.length; i++) points.push({ ts: candles[i].time, price: e[i] });
    return points.length >= 2 ? [{ points, role: 'watch', labelKey: 'STRAT_OV_EMA', labelParams: { n: String(n) } }] : [];
  });
}

function bandLines(candles: readonly OHLCV[]): OverlayLine[] {
  const bb = bollingerBandsArr(candles.map(c => c.close), 20, 2);
  const up = [], dn = [];
  for (let i = Math.max(0, candles.length - BB_BARS); i < candles.length; i++) {
    const b = bb[i];
    if (!b) continue;
    up.push({ ts: candles[i].time, price: b.up });
    dn.push({ ts: candles[i].time, price: b.dn });
  }
  return up.length >= 2 ? [
    { points: up, role: 'watch', labelKey: 'STRAT_OV_BAND_TOP' },
    { points: dn, role: 'watch', labelKey: 'STRAT_OV_BAND_BOTTOM' },
  ] : [];
}

/** The newest gap box whatever its state (open, returned to or filled), or null when there is none in the lookback. */
function latestGapBox(candles: readonly OHLCV[]): OverlayZone | null {
  const k = candles.length - 1;
  for (let i = k - 1; i >= Math.max(2, k - FVG_LOOKBACK); i--) {
    const bull = candles[i - 2].high < candles[i].low;
    const bear = candles[i - 2].low > candles[i].high;
    if (!bull && !bear) continue;
    const top = bull ? candles[i].low : candles[i - 2].low;
    const bot = bull ? candles[i - 2].high : candles[i].high;
    return { top, bottom: bot, fromTs: candles[i].time, toTs: candles[k].time, kind: bull ? 'demand' : 'supply', labelKey: 'STRAT_OV_FVG' };
  }
  return null;
}

/** The gap boxes no candle has returned into yet and none has closed through: what a fair value gap strategy is waiting for price to come back to. The nearest few to the last close. */
function openGapBoxes(candles: readonly OHLCV[]): OverlayZone[] {
  const k = candles.length - 1;
  const boxes: OverlayZone[] = [];
  for (let i = k - 1; i >= Math.max(2, k - FVG_LOOKBACK); i--) {
    const bull = candles[i - 2].high < candles[i].low;
    const bear = candles[i - 2].low > candles[i].high;
    if (!bull && !bear) continue;
    const top = bull ? candles[i].low : candles[i - 2].low;
    const bot = bull ? candles[i - 2].high : candles[i].high;
    let touched = false;
    for (let j = i + 1; j <= k; j++) {
      if (bull ? candles[j].close < bot : candles[j].close > top) { touched = true; break; }   // closed through it: filled
      if (bull ? candles[j].low <= top : candles[j].high >= bot) { touched = true; break; }    // already returned to
    }
    if (touched) continue;
    boxes.push({ top, bottom: bot, fromTs: candles[i].time, toTs: candles[k].time, kind: bull ? 'demand' : 'supply', labelKey: 'STRAT_OV_FVG' });
  }
  const px = candles[k].close;
  return boxes.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - px) - Math.abs((b.top + b.bottom) / 2 - px)).slice(0, MAX_FVG_BOXES);
}

/** The most recent complete (or running) session's high and low, on the last candle's UTC day, else the day before. Needs candles of 1h or finer. */
function sessionRange(candles: readonly OHLCV[], ctx: StrategyContext): { hi: number; lo: number; fromTs: number } | null {
  if (!(ctx.tfMs > 0) || ctx.tfMs > H) return null;
  const last = candles[candles.length - 1];
  const d = new Date(last.time);
  const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (const day of [day0, day0 - 24 * H]) {
    for (const s of [...SESSIONS].reverse()) {
      const inS = candles.filter(c => c.time >= day + s.startH * H && c.time < day + s.endH * H);
      if (inS.length < 0.8 * (((s.endH - s.startH) * H) / ctx.tfMs)) continue;
      return { hi: Math.max(...inS.map(c => c.high)), lo: Math.min(...inS.map(c => c.low)), fromTs: inS[0].time };
    }
  }
  return null;
}

/** The "watching" drawing for strategy `id` on `candles` (closed, oldest first), or null when there is truly nothing to draw. */
export function watchedDrawing(id: string, candles: readonly OHLCV[], ctx: StrategyContext): StrategyOverlay | null {
  const n = candles.length;
  if (n < 5) return null;
  const px = candles[n - 1].close;
  const from = candles[Math.max(0, n - WATCH_BARS)].time;
  const out: StrategyOverlay = { levels: [], zones: [], lines: [], marker: null };
  switch (id) {
    case 'sr_flip': {
      // the support / resistance levels the chart draws (at most MAX_SR, the nearest to the price): what a flip is waiting for price to break and come back to
      const lv = srPrices(candles, px).sort((a, b) => Math.abs(a - px) - Math.abs(b - px)).slice(0, MAX_SR);
      out.levels = lv.map(p => level(p, from, 'STRAT_OV_SR_LEVEL'));
      break;
    }
    case 'channel': {
      const fit = findChannel(candles, ctx.tf);   // flat or sloped: whatever channel the detector sees, both rails
      if (!fit) {
        /* NO CHANNEL: STILL SOMETHING ON THE CHART (PM, 2026-11-20, owner's order: a strategy that is selected shows a line or a shape): the recent swing highs and swing lows a channel would be built from, each side joined (a single pivot is a level), faint and labelled "Swing high" / "Swing low". */
        const { highs, lows } = swingPivots3(candles, 80);
        const side = (pts: Array<{ i: number; p: number }>, labelKey: LabelKey): void => {
          const last = pts.slice(-4);
          if (last.length >= 2) out.lines.push({ points: last.map(x => ({ ts: candles[x.i].time, price: x.p })), role: 'watch', labelKey });
          else if (last.length === 1) out.levels.push(level(last[0].p, candles[last[0].i].time, labelKey));
        };
        side(highs, 'STRAT_OV_SWING_HIGH');
        side(lows, 'STRAT_OV_SWING_LOW');
        break;
      }
      const rail = (r: typeof fit.upper, labelKey: LabelKey): OverlayLine => {
        const start = Math.max(0, Math.min(...r.pivots.map(p => p.index), n - 1));
        return { points: [{ ts: candles[start].time, price: lineValueAt(r.fit, start) }, { ts: candles[n - 1].time, price: lineValueAt(r.fit, n - 1) }], role: 'watch', labelKey };
      };
      out.lines = [rail(fit.upper, 'STRAT_OV_CHANNEL_TOP'), rail(fit.lower, 'STRAT_OV_CHANNEL_BOTTOM')];
      break;
    }
    case 'fvg': {
      out.zones = openGapBoxes(candles);
      /* NO OPEN GAP: the most recent gap, already returned to or filled, is still drawn so the chart shows what the strategy is about (PM, 2026-11-20). */
      if (!out.zones.length) { const g = latestGapBox(candles); if (g) out.zones = [g]; }
      break;
    }
    case 'bos_fvg': {
      // the break-of-structure levels it waits on: the latest confirmed swing high and swing low
      const hi = lastSwing(candles, n - 1, 'high'), lo = lastSwing(candles, n - 1, 'low');
      if (hi >= 0) out.levels.push(level(candles[hi].high, candles[hi].time, 'STRAT_OV_BOS'));
      if (lo >= 0) out.levels.push(level(candles[lo].low, candles[lo].time, 'STRAT_OV_BOS'));
      out.zones = openGapBoxes(candles);
      break;
    }
    case 'liq_sweep_mss': {
      // the swing high and swing low it waits to see swept
      const hi = lastSwing(candles, n - 1, 'high'), lo = lastSwing(candles, n - 1, 'low');
      if (hi >= 0) out.levels.push(level(candles[hi].high, candles[hi].time, 'STRAT_OV_SWING_HIGH'));
      if (lo >= 0) out.levels.push(level(candles[lo].low, candles[lo].time, 'STRAT_OV_SWING_LOW'));
      break;
    }
    case 'ny_open_breakout': {
      // the most recent New York opening range that is complete (today's, else the day before's): its open, high and low, which is what the strategy waits for price to leave
      const rangeMs = RANGE_MIN * 60_000;
      if (!(ctx.tfMs > 0) || ctx.tfMs > rangeMs || rangeMs % ctx.tfMs !== 0) break;
      const last = candles[n - 1];
      for (const back of [0, 1, 2, 3]) {
        const open = nyOpenUtc(last.time - back * 86_400_000);
        if (open == null || open > last.time) continue;
        const inRange = candles.filter(c => c.time >= open && c.time < open + rangeMs);
        if (inRange.length !== rangeMs / ctx.tfMs) continue;
        out.levels = [
          { price: inRange[0].open, role: 'ref', fromTs: open, labelKey: 'STRAT_OV_NY_OPEN' },
          level(Math.max(...inRange.map(c => c.high)), open, 'STRAT_OV_RANGE_HIGH'),
          level(Math.min(...inRange.map(c => c.low)), open, 'STRAT_OV_RANGE_LOW'),
        ];
        break;
      }
      break;
    }
    case 'rsi_divergence': {
      // the swing points the divergence is read between: the last two swing highs joined, the last two swing lows joined
      const { highs, lows } = swingPivots3(candles, 80);
      const join = (pts: Array<{ i: number; p: number }>): OverlayLine[] => pts.length >= 2
        ? [{ points: pts.slice(-2).map(x => ({ ts: candles[x.i].time, price: x.p })), role: 'watch', labelKey: 'STRAT_OV_DIVERGENCE' }]
        : [];
      out.lines = [...join(highs), ...join(lows)];
      break;
    }
    case 'session_sweep': {
      const s = sessionRange(candles, ctx);
      if (s) out.levels = [level(s.hi, s.fromTs, 'STRAT_OV_SESSION_HIGH'), level(s.lo, s.fromTs, 'STRAT_OV_SESSION_LOW')];
      break;
    }
    case 'bb_squeeze':
      out.lines = bandLines(candles);
      break;
    case 'ema_cross':
      out.lines = emaLines(candles);
      break;
    case 'range_bounce': {
      // the band it trades (last 30 candles before the newest, two touches on each edge): the edges a bounce is waited for
      const r = currentRange(candles);
      if (r) out.levels = [level(r.high, r.fromTs, 'STRAT_OV_RANGE_HIGH'), level(r.low, r.fromTs, 'STRAT_OV_RANGE_LOW')];
      else {
        /* NO RANGE: the high and low of the last RANGE_BARS candles, the band the strategy measures (it is not a range: too tall or too few touches), labelled as what it is. */
        const win = candles.slice(0, -1).slice(-RANGE_BARS);
        if (win.length) out.levels = [level(Math.max(...win.map(c => c.high)), win[0].time, 'STRAT_OV_LAST30_HIGH'), level(Math.min(...win.map(c => c.low)), win[0].time, 'STRAT_OV_LAST30_LOW')];
      }
      break;
    }
    case 'funding_oi_squeeze':
    case 'cvd_absorption': {
      /* THESE READ LIVE FUTURES DATA AND HAD NOTHING TO DRAW WHILE WAITING (QA drawings audit #1263): the last swing high and swing low, the levels a close through them would trigger on. */
      const hi = lastSwing(candles, n - 1, 'high'), lo = lastSwing(candles, n - 1, 'low');
      if (hi >= 0) out.levels.push(level(candles[hi].high, candles[hi].time, 'STRAT_OV_SWING_HIGH'));
      if (lo >= 0) out.levels.push(level(candles[lo].low, candles[lo].time, 'STRAT_OV_SWING_LOW'));
      break;
    }
    default:
      return null;
  }
  return out.levels.length || out.zones.length || out.lines.length ? out : null;
}

const empty = (o: StrategyOverlay | undefined): boolean => !o || (!o.levels.length && !o.zones.length && !o.lines.length && !o.marker);

/** `result` with a watching drawing added when it is a WAIT whose own overlay is empty, and `lastClose` (the price the "waiting" line is read against). A call, or a WAIT that already draws, is untouched. */
export function withWatchedDrawing(def: StrategyDef, result: StrategyResult, candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const lastClose = candles.length ? candles[candles.length - 1].close : undefined;
  const base = lastClose != null && Number.isFinite(lastClose) ? { ...result, lastClose } : result;
  if (result.verdict !== 'wait' || !empty(result.overlay)) return base;
  const w = watchedDrawing(def.id, candles, ctx);
  return w ? { ...base, overlay: w } : base;
}

export interface PastSignal { ts: number; dir: 'long' | 'short' }

/** The last `count` signals of `def` BEFORE the newest candle, newest first, found by running the same detector over the earlier candles (the identity of a signal is its direction and candle, so one that
 *  stayed current for two candles counts once). Stops at `windowBars` candles back or when `budgetMs` has passed (a slow detector returns what it found). Strategies on live-only inputs return none. */
export function recentSignals(def: StrategyDef, candles: readonly OHLCV[], ctx: StrategyContext, opts: { count?: number; windowBars?: number; budgetMs?: number } = {}): PastSignal[] {
  if (def.needsLive) return [];
  const count = opts.count ?? 6, windowBars = opts.windowBars ?? 160, budgetMs = opts.budgetMs ?? 250;
  const out: PastSignal[] = [];
  const seen = new Set<string>();
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const n = candles.length;
  for (let k = n - 2; k >= Math.max(def.minCandles - 1, n - 1 - windowBars); k--) {
    if (now() - t0 > budgetMs) break;
    const upTo = candles.slice(0, k + 1);
    const at = candles[k].time;
    const r = def.detect(upTo, { ...ctx, btcCandles: ctx.btcCandles?.filter(c => c.time <= at) });
    if (r.verdict === 'wait' || r.signalTimestamp == null || !r.signalDir) continue;
    const id = `${r.signalDir}:${r.signalTimestamp}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (r.signalTimestamp === candles[n - 1].time) continue;   // the current call is drawn by its own marker
    out.push({ ts: r.signalTimestamp, dir: r.signalDir });
    if (out.length >= count) break;
  }
  return out;
}

export interface WatchedItem { labelKey: LabelKey; labelParams?: Record<string, string>; price: string }

/** What the "Watching" line names, from the drawing: its levels, the box edges of a zone, and where each line ends now. Nearest to the last close first, at most four. */
export function watchedItems(result: StrategyResult | null): WatchedItem[] {
  if (!result || result.verdict !== 'wait' || !result.overlay) return [];
  const o = result.overlay;
  const ref = result.lastClose;
  const items: Array<WatchedItem & { at: number }> = [];
  for (const l of o.levels) if (l.role === 'watch' || l.role === 'confirm') items.push({ labelKey: l.labelKey, labelParams: l.labelParams, price: priceText(l.price), at: l.price });
  for (const z of o.zones) items.push({ labelKey: z.labelKey, price: `${priceText(z.bottom)} - ${priceText(z.top)}`, at: (z.top + z.bottom) / 2 });
  for (const ln of o.lines) {
    const end = ln.points[ln.points.length - 1];
    if (end && Number.isFinite(end.price)) items.push({ labelKey: ln.labelKey, labelParams: ln.labelParams, price: priceText(end.price), at: end.price });
  }
  if (ref != null && Number.isFinite(ref)) items.sort((a, b) => Math.abs(a.at - ref) - Math.abs(b.at - ref));
  else items.sort((a, b) => a.at - b.at);
  return items.slice(0, 4).map(({ labelKey, labelParams, price }) => ({ labelKey, labelParams, price }));
}
