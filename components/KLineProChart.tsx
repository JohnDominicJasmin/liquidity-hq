'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Chart as KChart, DataLoader, OverlayCreate, Period } from 'klinecharts';
import { BINANCE_SYMS, BYBIT_SYMS, COIN_DEC, CoinId, useMarket, computeSqueezeScore } from '@/lib/marketStore';
import { chartDisplaySymbol } from '@/lib/coins';
import type { CombinedResult } from '@/lib/grok';
import type { StrategySignal } from '@/lib/useEMAStrategy';
import { detectStructureSignals, type PASignal } from '@/lib/priceAction';
import { Warn } from '@/components/icons';
import { useDesignMode } from '@/components/DesignModeProvider';
import { barsAfter } from '@/lib/candles';
import { LIQ_CLUSTER_LINES } from '@/lib/liqClusters';

// ── v10 Period mapping ────────────────────────────────────────────────────

const TF_TO_PERIOD: Record<string, Period> = {
  '1m':  { type: 'minute', span: 1  },
  '5m':  { type: 'minute', span: 5  },
  '15m': { type: 'minute', span: 15 },
  '30m': { type: 'minute', span: 30 },
  '1h':  { type: 'hour',   span: 1  },
  '2h':  { type: 'hour',   span: 2  },
  '4h':  { type: 'hour',   span: 4  },
  '1d':  { type: 'day',    span: 1  },
};

function periodToBnInterval(p: Period): string {
  if (p.type === 'minute') return `${p.span}m`;
  if (p.type === 'hour')   return `${p.span}h`;
  if (p.type === 'day')    return `${p.span}d`;
  if (p.type === 'week')   return `${p.span}w`;
  return '15m';
}
function periodToBybitInterval(p: Period): string {
  if (p.type === 'minute') return String(p.span);
  if (p.type === 'hour')   return String(p.span * 60);
  if (p.type === 'day')    return 'D';
  return '15';
}

// ── Drawing tools ─────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'horizontalStraightLine', label: '― H-Line'  },
  { id: 'straightLine',           label: '⟋ Trend'   },
  { id: 'fibonacciLine',          label: '≡ Fib'     },
  { id: 'segment',                label: '╱ Seg'     },
  { id: 'rect',                   label: '▭ Rect'    },
] as const;

// ── Drawing persistence - user-drawn lines survive a page refresh, per coin ──
const DRAWING_GROUP = 'user_drawing';
const drawingsKey = (coin: CoinId) => `lhq_chart_drawings_${coin}`;

interface PersistedOverlay {
  name: string;
  points: Array<{ timestamp?: number; value?: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styles?: any;
  lock?: boolean;
}

function saveDrawings(chart: KChart, coin: CoinId) {
  try {
    const overlays = chart.getOverlays({ groupId: DRAWING_GROUP });
    const persisted: PersistedOverlay[] = overlays.map(o => ({
      name: o.name,
      points: o.points.map(p => ({ timestamp: p.timestamp, value: p.value })),
      styles: o.styles,
      lock: o.lock,
    }));
    localStorage.setItem(drawingsKey(coin), JSON.stringify(persisted));
  } catch { /* storage full/unavailable - drawings just won't persist */ }
}

function loadDrawings(coin: CoinId): PersistedOverlay[] {
  try {
    const raw = localStorage.getItem(drawingsKey(coin));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// ── Theme configs - use setStyles after init to avoid deep-type gymnastics ──

// Mobile (arena chart legend audit item #6): klinecharts' built-in OHLC
// tooltip defaults to "always" - a permanent text block that overlaps the
// candles + price axis on a short mobile chart pane. "follow_cross" only
// shows it while the user is actively touching/dragging the crosshair,
// which is how most trading apps handle a short chart on a phone.
const DARK: Record<string, unknown> = {
  grid: {
    horizontal: { color: 'rgba(255,255,255,0.04)', size: 1 },
    vertical:   { color: 'rgba(255,255,255,0.04)', size: 1 },
  },
  candle: {
    bar: {
      upColor:            '#26a69a',
      downColor:          '#ef5350',
      upBorderColor:      '#26a69a',
      downBorderColor:    '#ef5350',
      noChangeBorderColor:'#888',
      upWickColor:        '#26a69a',
      downWickColor:      '#ef5350',
    },
    tooltip: { showRule: 'follow_cross' },
    priceMark: {
      high: { show: true, color: 'rgba(255,255,255,0.45)', textSize: 10 },
      low:  { show: true, color: 'rgba(255,255,255,0.45)', textSize: 10 },
      last: {
        show: true,
        line: { show: true, color: 'rgba(255,255,255,0.18)' },
        text: { show: true, color: '#e8e8e8', size: 11 },
      },
    },
  },
  xAxis: {
    tickText: { color: 'rgba(255,255,255,0.35)', size: 10 },
    axisLine: { color: 'rgba(255,255,255,0.07)' },
    tickLine: { color: 'rgba(255,255,255,0.07)' },
  },
  yAxis: {
    tickText: { color: 'rgba(255,255,255,0.35)', size: 10 },
    axisLine: { color: 'rgba(255,255,255,0.07)' },
    tickLine: { color: 'rgba(255,255,255,0.07)' },
  },
  crosshair: {
    horizontal: {
      line:  { color: 'rgba(255,255,255,0.12)' },
      text:  { color: '#e8e8e8', background: '#1e1e1e', size: 11 },
    },
    vertical: {
      line:  { color: 'rgba(255,255,255,0.12)' },
      text:  { color: '#e8e8e8', background: '#1e1e1e', size: 11 },
    },
  },
  overlay: {
    line: { color: 'var(--accent-2)', size: 1 },
  },
  indicator: {
    tooltip: { showRule: 'follow_cross' },
  },
};

// #598 D1: KLineProChart is shared and correct elsewhere, but on the
// terminal Arena it kept rendering DARK's teal/red candles and the current
// design's blue/orange, because klinecharts draws to a <canvas> - CSS
// (`[data-design="terminal"] .at-chart .klc-*`) can only reach the toolbar's
// own DOM buttons, not anything painted onto the canvas itself. Every value
// below is a hex QA measured directly from Arena 1a.dc.html (frequency
// count in #598) - zero invented colours. Terminal is dark-only (arena.md
// "Out of scope: Light theme"), so this is the only terminal variant.
const TERMINAL_DARK: Record<string, unknown> = {
  grid: {
    horizontal: { color: '#1f2225', size: 1 },
    vertical:   { color: '#1f2225', size: 1 },
  },
  candle: {
    bar: {
      upColor:            '#3fb950',
      downColor:          '#f0524d',
      upBorderColor:      '#3fb950',
      downBorderColor:    '#f0524d',
      noChangeBorderColor:'#7c828a',
      upWickColor:        '#3fb950',
      downWickColor:      '#f0524d',
    },
    tooltip: { showRule: 'follow_cross' },
    priceMark: {
      high: { show: true, color: '#8b8f94', textSize: 10 },
      low:  { show: true, color: '#8b8f94', textSize: 10 },
      last: {
        show: true,
        line: { show: true, color: '#3a3f45' },
        text: { show: true, color: '#e8e9ea', size: 11 },
      },
    },
  },
  xAxis: {
    tickText: { color: '#7c828a', size: 10 },
    axisLine: { color: '#1f2225' },
    tickLine: { color: '#1f2225' },
  },
  yAxis: {
    tickText: { color: '#7c828a', size: 10 },
    axisLine: { color: '#1f2225' },
    tickLine: { color: '#1f2225' },
  },
  crosshair: {
    horizontal: {
      line: { color: '#3a3f45' },
      text: { color: '#e8e9ea', background: '#16191b', size: 11 },
    },
    vertical: {
      line: { color: '#3a3f45' },
      text: { color: '#e8e9ea', background: '#16191b', size: 11 },
    },
  },
  // klinecharts' built-in drawing-tool overlays (trendline etc, from the
  // toolbar) use this as their default line colour. The custom overlays
  // below (S/R, GEX, analysis levels, structure) each set their own colour
  // per instance and are unaffected by this. --accent's terminal value
  // (#d9a626, gold) resolved to a literal hex - unlike 'var(--accent-2)' in
  // DARK/LIGHT above, a canvas fillStyle cannot resolve a CSS custom
  // property string at all.
  overlay: {
    line: { color: '#d9a626', size: 1 },
  },
  indicator: {
    tooltip: { showRule: 'follow_cross' },
  },
};

const LIGHT: Record<string, unknown> = {
  grid: {
    horizontal: { color: 'rgba(0,0,0,0.06)', size: 1 },
    vertical:   { color: 'rgba(0,0,0,0.06)', size: 1 },
  },
  candle: {
    bar: {
      upColor:            '#16a34a',
      downColor:          '#dc2626',
      upBorderColor:      '#16a34a',
      downBorderColor:    '#dc2626',
      noChangeBorderColor:'#888',
      upWickColor:        '#16a34a',
      downWickColor:      '#dc2626',
    },
    tooltip: { showRule: 'follow_cross' },
    priceMark: {
      high: { show: true, color: 'rgba(0,0,0,0.35)', textSize: 10 },
      low:  { show: true, color: 'rgba(0,0,0,0.35)', textSize: 10 },
      last: {
        show: true,
        line: { show: true, color: 'rgba(0,0,0,0.12)' },
        text: { show: true, color: '#1A1916', size: 11 },
      },
    },
  },
  xAxis: {
    tickText: { color: 'rgba(0,0,0,0.4)', size: 10 },
    axisLine: { color: 'rgba(0,0,0,0.08)' },
    tickLine: { color: 'rgba(0,0,0,0.08)' },
  },
  yAxis: {
    tickText: { color: 'rgba(0,0,0,0.4)', size: 10 },
    axisLine: { color: 'rgba(0,0,0,0.08)' },
    tickLine: { color: 'rgba(0,0,0,0.08)' },
  },
  crosshair: {
    horizontal: {
      line:  { color: 'rgba(0,0,0,0.15)' },
      text:  { color: '#1A1916', background: '#E8E5DC', size: 11 },
    },
    vertical: {
      line:  { color: 'rgba(0,0,0,0.15)' },
      text:  { color: '#1A1916', background: '#E8E5DC', size: 11 },
    },
  },
  overlay: {
    line: { color: '#5b21b6', size: 1 },
  },
  indicator: {
    tooltip: { showRule: 'follow_cross' },
  },
};

/* ── OVERLAY INK - the colours the custom overlays DRAW with (#752) ────────
 *
 * The three palettes above are handed to klinecharts' setStyles and cover
 * candles, axes, grid and crosshair. They do NOT cover the overlays this file
 * draws itself, and those carried raw literals outside all three:
 *
 *     price-alert line   #f59e0b   9.78 on the dark ground, 1.78 on the light
 *     entry-marker ring  #f59e0b   same
 *     chevron            #fde68a   16.86 dark, 1.03 light
 *
 * The alert line is not decoration - it is the control the user DRAGS to move
 * a price alert, and it is the only indication of where that alert sits. At
 * 1.78 against a 3:1 bar it is close to invisible on a light chart.
 *
 * The canvas is transparent, so the ground is .klc-wrap's own `var(--bg)`:
 * #000000 in both dark themes, #E8EAED in both light ones. That is why this
 * switches on THEME and not on design - unlike setStyles above.
 *
 * The centre diamond was worse than a contrast failure: it was
 * `color: 'var(--amber-2)'`, and a canvas fillStyle cannot resolve a CSS
 * custom property at all. That value has never drawn anything. The comment on
 * TERMINAL.overlay.line says exactly this about its own colour, ten lines up
 * from a call site doing the thing it warns against.
 *
 * Light values are the palette's own light amber (--amber #8F4508,
 * --amber-2 #92400E) rather than newly invented hues. */
const OVERLAY_INK = {
  dark: {
    alertLine:   '#f59e0b',   // 9.78 on #000000
    markerRing:  '#f59e0b',   // 9.78
    markerGlow:  'rgba(251,191,36,0.15)',
    markerFill:  'rgba(245,158,11,0.1)',
    markerCore:  '#fcd34d',   // --amber-2, dark
    chevron:     '#fde68a',   // 16.86
  },
  light: {
    alertLine:   '#8F4508',   // 5.76 on #E8EAED
    markerRing:  '#8F4508',   // 5.76
    markerGlow:  'rgba(146,64,14,0.18)',
    markerFill:  'rgba(124,45,18,0.10)',
    markerCore:  '#92400E',   // --amber-2, light
    chevron:     '#7c2d12',   // 7.77
  },
} as const;

/* Module scope rather than a ref, because the overlay draw functions below are
   plain callbacks registered with klinecharts and have no access to component
   state. Written by the theme-sync effect, read at draw time - so the marker
   picks up a theme change on its next frame with nothing to re-create. The
   alert line is different: its colour is baked in at createOverlay, so that
   effect re-runs on the same signal. */
let overlayInk: typeof OVERLAY_INK.dark | typeof OVERLAY_INK.light = OVERLAY_INK.dark;

/** Which of the three palettes a given theme and design gets.
 *
 *  ONE EXPRESSION, TWO CALL SITES. It was two expressions: the theme-sync
 *  effect knew about terminal and the init call did not
 *  (`setStyles(dark ? DARK : LIGHT)`), so at creation terminal dark was painted
 *  with DARK and corrected a moment later. QA raised it on #763 as "probably
 *  one frame, your call".
 *
 *  It is not reliably one frame. The correcting effect depends on `mode` from
 *  useDesignMode(), and #753's bug was exactly that value arriving LATE - a
 *  read that fired before DesignModeProvider had set its attribute. If `mode`
 *  resolves after the effect's first run, the wrong dark palette persists
 *  until it does rather than flashing.
 *
 *  The deeper reason is the one this codebase keeps paying for: two
 *  expressions encoding one rule is the two-sources shape from #736 and #663,
 *  and here the two had already drifted - the init site never learned about
 *  terminal at all. Light-wins-over-terminal (#758) now lives in one place. */
function paletteFor(dark: boolean, terminal: boolean): Record<string, unknown> {
  if (!dark) return LIGHT;
  return terminal ? TERMINAL_DARK : DARK;
}

// ── Component ─────────────────────────────────────────────────────────────

export type ChartTf = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d';

export interface ChartAlert {
  id:           string;
  target_price: number;
  direction:    'above' | 'below';
  label?:       string;
}

/* One realized-liquidation cluster. Structurally LiqFeed's `Bucket` minus the
   fields this chart does not draw - declared here rather than imported so the
   chart does not depend on the feed component, and so a future second source
   of clusters needs no change on this side. */
export interface LiqClusterLine {
  price: number;
  total: number;
}

interface Props {
  coin:          CoinId;
  tf:            ChartTf;
  onTfChange?:   (tf: ChartTf) => void;
  result?:       CombinedResult | null;
  emaSignal?:    StrategySignal | null;
  chartAlerts?:  ChartAlert[];
  onAlertMove?:  (id: string, newPrice: number) => void;
  // BTC options context lines (null for non-BTC or before data loads).
  gexLevels?:    { flip: number | null; maxPain: number | null } | null;
  /* Realized liquidation clusters for the coin this chart is DISPLAYING,
     heaviest first. Filtering by coin is the caller's job and is not optional -
     LiqFeed emits every coin's buckets in one array, so passing them
     unfiltered draws another coin's price levels on these candles. Use
     lib/liqClusters.ts's topClustersForCoin rather than doing it by hand. */
  liqClusters?:  LiqClusterLine[] | null;
  // Latest market-structure break on the CURRENTLY DISPLAYED timeframe, or null
  // when there is none. Emitted rather than recomputed by the consumer so the
  // Confluence Score votes on exactly the break the user can see marked on this
  // chart - same candles, same timeframe. Fires regardless of the Structure
  // toggle: the toggle controls whether markers are drawn, not whether the
  // signal exists.
  onStructure?:  (sig: PASignal | null) => void;
}

const TFS: ChartTf[] = ['1m','5m','15m','30m','1h','2h','4h','1d'];

let emaSignalOverlayRegistered = false;
let emaRibbonLineRegistered = false;
let srLevelLineRegistered = false;
let gexLevelLineRegistered = false;
let liqClusterLineRegistered = false;
let analysisLevelLineRegistered = false;
let reversalOverlayRegistered = false;
let structureOverlayRegistered = false;

/* Realized-liquidation clusters get pink, and the choice is by elimination
   rather than taste: red and green are S/R and long/short on this chart, violet
   and cyan are the GEX pair, gold/blue/orange are the EMA ribbon. A cluster line
   is neither directional nor a forward level, so it must not borrow any of
   those readings.
   Measured, not assumed: white on #db2777 is 4.56:1, which clears 4.5:1. The
   S/R labels next to it do not - white on #f87171 is 2.82:1 - so this is the
   readable one rather than one matching the neighbours at their own level. */
const LIQ_CLUSTER_COLOR = '#db2777';

/* A canvas strokeStyle cannot resolve a CSS custom property. Passing
   'var(--amber)' neither throws nor paints amber - the context keeps whatever
   colour was set last, so the line silently inherits the previous overlay's.
   This file already suspected that (see the EMA_PERIODS note) and nothing had
   confirmed it. Adding the liquidity cluster lines confirmed it by accident:
   EMA9 and EMA200 were painting GREEN, borrowed from the S/R support line, and
   turned PINK the moment a pink overlay drew before them. A colour that
   depends on what else is on the chart is not being read from this file at all.
   Resolved per paint rather than once at overlay creation - the ribbon is not
   recreated on a theme switch, only on a coin or timeframe change - and cached
   per token + theme + design so a repaint is not four getComputedStyle calls. */
const cssColorCache = new Map<string, string>();
function resolveCssColor(color: string): string {
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(color.trim());
  if (!m) return color;
  const root = document.documentElement;
  const key = `${m[1]}|${root.getAttribute('data-theme') ?? ''}|${root.getAttribute('data-design') ?? ''}`;
  const hit = cssColorCache.get(key);
  if (hit !== undefined) return hit;
  const value = getComputedStyle(root).getPropertyValue(m[1]).trim();
  const out = value || color;
  cssColorCache.set(key, out);
  return out;
}

/* One EMA period's ribbon line - drawn as a single continuous polyline overlay,
   not a klinecharts built-in indicator. The indicator system folds every
   plotted value into the pane's Y-axis regardless of the overrideYAxis range
   override further down, confirmed by removing the old EMARibbon indicator
   live and watching the axis snap from ~11x too wide to the correct tight
   range - a klinecharts 10.0.0-beta3 limitation of the indicator pipeline,
   not something fixable via indicator config (series type and value-clamping
   were both tried and neither changed the rendered axis at all). Overlays are
   proven NOT to affect the Y-axis (verified by removing every overlay on the
   chart and seeing zero change), so redrawing the ribbon as an overlay keeps
   the real, correct EMA200 value on screen without it dragging the axis on
   fast timeframes for volatile coins (PEPE/BONK 15m, where EMA200's 200-bar
   lookback still reaches a real multi-day-old price level). */
const EMA_PERIODS = [
  { period: 9,   color: 'var(--amber)', size: 1   },  // gold
  { period: 20,  color: '#60a5fa', size: 1.5 },  // blue
  { period: 50,  color: '#f97316', size: 1.5 },  // orange
  { period: 200, color: 'var(--accent)', size: 2   },  // blue (thicker)
] as const;

// #598 D1: the canvas draws zero blue/orange anywhere on the chart. Only
// these two hardcoded hex values need a terminal swap - period 9/200 above
// already read through --amber/--accent tokens (a separate, pre-existing
// "does a CSS var string resolve inside a canvas fillStyle" question that
// applies to every 'var(--x)' color in this file, not something D1 asked
// for). Picked from QA's confirmed canvas hex list, darker as the period
// lengthens, same convention the ribbon already uses via size.
const TERMINAL_EMA_COLOR: Partial<Record<number, string>> = {
  20: '#8b8f94',
  50: '#5e646b',
};

interface EmaPoint { timestamp: number; value: number; }

function computeEmaSeries(bars: Array<{ timestamp: number; close: number }>, period: number): EmaPoint[] {
  const n = bars.length;
  if (n < period) return [];
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += bars[i].close;
  e /= period;
  const out: EmaPoint[] = [{ timestamp: bars[period - 1].timestamp, value: e }];
  for (let i = period; i < n; i++) {
    e = bars[i].close * k + e * (1 - k);
    out.push({ timestamp: bars[i].timestamp, value: e });
  }
  return out;
}

// How many recent structure breaks to draw. Older ones are history, not
// something to act on, and drawing every break in the window would put the
// chart back where the Arena signal-overload pass found it.
const PA_MAX = 6;

interface SRLevel { price: number; type: 'support' | 'resistance'; touches: number; }

// Deterministic label spacing for S/R / GEX price tags: derived once from the
// level prices themselves, not from live pixel positions. Pixel y only exists
// inside createPointFigures, which klinecharts calls on every repaint - every
// live price tick, crosshair move, or pan - so any "is this close to a
// sibling label" check done there via shared mutable state could answer
// differently between repaints, which is what made the labels visibly
// jitter. Computing it here, once per actual data change, and baking the
// result into each overlay's own extendData keeps every repaint painting the
// same offset until the underlying levels actually change.
function computeLabelOffsets(levels: Array<{ price: number }>): Map<number, number> {
  const offsets = new Map<number, number>();
  if (levels.length < 2) return offsets;
  const sorted = [...levels].sort((a, b) => b.price - a.price);
  const spread = sorted[0].price - sorted[sorted.length - 1].price;
  const CLOSE = Math.max(spread * 0.025, 1e-9);
  let stack = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i - 1].price - sorted[i].price < CLOSE) stack += 1;
    else stack = 0;
    offsets.set(sorted[i].price, stack * 13);
  }
  return offsets;
}

// VOL/RSI sub-pane heights were a fixed 60px/70px regardless of total chart
// height. Fine at the ~500px mobile default, but the chart is user-resizable
// up to 1000px (see CHART_H_MIN/CHART_H_MAX below) and the price pane soaked
// up every extra pixel while these two stayed pinned - on a tall chart they
// shrank to a barely-readable sliver relative to the candles. Scale them with
// the container instead, clamped so they don't get silly at either extreme.
function applyProportionalPaneHeights(chart: KChart, containerHeight: number) {
  if (!containerHeight) return;
  const volH = Math.round(Math.min(140, Math.max(30, containerHeight * 0.09)));
  const rsiH = Math.round(Math.min(170, Math.max(30, containerHeight * 0.11)));
  chart.setPaneOptions({ id: 'vol_pane', height: volH });
  chart.setPaneOptions({ id: 'rsi_pane', height: rsiH });
}

function computeSRLevels(
  bars: { high: number; low: number; close: number }[],
  currentPrice: number,
): SRLevel[] {
  const lookback = 3;
  const recent = bars.slice(-200);
  const CLUSTER_PCT = 0.003;

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = lookback; i < recent.length - lookback; i++) {
    const hi = recent[i].high;
    const lo = recent[i].low;
    if (
      recent.slice(i - lookback, i).every(b => b.high <= hi) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.high <= hi)
    ) swingHighs.push(hi);
    if (
      recent.slice(i - lookback, i).every(b => b.low >= lo) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.low >= lo)
    ) swingLows.push(lo);
  }

  const cluster = (prices: number[]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: { price: number; count: number }[] = [];
    for (const p of sorted) {
      const ex = clusters.find(c => Math.abs(c.price - p) / p < CLUSTER_PCT);
      if (ex) { ex.price = (ex.price * ex.count + p) / (ex.count + 1); ex.count++; }
      else clusters.push({ price: p, count: 1 });
    }
    return clusters.sort((a, b) => b.count - a.count);
  };

  const resistances = cluster(swingHighs)
    .filter(c => c.price > currentPrice * 0.999)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'resistance' as const, touches: c.count }));

  const supports = cluster(swingLows)
    .filter(c => c.price < currentPrice * 1.001)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'support' as const, touches: c.count }));

  return [...resistances, ...supports];
}

export default function KLineProChart({ coin, tf, onTfChange, result, emaSignal, chartAlerts, onAlertMove, gexLevels, liqClusters, onStructure }: Props) {
  const mode = useDesignMode();
  /* The init effect below runs once and must not re-run when the design mode
     resolves - re-creating the chart would throw away its data. So it reads
     the mode through a ref rather than closing over the value it happened to
     have at mount. The theme-sync effect still corrects a late resolve; this
     only means the FIRST paint is already right when the mode is known by
     then, which it usually is. */
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const containerRef   = useRef<HTMLDivElement>(null);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const canvasFadeRef  = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<KChart | null>(null);
  const wsRef          = useRef<{ close: () => void } | null>(null);
  const analysisIds    = useRef<string[]>([]);
  const gexLevelIds    = useRef<string[]>([]);
  const liqClusterIds  = useRef<string[]>([]);
  // One overlay id per EMA_PERIODS entry, in the same order - null until the
  // overlay has actually been created (first sync after data loads).
  const emaRibbonIds   = useRef<Array<string | null>>(EMA_PERIODS.map(() => null));
  // Full bar history for EMA recompute - klinecharts keeps its own candle list
  // internally, but doesn't expose a stable "give me everything you have"
  // read outside its own indicator/DataLoader lifecycle, so this mirrors it:
  // replaced whole on load, upserted (append or replace-last) on each live tick.
  const emaBarsRef     = useRef<Array<{ timestamp: number; close: number }>>([]);
  const alertOverlayMap  = useRef<Map<string, string>>(new Map()); // alert.id → overlay id
  const onAlertMoveRef = useRef(onAlertMove);
  const coinRef        = useRef<CoinId>(coin);

  // Screenshot the live canvas → show it as a frozen image while new data loads → crossfade out
  const startFade = () => {
    const el = canvasFadeRef.current;
    if (!el) return;
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas) {
      try {
        el.style.backgroundImage = `url(${canvas.toDataURL()})`;
      } catch { /* cross-origin guard */ }
    }
    el.style.transition = 'none';
    el.style.opacity = '1';
  };
  const endFade = () => {
    const el = canvasFadeRef.current;
    if (!el) return;
    el.style.transition = 'opacity 0.35s ease';
    el.style.opacity = '0';
    setTimeout(() => { if (canvasFadeRef.current) canvasFadeRef.current.style.backgroundImage = 'none'; }, 400);
  };
  const [activeTool,   setActiveTool]  = useState<string | null>(null);
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const [wsStatus,     setWsStatus]    = useState<'connecting' | 'live' | 'error'>('connecting');
  const [fullscreen,   setFullscreen]  = useState(false);
  const [chartReady,   setChartReady]  = useState(false);
  /* Which ink the overlays are drawn with. Only the price-alert line needs it
     as state - its colour is fixed when the overlay is created, so the effect
     that creates them has to re-run when the theme flips (#752). */
  const [themeInk,     setThemeInk]    = useState<'dark' | 'light'>('dark');
  const [countdown,    setCountdown]   = useState('-');
  const [priceLabelY,  setPriceLabelY] = useState<number | null>(null);
  const lastCloseRef   = useRef<number>(0);
  /* Newest bar timestamp the live stream has delivered. The backfill on
     reconnect (#313) fetches everything after it - without this there is no way
     to know how much of the series the outage cost. */
  const lastBarTsRef   = useRef<number>(0);
  /* Which feed produced the chart's history. The gap backfill reads it so a
     recovery never mixes feeds - see the note at the getBars fallback (#359). */
  const histSourceRef  = useRef<'binance' | 'binance-futures'>('binance');
  const [showSR, setShowSR]       = useState(true);
  const [srLevels, setSrLevels]   = useState<SRLevel[]>([]);
  const srSetRef                  = useRef(setSrLevels);
  // Market-structure breaks (lib/priceAction.ts) - a second, price-only read
  // that runs alongside the EMA ribbon markers without touching them. Off by
  // default: the Arena signal-overload pass deliberately reduced what shows on
  // this chart, so a new marker family opts in rather than arriving unasked.
  const [showPA, setShowPA]       = useState(false);
  /* Realized liquidation clusters. ON by default, unlike showPA above: the
     owner asked for these to be displayed on the chart (#766) and a feature
     that has to be discovered through a toolbar button is not displayed. The
     toggle exists because eight extra horizontal lines is real ink on a chart
     that had a deliberate signal-reduction pass - a user who wants the candles
     alone gets one click, not a setting. */
  const [showLiq, setShowLiq]     = useState(true);
  const [paSignals, setPaSignals] = useState<PASignal[]>([]);
  const paSetRef                  = useRef(setPaSignals);
  const [sqHover, setSqHover]     = useState(false);
  const [rwTooltip, setRwTooltip] = useState<{ x: number; y: number; dir: 'bullish' | 'bearish' } | null>(null);

  // User-adjustable chart height (drag handle below the canvas), persisted.
  // null = follow the responsive CSS default (taller-than-wide on mobile);
  // a number = explicit px override the user dragged to. The existing
  // ResizeObserver on containerRef re-fits klinecharts when this changes.
  const CHART_H_MIN = 260;
  const CHART_H_MAX = 1000;
  const [chartHeight, setChartHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lhq_chart_height');
      if (saved) {
        const n = parseInt(saved, 10);
        // Clamp to the CURRENT viewport, not just the absolute min/max - a height
        // dragged tall on a desktop window shouldn't carry over verbatim to a
        // phone (it was swallowing the whole mobile screen: 872px saved on a
        // 812px-tall viewport).
        const viewportCap = Math.round(window.innerHeight * 0.65);
        const clamped = Math.min(n, viewportCap);
        if (Number.isFinite(n) && n >= CHART_H_MIN && n <= CHART_H_MAX && clamped >= CHART_H_MIN) setChartHeight(clamped);
      }
    } catch { /* ignore */ }
  }, []);

  const onResizeStart = (clientY: number) => {
    const h = containerRef.current?.getBoundingClientRect().height ?? 380;
    dragRef.current = { startY: clientY, startH: h };
  };
  const onResizeMove = useCallback((clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.max(CHART_H_MIN, Math.min(CHART_H_MAX, Math.round(d.startH + (clientY - d.startY))));
    setChartHeight(next);
  }, []);
  const onResizeEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setChartHeight(h => {
      if (h != null) { try { localStorage.setItem('lhq_chart_height', String(h)); } catch { /* ignore */ } }
      return h;
    });
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragRef.current) { e.preventDefault(); onResizeMove(e.clientY); } };
    const up   = () => onResizeEnd();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onResizeMove, onResizeEnd]);
  const { store } = useMarket();
  const coinData = store.coins[coin];
  const srOverlayIds              = useRef<string[]>([]);
  const paOverlayIds              = useRef<string[]>([]);
  const userDrawOverlayIds        = useRef<string[]>([]);
  // Track the last loaded coin/tf so we only re-fetch what actually changed,
  // and a monotonic load token so stale in-flight fetches are dropped on arrival.
  const prevCoinRef    = useRef<CoinId>(coin);
  const prevTfRef      = useRef<ChartTf>(tf);
  const loadGenRef     = useRef(0);

  // ── Candle-close countdown ───────────────────────────────────────────
  useEffect(() => {
    const MS: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
      '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    const periodMs = MS[tf];
    if (!periodMs) return;
    const tick = () => {
      const remain = periodMs - (Date.now() % periodMs);
      const h = Math.floor(remain / 3_600_000);
      const m = Math.floor((remain % 3_600_000) / 60_000);
      const s = Math.floor((remain % 60_000) / 1_000);
      setCountdown(h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tf]);

  useEffect(() => { onAlertMoveRef.current = onAlertMove; }, [onAlertMove]);

  // ── Price-label Y position - used to anchor the countdown below the price mark ──
  useEffect(() => {
    if (!chartReady) return;
    const chart = chartRef.current;
    if (!chart) return;

    const compute = () => {
      const price = lastCloseRef.current;
      if (!price) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const px = (chart as any).convertToPixel?.({ value: price }, { paneId: 'candle_pane' });
        if (px && typeof px.y === 'number' && isFinite(px.y) && px.y > 0) {
          setPriceLabelY(px.y);
        }
      } catch { /* ignore */ }
    };

    compute();
    // Re-run on zoom / scroll / new data
    const events = ['onVisibleRangeChange', 'onScroll', 'onZoom'] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events.forEach(ev => (chart as any).subscribeAction?.(ev, compute));
    // Polling fallback: picks up live price movement that doesn't fire scroll/zoom events
    const poll = setInterval(compute, 1500);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events.forEach(ev => (chart as any).unsubscribeAction?.(ev, compute));
      clearInterval(poll);
    };
  }, [chartReady]);

  // ── Theme sync - apply DARK/LIGHT/TERMINAL_DARK styles when theme or
  //    design mode changes. #598 D1 follow-up: this used to run once at
  //    mount with `[]` deps and read `data-design` off the DOM directly -
  //    chartRef.current was still null the first time (every sibling effect
  //    gates on chartReady for exactly this reason), so setStyles() was a
  //    silent no-op, and nothing ever re-ran it once the chart mounted or
  //    once design mode resolved. QA caught it via canvas pixel sampling:
  //    candles were still painting DARK.upColor, tags were still painting
  //    klinecharts' own untouched default. `mode` from useDesignMode() is
  //    now a real dependency, so this re-fires on both. ─────────────────
  useEffect(() => {
    if (!chartReady) return;
    const apply = () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      /* LIGHT WINS OVER TERMINAL (#758, owner ruling). This read
         `mode === 'terminal' ? TERMINAL_DARK : dark ? DARK : LIGHT` - `dark`
         was computed on the line above and then discarded on the terminal
         branch, so terminal + light theme painted the DARK chart onto a light
         page. The canvas is transparent, so the ground is .klc-wrap's
         var(--bg) = #E8EAED there, and against it:

           last-price text  #e8e9ea   1.01     the number the chart exists for
           candle up        #3fb950   2.11
           priceMark hi/lo  #8b8f94   2.70
           axis tickText    #7c828a   3.22

         There is no terminal-light palette. The owner chose this fallback over
         building one, accepting that in light mode the chart will not match
         the terminal shell around it - a chart that looks slightly out of
         place beats one whose price readout is at 1.01. That is the end state,
         not a stopgap: no fourth palette is booked. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chartRef.current?.setStyles(paletteFor(dark, mode === 'terminal') as any);
      /* Overlay ink follows the THEME only - the overlays are drawn on a
         transparent canvas over .klc-wrap's var(--bg), which is #000000 in
         both dark themes and #E8EAED in both light ones (#752). Bumping
         themeInk re-runs the price-alert effect, whose colour is fixed at
         createOverlay time; the marker reads overlayInk at draw time and
         needs no re-creation. */
      overlayInk = dark ? OVERLAY_INK.dark : OVERLAY_INK.light;
      setThemeInk(dark ? 'dark' : 'light');
    };
    apply();
    // Theme (not design mode) can still change without a re-render of this
    // component - 'theme-change' covers that; `mode` in the dependency
    // array below covers design mode resolving or changing.
    window.addEventListener('theme-change', apply);
    /* And an observer, because this effect READS an attribute rather than
       being told about it. On #707 that exact shape was wrong: a page effect
       read --bg3 before DesignModeProvider had set data-design, and the answer
       was plausible and stale. 'theme-change' only fires from lib/theme.ts's
       own paths, so a theme set any other way - and the initial resolve
       ordering - reaches this only by watching the attribute. Cheap, and it
       removes the assumption rather than betting on it. */
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme', 'data-design'],
    });
    return () => {
      observer.disconnect();
      window.removeEventListener('theme-change', apply);
    };
  }, [chartReady, mode]);

  // Keep coinRef fresh for the DataLoader closure
  useEffect(() => { coinRef.current = coin; }, [coin]);

  // Recompute all 4 EMA lines from the full bar history and push them onto
  // the chart - create the overlay the first time, overrideOverlay (in
  // place, no remove/recreate flicker) every time after. Called after every
  // DataLoader callback: full history load, and each live tick.
  const syncEmaRibbon = useCallback(() => {
    const chart = chartRef.current;
    const bars = emaBarsRef.current;
    if (!chart || !bars.length) return;
    const terminal = document.documentElement.getAttribute('data-design') === 'terminal';
    EMA_PERIODS.forEach((cfg, idx) => {
      const series = computeEmaSeries(bars, cfg.period);
      if (!series.length) return;
      const points = series.map(p => ({ timestamp: p.timestamp, value: p.value }));
      const existingId = emaRibbonIds.current[idx];
      if (existingId) {
        chart.overrideOverlay({ id: existingId, points });
      } else {
        const id = chart.createOverlay({
          name: 'emaRibbonLine',
          points,
          // Locked, like every other non-drawing overlay on this chart
          // (emaSignal, reversalWarning, srLevelLine, gexLevelLine,
          // analysisLevelLine all set this). Without it klinecharts treats the
          // ribbon as a user-editable drawing: grabbing an EMA line dragged it
          // off the price data, and since each line carries hundreds of points
          // there was no way to put it back short of switching coin or
          // timeframe to force a rebuild.
          //
          // This is the cost of drawing the ribbon as an overlay rather than an
          // indicator - see the EMA_PERIODS comment for why that trade was made.
          // Indicators are inert; overlays are interactive by default, so every
          // overlay that represents DATA rather than a user drawing has to opt
          // out explicitly.
          //
          // lock only gates mouse-down and pressed-move (klinecharts
          // index.esm.js: `if (overlay.lock) return false` in
          // _figureMouseDownEvent, plus the `!overlay.lock` guard on
          // onPressedMoving), so hover and tooltips are unaffected.
          lock: true,
          extendData: { color: terminal ? (TERMINAL_EMA_COLOR[cfg.period] ?? cfg.color) : cfg.color, size: cfg.size },
          // Higher zLevel paints on top. EMA_PERIODS is ordered fast-to-slow
          // (9, 20, 50, 200), so EMA200 (idx 3, thickest) ends up on top and
          // EMA9 (idx 0, thinnest) on the bottom - matches the original
          // indicator's figures: [e9, e20, e50, e200] array, where klinecharts
          // paints later entries over earlier ones.
          zLevel: idx,
        } as OverlayCreate);
        emaRibbonIds.current[idx] = typeof id === 'string' ? id : null;
      }
    });
  }, []);

  // Upsert one live-updating bar into the EMA history: replace the last entry
  // if it's the same (still-forming) candle, append if it's a genuinely new
  // one - mirrors how the DataLoader's own callback(bar) distinguishes an
  // update to the current candle from the start of the next one.
  const upsertEmaBar = useCallback((bar: { timestamp: number; close: number }) => {
    const bars = emaBarsRef.current;
    const last = bars[bars.length - 1];
    if (last && last.timestamp === bar.timestamp) bars[bars.length - 1] = bar;
    else bars.push(bar);
    syncEmaRibbon();
  }, [syncEmaRibbon]);

  // ── Init chart once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    (async () => {
      const kc = await import('klinecharts');
      if (disposed || !containerRef.current) return;

      const chart = kc.init(containerRef.current);
      if (!chart) return;
      chartRef.current = chart;

      // Apply current theme via setStyles (avoids DeepPartial type gymnastics)
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart.setStyles(paletteFor(dark, modeRef.current === 'terminal') as any);

      // EMA 9/20/50/200 ribbon - drawn as 4 emaRibbonLine overlays (registered
      // below, synced via syncEmaRibbon), not a klinecharts built-in indicator.
      // See the EMA_PERIODS comment above for why.
      chart.createIndicator('VOL', { pane: { id: 'vol_pane', height: 90, minHeight: 30 } });
      // RSI-14 (Wilder's smoothing) - matches the period used everywhere else
      // in the app (marketStore rsi14/rsi1h/rsi4h/rsiDaily), instead of the
      // built-in indicator's default 3-line [6,12,24] preset.
      chart.createIndicator(
        { name: 'RSI', calcParams: [14], styles: { lines: [{ color: 'var(--accent-2)', size: 1.5 }] } },
        { pane: { id: 'rsi_pane', height: 110, minHeight: 30 } }
      );

      // Keeps this pane's Y-axis tracking only the VISIBLE candles' high/low,
      // not the full loaded history. candle_pane hosts no klinecharts
      // indicators (RSI/VOL live in their own panes; the EMA ribbon below is
      // drawn as overlays, not an indicator) - it did until 2026-08, when the
      // EMA200 line was still a registered indicator here. klinecharts folds
      // every indicator's value into a pane's auto Y-range unconditionally,
      // and neither this override's createRange NOR the indicator's own
      // series type stopped it: a long EMA sitting far from the current price
      // cluster still dragged the whole axis wide enough to crush real
      // candles into a fraction of the pane, confirmed live on PEPE/BONK's
      // 15m chart (measured ~11x wider than the actual visible price range).
      // Fixed by moving the ribbon off the indicator pipeline entirely, not
      // by anything in this function - overlays are exempt from that fold,
      // proven by removing every overlay on the chart and watching the axis
      // not move at all. This override stays as a still-useful, still-correct
      // safety net for the visible-range-only behavior itself.
      chart.overrideYAxis({
        paneId: 'candle_pane',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createRange: ({ chart: c, defaultRange }: any) => {
          try {
            const vis = c.getVisibleRange();
            const bars = c.getDataList();
            const from = Math.max(0, Math.floor(vis.realFrom));
            const to = Math.min(bars.length - 1, Math.ceil(vis.realTo));
            let lo = Infinity, hi = -Infinity;
            for (let i = from; i <= to; i++) {
              const b = bars[i];
              if (!b) continue;
              if (b.low  < lo) lo = b.low;
              if (b.high > hi) hi = b.high;
            }
            if (!isFinite(lo) || !isFinite(hi)) return defaultRange;
            return { ...defaultRange, realFrom: lo, realTo: hi, realRange: hi - lo };
          } catch {
            return defaultRange;
          }
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (!emaSignalOverlayRegistered) {
        emaSignalOverlayRegistered = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'emaSignal',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // Hovering a marker reveals the price the signal actually fired at.
          // The marker is drawn offset from its anchor so it does not cover the
          // candle, which means you cannot read the level off the y-axis by
          // eye - the number has to be stated. extendData is mutated in place
          // and the chart told to repaint, because a stationary cursor emits no
          // further mousemove, so relying on the next natural frame would leave
          // the label missing until the user jiggled the mouse.
          onMouseEnter: (e: any) => {
            if (e?.overlay?.extendData) {
              e.overlay.extendData.hovered = true;
              e.chart?.overrideOverlay({ id: e.overlay.id, extendData: e.overlay.extendData });
            }
          },
          onMouseLeave: (e: any) => {
            if (e?.overlay?.extendData) {
              e.overlay.extendData.hovered = false;
              e.chart?.overrideOverlay({ id: e.overlay.id, extendData: e.overlay.extendData });
            }
          },
          createPointFigures: ({ overlay, coordinates }: { overlay: any; coordinates: Array<{ x: number; y: number }> }) => {
            const { dir, pending, price, hovered } = overlay.extendData as {
              dir: 'long' | 'short'; pending: boolean; price?: number; hovered?: boolean;
            };
            const coord = coordinates[0];
            if (!coord || !isFinite(coord.x) || !isFinite(coord.y) || coord.x < 0 || coord.y < 0) return [];
            const x = coord.x;
            const y = coord.y;

            // Sits on the far side of the marker from the candle - below a Buy,
            // above a Sell - so it never lands on top of the price action.
            const priceTag = (): any[] => {
              if (!hovered || price == null || !isFinite(price)) return [];
              const isLong = dir === 'long';
              const tagY = isLong ? y + 40 : y - 40;
              const col = pending
                ? (isLong ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)')
                : (isLong ? '#22c55e' : '#ef4444');
              return [{
                type: 'text',
                // Trailing zeros stripped: an alt priced at 0.00001234 and BTC
                // at 67000 cannot share a fixed precision, and toPrecision
                // leaves "67000.0000" style noise on the large ones.
                attrs: {
                  x, y: tagY,
                  text: '$' + Number(price.toPrecision(6)).toString(),
                  align: 'center', baseline: 'middle',
                },
                styles: {
                  color: '#ffffff', size: 10, weight: 'bold',
                  paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3,
                  borderRadius: 3, backgroundColor: col,
                },
              }];
            };
            if (dir === 'long') {
              if (pending) {
                return [
                  {
                    type: 'polygon',
                    attrs: { coordinates: [{ x, y: y + 4 }, { x: x - 14, y: y + 28 }, { x: x + 14, y: y + 28 }] },
                    styles: { style: 'stroke', borderColor: 'rgba(34,197,94,0.6)', borderSize: 1.5, borderStyle: 'dashed', borderDashedValue: [3, 3] },
                  },
                  {
                    type: 'text',
                    attrs: { x, y: y + 20, text: 'FORMING', align: 'center', baseline: 'middle' },
                    styles: { color: 'rgba(34,197,94,0.85)', size: 7, weight: 'bold', backgroundColor: 'transparent' },
                  },
                  ...priceTag(),
                ];
              }
              return [
                {
                  type: 'polygon',
                  attrs: { coordinates: [{ x, y: y + 4 }, { x: x - 14, y: y + 28 }, { x: x + 14, y: y + 28 }] },
                  styles: { style: 'fill', color: '#22c55e' },
                },
                {
                  type: 'text',
                  attrs: { x, y: y + 20, text: 'Buy', align: 'center', baseline: 'middle' },
                  styles: { color: '#ffffff', size: 9, weight: 'bold', backgroundColor: 'transparent' },
                },
                ...priceTag(),
              ];
            }
            if (pending) {
              return [
                {
                  type: 'polygon',
                  attrs: { coordinates: [{ x, y: y - 4 }, { x: x - 14, y: y - 28 }, { x: x + 14, y: y - 28 }] },
                  styles: { style: 'stroke', borderColor: 'rgba(239,68,68,0.6)', borderSize: 1.5, borderStyle: 'dashed', borderDashedValue: [3, 3] },
                },
                {
                  type: 'text',
                  attrs: { x, y: y - 20, text: 'FORMING', align: 'center', baseline: 'middle' },
                  styles: { color: 'rgba(239,68,68,0.85)', size: 7, weight: 'bold', backgroundColor: 'transparent' },
                },
                ...priceTag(),
              ];
            }
            return [
              {
                type: 'polygon',
                attrs: { coordinates: [{ x, y: y - 4 }, { x: x - 14, y: y - 28 }, { x: x + 14, y: y - 28 }] },
                styles: { style: 'fill', color: '#ef4444' },
              },
              {
                type: 'text',
                attrs: { x, y: y - 20, text: 'Sell', align: 'center', baseline: 'middle' },
                styles: { color: '#ffffff', size: 9, weight: 'bold', backgroundColor: 'transparent' },
              },
              ...priceTag(),
            ];
          },
        });
      }

      if (!structureOverlayRegistered) {
        structureOverlayRegistered = true;
        // Market-structure break. Colour family is deliberately NOT the
        // green/red of the EMA buy/sell markers, nor the amber of the reversal
        // diamond - a trader glancing at this chart has to be able to tell
        // instantly which system fired, and three signal types sharing two
        // colours would defeat that. Sky blue for bullish structure, violet for
        // bearish, with the direction also written into the glyph so the
        // meaning survives for anyone who reads colour poorly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'structureBreak',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates }: { overlay: any; coordinates: Array<{ x: number; y: number }> }) => {
            const { dir, kind, volumeBacked } = overlay.extendData as {
              dir: 'bull' | 'bear'; kind: 'BOS' | 'CHOCH'; volumeBacked: boolean;
            };
            const coord = coordinates[0];
            if (!coord || !isFinite(coord.x) || !isFinite(coord.y) || coord.x < 0 || coord.y < 0) return [];
            const isBull = dir === 'bull';
            const col = isBull ? '#38bdf8' : '#a78bfa';
            // Placed on the far side of the candle from the EMA markers, which
            // sit within 28px of their anchor - keeps the two families from
            // colliding when both fire on the same bar.
            const y = isBull ? coord.y + 46 : coord.y - 46;
            // Volume backing is written into the text rather than drawn as an
            // outline: only the styles already proven on the other text figures
            // in this file are used here, and "did anyone actually trade this
            // level" reads better as a mark than as a 1px border nobody notices.
            const label = `${isBull ? '▲' : '▼'} ${kind === 'CHOCH' ? 'CHoCH' : 'BOS'}${volumeBacked ? ' ⚡' : ''}`;
            return [
              {
                type: 'text',
                attrs: { x: coord.x, y, text: label, align: 'center', baseline: 'middle' },
                styles: {
                  color: '#ffffff', size: 9, weight: 'bold',
                  paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
                  borderRadius: 2, backgroundColor: col,
                },
              },
            ];
          },
        });
      }

      if (!reversalOverlayRegistered) {
        reversalOverlayRegistered = true;
        // Amber diamond - deliberately NOT green/red like the confirmed buy/sell
        // markers. This is a leading exhaustion warning (RSI divergence), not an
        // instruction - different color family so it can't be mistaken for one.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'reversalWarning',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates }: { overlay: any; coordinates: Array<{ x: number; y: number }> }) => {
            const { dir } = overlay.extendData as { dir: 'bullish' | 'bearish' };
            const coord = coordinates[0];
            if (!coord || !isFinite(coord.x) || !isFinite(coord.y) || coord.y < 0) return [];
            const cx = coord.x;
            // bearish warning sits above price (potential top); bullish sits below (potential bottom)
            const cy = dir === 'bearish' ? coord.y - 24 : coord.y + 24;
            // N-gon approximating a circle - used to build the ring layers
            const ring = (r: number, n = 16): Array<{ x: number; y: number }> => {
              const pts: Array<{ x: number; y: number }> = [];
              for (let i = 0; i < n; i++) {
                const a = (2 * Math.PI / n) * i - Math.PI / 2;
                pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
              }
              return pts;
            };
            // Chevron direction: V-down for bearish (potential top), V-up for bullish (potential bottom)
            const v = dir === 'bearish'
              ? [{ x: cx - 3.5, y: cy - 2.5 }, { x: cx, y: cy + 2.5 }, { x: cx + 3.5, y: cy - 2.5 }]
              : [{ x: cx - 3.5, y: cy + 2.5 }, { x: cx, y: cy - 2.5 }, { x: cx + 3.5, y: cy + 2.5 }];
            return [
              // Outer glow ring
              { type: 'polygon', attrs: { coordinates: ring(12) }, styles: { style: 'stroke', borderColor: overlayInk.markerGlow, borderSize: 5 } },
              // Translucent amber fill
              { type: 'polygon', attrs: { coordinates: ring(9) }, styles: { style: 'fill', color: overlayInk.markerFill } },
              // Crisp amber ring
              { type: 'polygon', attrs: { coordinates: ring(9) }, styles: { style: 'stroke', borderColor: overlayInk.markerRing, borderSize: 1.5 } },
              // Center diamond accent. Was 'var(--amber-2)', which a canvas
              // fillStyle cannot resolve - it never drew (#752).
              { type: 'polygon', attrs: { coordinates: [{ x: cx, y: cy - 3 }, { x: cx + 3, y: cy }, { x: cx, y: cy + 3 }, { x: cx - 3, y: cy }] }, styles: { style: 'fill', color: overlayInk.markerCore } },
              // Directional chevron (two line segments)
              { type: 'line', attrs: { coordinates: [v[0], v[1]] }, styles: { color: overlayInk.chevron, size: 1.5 } },
              { type: 'line', attrs: { coordinates: [v[1], v[2]] }, styles: { color: overlayInk.chevron, size: 1.5 } },
            ];
          },
        });
      }

      if (!emaRibbonLineRegistered) {
        emaRibbonLineRegistered = true;
        // One continuous polyline per EMA period - see the EMA_PERIODS /
        // computeEmaSeries / syncEmaRibbon comments above for why this
        // replaced a klinecharts built-in indicator.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'emaRibbonLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates }: { overlay: any; coordinates: Array<{ x: number; y: number }> }) => {
            const { color, size } = overlay.extendData as { color: string; size: number };
            const pts = coordinates.filter(c => c && isFinite(c.x) && isFinite(c.y));
            if (pts.length < 2) return [];
            return [{
              type: 'line',
              attrs: { coordinates: pts },
              styles: { style: 'solid', color: resolveCssColor(color), size },
            }];
          },
        });
      }

      if (!srLevelLineRegistered) {
        srLevelLineRegistered = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'srLevelLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates, bounding }: { overlay: any; coordinates: Array<{ x: number; y: number }>; bounding: any }) => {
            const { srType, price, labelYOffset } = overlay.extendData as { srType: 'support' | 'resistance'; price: number; labelYOffset?: number };
            const y = coordinates[0]?.y;
            if (y == null || !isFinite(y) || y < 0) return [];
            const color = srType === 'resistance' ? '#f87171' : '#34d399';
            const rightX = (bounding?.width ?? 9999);
            const labelY = y - 3 - (labelYOffset ?? 0);
            return [
              {
                type: 'line',
                attrs: { coordinates: [{ x: 0, y }, { x: rightX, y }] },
                styles: { style: 'dashed', color, size: 1, dashedValue: [4, 3] },
              },
              {
                type: 'text',
                attrs: { x: rightX - 6, y: labelY, text: `${srType === 'resistance' ? 'R' : 'S'} $${fmtPx(price)}`, align: 'right', baseline: 'bottom' },
                // #598 D1 residual, QA pixel-sampled: no backgroundColor meant
                // klinecharts filled the label with its own default primary
                // (#1677ff) instead of anything from this file's palette -
                // same shape as the priceTag figure above, which already
                // sets its own backgroundColor and never had the bug.
                styles: {
                  color: '#ffffff', size: 9, weight: '700',
                  paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
                  backgroundColor: color,
                  // registerOverlay is a one-time, module-level registration
                  // (srLevelLineRegistered guards it) - createPointFigures is
                  // what runs per repaint, so design mode has to be read
                  // fresh here rather than closed over from a React value at
                  // registration time, same reason the EMA ribbon colour
                  // above reads document.documentElement directly instead of
                  // capturing `mode`.
                  borderRadius: document.documentElement.getAttribute('data-design') === 'terminal' ? 0 : 3,
                },
              },
            ];
          },
        });
      }

      if (!gexLevelLineRegistered) {
        gexLevelLineRegistered = true;
        // GEX context lines (BTC options): the max-pain magnet and the zero-gamma
        // flip level. Deliberately OFF the green/red/amber palette used by S/R,
        // buy/sell markers and warnings - violet = magnet, cyan = regime boundary -
        // so they can never be mistaken for a directional signal. Context only.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'gexLevelLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates, bounding }: { overlay: any; coordinates: Array<{ x: number; y: number }>; bounding: any }) => {
            const { gexType, price, labelYOffset } = overlay.extendData as { gexType: 'maxpain' | 'flip'; price: number; labelYOffset?: number };
            const y = coordinates[0]?.y;
            if (y == null || !isFinite(y) || y < 0) return [];
            const color = gexType === 'maxpain' ? '#a78bfa' : '#22d3ee';
            const label = gexType === 'maxpain' ? 'MAX PAIN' : 'γ FLIP';
            const rightX = (bounding?.width ?? 9999);
            const labelY = y - 3 - (labelYOffset ?? 0);
            return [
              {
                type: 'line',
                attrs: { coordinates: [{ x: 0, y }, { x: rightX, y }] },
                styles: { style: 'dashed', color, size: 1, dashedValue: [2, 4] },
              },
              {
                type: 'text',
                attrs: { x: 6, y: labelY, text: `${label} $${fmtPx(price)}`, align: 'left', baseline: 'bottom' },
                styles: {
                  color: '#ffffff', size: 9, weight: '700',
                  paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
                  backgroundColor: color,
                  borderRadius: document.documentElement.getAttribute('data-design') === 'terminal' ? 0 : 3,
                },
              },
            ];
          },
        });
      }

      if (!liqClusterLineRegistered) {
        liqClusterLineRegistered = true;
        /* Realized liquidation clusters - the price levels where positions
           actually blew up over the last 24h, streamed live from Binance
           forceOrder and Bybit allLiquidation (components/LiqFeed.tsx).
           THE LABEL IS THE SAFETY-CRITICAL PART, not the geometry. Coinglass
           sold PREDICTED liquidation levels: where open positions WOULD blow
           up, which traders read as a forward magnet. These are the opposite -
           fuel already spent, price memory. Drawn on a chart the two are
           indistinguishable, so the word REALIZED is in the label itself and
           __tests__/liqClusters.test.mts asserts it stays there. A line that
           silently changes tense is confidently wrong with nothing to reveal
           it.
           Dotted rather than dashed, and thinner than the GEX pair, because
           eight of them share the plot with the candles they are context for. */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'liqClusterLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates, bounding }: { overlay: any; coordinates: Array<{ x: number; y: number }>; bounding: any }) => {
            const { price, total, labelYOffset } = overlay.extendData as { price: number; total: number; labelYOffset?: number };
            const y = coordinates[0]?.y;
            if (y == null || !isFinite(y) || y < 0) return [];
            const rightX = (bounding?.width ?? 9999);
            const labelY = y - 3 - (labelYOffset ?? 0);
            return [
              {
                type: 'line',
                attrs: { coordinates: [{ x: 0, y }, { x: rightX, y }] },
                styles: { style: 'dashed', color: LIQ_CLUSTER_COLOR, size: 1, dashedValue: [1, 4] },
              },
              {
                type: 'text',
                attrs: { x: 6, y: labelY, text: `REALIZED LIQ $${fmtPx(price)} · ${fmtLiqUsd(total)}`, align: 'left', baseline: 'bottom' },
                styles: {
                  color: '#ffffff', size: 9, weight: '700',
                  paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
                  backgroundColor: LIQ_CLUSTER_COLOR,
                  borderRadius: document.documentElement.getAttribute('data-design') === 'terminal' ? 0 : 3,
                },
              },
            ];
          },
        });
      }

      if (!analysisLevelLineRegistered) {
        analysisLevelLineRegistered = true;
        // Entry/stop/target used to draw as the built-in `horizontalStraightLine`
        // overlay - a plain colored dash with no text, while S/R and GEX levels
        // right next to them get a price-tag label. Visually the three most
        // important levels on the chart were the LEAST identifiable ones: a
        // trader had to cross-reference the color against the text grid above
        // to know which line was which, and an entry line sitting a few dollars
        // from a resistance level was often indistinguishable from it. Same
        // registerOverlay shape as srLevelLine/gexLevelLine, just its own label
        // text and color per kind.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'analysisLevelLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates, bounding }: { overlay: any; coordinates: Array<{ x: number; y: number }>; bounding: any }) => {
            const { label, price, color } = overlay.extendData as { label: string; price: number; color: string };
            const y = coordinates[0]?.y;
            if (y == null || !isFinite(y) || y < 0) return [];
            const rightX = (bounding?.width ?? 9999);
            return [
              {
                type: 'line',
                attrs: { coordinates: [{ x: 0, y }, { x: rightX, y }] },
                styles: { style: 'dashed', color, size: 1.5, dashedValue: [5, 3] },
              },
              {
                type: 'text',
                attrs: { x: 6, y: y - 3, text: `${label} $${fmtPx(price)}`, align: 'left', baseline: 'bottom' },
                styles: { color, size: 10, weight: '700' },
              },
            ];
          },
        });
      }

      // DataLoader
      const loader: DataLoader = {
        getBars: async ({ symbol, period, callback }) => {
          // Snapshot the load token; if a newer coin/tf switch happens while this
          // fetch is in flight, the result is stale and must be discarded so it
          // can't overwrite the chart with the wrong timeframe/coin.
          const myGen = loadGenRef.current;
          const stale = () => myGen !== loadGenRef.current;
          const c   = coinRef.current;
          const bnSym    = BINANCE_SYMS[c] as string | undefined;
          const bybitSym = BYBIT_SYMS[c]   as string | undefined;
          try {
            if (bnSym) {
              const iv = periodToBnInterval(period);
              // Futures FIRST, then spot, then Bybit.
              //
              // This used to hit api.binance.com (spot) only, with no fallback,
              // and a `catch` that silently called back with an empty array. If
              // that one host was unreachable the user got a blank chart with no
              // explanation - which is exactly what happened: verified live that
              // api.binance.com fails from the browser while fapi.binance.com,
              // the Binance websockets and Bybit all answer normally, and that
              // the same spot URL returns 200 from a server. So it is blocked at
              // the browser, not the network.
              //
              // That is not an edge case. Binance's SPOT API is geo-blocked in
              // the US, and crypto-exchange API hosts are on common ad/privacy
              // blocklists, so a whole class of users would only ever see an
              // empty chart. Meanwhile the app already had the right answer
              // elsewhere: app/api/market/snapshot tries futures then spot (this
              // used to live in MarketProvider.fetchKlines). The chart just never
              // got the same treatment.
              //
              // That reasoning was about the BROWSER calling Binance directly.
              // These now go through /api/market/klines, so the fetch happens
              // server-side and a client-side geo-block or filter list never
              // touches it - which is why spot can lead again (#359).
              //
              // Futures candles are still what the funding, OI and liquidation
              // data refer to. That argues for showing futures ALONGSIDE, not
              // for silently joining futures history to a spot stream, which is
              // what this used to do.
              const tryFetch = async (url: string): Promise<(string | number)[][] | null> => {
                try {
                  const res = await fetch(url);
                  if (!res.ok) return null;
                  const j = await res.json();
                  return Array.isArray(j) && j.length ? j as (string | number)[][] : null;
                } catch { return null; }
              };
              /* SPOT FIRST (#359). The live stream is spot - wss://stream.binance.com
                 - so futures history joined to it produced a chart whose bars
                 changed feed partway along, invisibly. Measured at 4.4bp on BTC
                 (~$28) and ~9bp on ETH: small, permanent, and in the one place a
                 user reads price. Owner's decision: spot throughout.
                 Futures stays as the FALLBACK rather than being deleted - it is
                 a different host, and it is the reason a Binance-spot outage or
                 block does not blank the chart. Ordering changed; resilience
                 kept. */
              let raw = await tryFetch(`/api/market/klines?source=binance&symbol=${bnSym}&interval=${iv}&limit=1500`);
              if (raw) {
                histSourceRef.current = 'binance';
              } else {
                raw = await tryFetch(`/api/market/klines?source=binance-futures&symbol=${bnSym}&interval=${iv}&limit=1500`);
                /* Remember WHICH feed the history came from, so the gap backfill
                   (#313) refills from the same one. Without this, a spot outage
                   would give futures history and a spot backfill - the exact
                   mismatch #359 is about, re-created in the recovery path and
                   only on the day something else was already broken. */
                if (raw) histSourceRef.current = 'binance-futures';
              }
              raw = raw ?? [];
              if (stale()) return; // superseded by a newer switch - drop it
              let bars = raw.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              }));
              // Last resort: this coin also exists on Bybit, which is a wholly
              // different host and so survives a Binance-specific block.
              if (!bars.length && bybitSym) {
                const bIv = periodToBybitInterval(period);
                try {
                  const rb = await fetch(`/api/market/klines?source=bybit&symbol=${bybitSym}&interval=${bIv}&limit=1000`);
                  const db = await rb.json() as { result?: { list?: string[][] } };
                  if (stale()) return;
                  bars = [...(db?.result?.list ?? [])].reverse().map(k => ({
                    timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                    low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
                  }));
                } catch { /* fall through to the empty-chart path below */ }
              }
              if (!bars.length) console.error('[chart] no kline source reachable for', bnSym, iv);
              if (bars.length) {
                lastCloseRef.current = bars[bars.length - 1].close;
                srSetRef.current(computeSRLevels(bars, bars[bars.length - 1].close));
                // Cap at the most recent few: a long window can hold a dozen
                // structure breaks, and older ones are history rather than
                // actionable - showing them all just recreates the chart clutter
                // the Arena signal-overload pass removed.
                paSetRef.current(detectStructureSignals(bars).slice(-PA_MAX));
                emaBarsRef.current = bars;
                syncEmaRibbon();
              }
              callback(bars, false);
            } else if (bybitSym) {
              const iv = periodToBybitInterval(period);
              const r  = await fetch(`/api/market/klines?source=bybit&symbol=${bybitSym}&interval=${iv}&limit=1000`);
              const d  = await r.json() as { result?: { list?: string[][] } };
              if (stale()) return; // superseded by a newer switch - drop it
              const list = [...(d?.result?.list ?? [])].reverse();
              // Raw contract price, NOT converted to per-token. See
              // chartDisplaySymbol in lib/coins: klinecharts cannot render a
              // 2e-8 candle range and degenerates into a zero-centred axis with
              // negative ticks. The chart label carries the 1000 prefix so the
              // scale is stated rather than implied.
              const bars = list.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              }));
              if (bars.length) {
                lastCloseRef.current = bars[bars.length - 1].close;
                srSetRef.current(computeSRLevels(bars, bars[bars.length - 1].close));
                // Cap at the most recent few: a long window can hold a dozen
                // structure breaks, and older ones are history rather than
                // actionable - showing them all just recreates the chart clutter
                // the Arena signal-overload pass removed.
                paSetRef.current(detectStructureSignals(bars).slice(-PA_MAX));
                emaBarsRef.current = bars;
                syncEmaRibbon();
              }
              callback(bars, false);
            } else {
              callback([], false);
            }
            endFade();
          } catch { if (!stale()) { callback([], false); endFade(); } }
          void symbol; // suppress unused
        },

        subscribeBar: ({ period, callback }) => {
          const c        = coinRef.current;
          const bnSym    = BINANCE_SYMS[c] as string | undefined;
          const bybitSym = BYBIT_SYMS[c]   as string | undefined;
          wsRef.current?.close();

          if (bnSym) {
            const iv = periodToBnInterval(period);

            /* RECONNECT (#306).
             *
             * This socket used to be opened once. On a network drop it closed,
             * `onclose` set the status dot to 'connecting', and nothing ever
             * connected - so the chart froze at the last bar and stayed there
             * until the user reloaded. The dot was honest and permanent.
             *
             * Why only some things came back: the Bybit branch below polls on a
             * setInterval, which survives an outage and simply succeeds again,
             * and six other endpoints recover the same incidental way. The
             * WebSocket had no such loop, which is why the owner saw the chart
             * specifically stop while the rest of the page carried on.
             *
             * Backoff so a server-side rejection cannot become a reconnect
             * storm, capped so a long outage still recovers promptly. `online`
             * short-circuits the wait: the browser knows the network returned
             * before any timer would have fired. */
            let attempt = 0;
            let timer: ReturnType<typeof setTimeout> | null = null;
            let cancelled = false;
            /* Declared before `connect`, which captures it. Ordering matters:
               relying on the call happening later would break the moment someone
               moved it. */
            let live: WebSocket | null = null;
            /* False until the first connect completes, so the initial open does
               not trigger a backfill that getBars has already done. */
            let reconnected = false;

            /* Fetch what closed while we were away and push it through the same
               callback the stream uses.
               Ascending order matters: klinecharts' update path upserts by
               timestamp, so bars must arrive oldest-first or a later bar is
               overwritten by an earlier one. */
            const backfillGap = async (
              sym: string, interval: string,
              cb: (bar: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => void,
            ) => {
              const since = lastBarTsRef.current;
              if (!since) return;                       // nothing streamed yet - getBars owns it
              try {
                const r = await fetch(
                  `/api/market/klines?source=${histSourceRef.current}&symbol=${sym}&interval=${interval}&limit=500`,
                  { signal: AbortSignal.timeout(12_000) },
                );
                if (!r.ok || cancelled) return;
                const rows = (await r.json()) as Array<[number, string, string, string, string, string]>;
                if (cancelled) return;
                const missed = barsAfter(
                  rows.map(k => ({ timestamp: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })),
                  since,
                );
                for (const bar of missed) {
                  lastBarTsRef.current = bar.timestamp;
                  lastCloseRef.current = bar.close;
                  upsertEmaBar(bar);
                  cb(bar);
                }
              } catch { /* the stream is already live; a failed backfill leaves
                           the gap rather than breaking the chart */ }
            };

            const connect = () => {
              if (cancelled) return;
              const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${bnSym.toLowerCase()}@kline_${iv}`);
              live = ws;
              ws.onopen    = () => {
                attempt = 0;
                setWsStatus('live');
                /* BACKFILL THE GAP (#313).
                 *
                 * #309 restores the stream; it does not recover the candles that
                 * closed while it was down. getBars only runs on mount and on a
                 * symbol/period change, so before this the chart resumed live and
                 * kept a hole where the outage was - and a hole in a candle series
                 * is not visibly a hole, it is a chart that looks fine and is wrong.
                 *
                 * Only after a real gap: `reconnected` is false on the first
                 * connect, so a normal page load does not fire a second fetch. */
                if (reconnected) void backfillGap(bnSym, iv, callback);
                reconnected = true;
              };
              ws.onerror   = () => setWsStatus('error');
              ws.onclose   = (e) => {
                if (cancelled || e.wasClean) return;   // a clean close is us, not the network
                setWsStatus('connecting');
                attempt += 1;
                const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
                if (timer) clearTimeout(timer);
                timer = setTimeout(connect, delay);
              };
              ws.onmessage = (e: MessageEvent) => {
                const { k } = JSON.parse(e.data as string) as { k: Record<string, string | number> };
                const bar = { timestamp: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
                lastCloseRef.current = bar.close;
                lastBarTsRef.current = bar.timestamp;
                upsertEmaBar(bar);
                callback(bar);
              };
            };

            /* Nothing in this app listened for `online` before this (#306) - the
               endpoints that recovered did so by accident of having a timer. */
            const onOnline = () => {
              if (cancelled) return;
              if (live && live.readyState === WebSocket.OPEN) return;
              attempt = 0;                       // the network is back; do not serve out a long backoff
              if (timer) clearTimeout(timer);
              connect();
            };
            window.addEventListener('online', onOnline);

            connect();

            wsRef.current = {
              close: () => {
                cancelled = true;
                window.removeEventListener('online', onOnline);
                if (timer) clearTimeout(timer);
                live?.close();
              },
            };
          } else if (bybitSym) {
            // Bybit: 5s polling
            setWsStatus('live');
            const iv = periodToBybitInterval(period);
            const timer = setInterval(async () => {
              try {
                const r = await fetch(`/api/market/klines?source=bybit&symbol=${bybitSym}&interval=${iv}&limit=1`);
                const d = await r.json() as { result?: { list?: string[][] } };
                const k = d?.result?.list?.[0];
                if (k) {
                  // Raw, matching the history load above - the live bar must be
                  // on the same scale as the candles it is appended to.
                  lastCloseRef.current = Number(k[4]);
                  const bar = { timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) };
                  upsertEmaBar(bar);
                  callback(bar);
                }
              } catch { /* silent */ }
            }, 5000);
            wsRef.current = { close: () => clearInterval(timer) };
          }
        },

        unsubscribeBar: () => {
          wsRef.current?.close();
          wsRef.current = null;
          setWsStatus('connecting');
        },
      };

      chart.setDataLoader(loader);
      setChartSymbolPeriod(chart, coin, tf);

      if (!disposed) {
        /* #712: settle-poll the container instead of a single fixed-delay
           resize. The one-shot `setTimeout(resize, 100)` this replaces
           assumed the surrounding layout - the rail, the macro cards, #656's
           own oversized panels next to this one - finishes reflowing within
           100ms of chart creation. On a real page with real network-fetched
           data it does not always: QA measured a live container 800px tall
           holding a canvas drawn at 614px, on `staging`, not a synthetic
           timing.

           A `ResizeObserver` already watches this container further down and
           calls resize() on every change it sees - that is correct and
           stays. This poll is the backstop for the case the observer cannot
           cover: the FIRST chart creation is a one-time mount effect
           (`[]` below), so if the container's height is still climbing
           when `kc.init()` first measures it, klinecharts' resize() needs to
           be told again once things stop moving, not just when they change -
           and "stopped moving" is a state the observer alone does not signal.

           Same shape as #697's contrast settle-gate earlier tonight: poll a
           cheap proxy (height, not a full relayout) until two consecutive
           reads agree, rather than guess a duration long enough for every
           page and network condition. Bounded at 3s so a container that
           genuinely never stops resizing (unlikely, but not provable from
           here) cannot poll forever. */
        let lastH = -1;
        let stableReads = 0;
        const settleStart = Date.now();
        const pollSettle = () => {
          if (disposed || !containerRef.current) return;
          const h = containerRef.current.getBoundingClientRect().height;
          chartRef.current?.resize();
          if (chartRef.current) applyProportionalPaneHeights(chartRef.current, h);
          if (h === lastH) {
            stableReads++;
            // Two consecutive matching reads, 150ms apart: not a coincidence
            // of the container being unchanged for one frame - genuinely
            // settled, so stop spending timers on it.
            if (stableReads >= 2) return;
          } else {
            stableReads = 0;
            lastH = h;
          }
          if (Date.now() - settleStart > 3000) return; // bounded, see comment above
          setTimeout(pollSettle, 150);
        };
        setTimeout(pollSettle, 100); // first read at the same delay the old single-shot used
        setChartReady(true);
      }
    })();

    // Resize chart whenever the container changes dimensions (handles mobile
    // viewport changes, and the drag-resize handle further down this file) -
    // also re-applies VOL/RSI pane proportions so they track the new height.
    const ro = new ResizeObserver(entries => {
      chartRef.current?.resize();
      const h = entries[0]?.contentRect?.height;
      if (chartRef.current && h) applyProportionalPaneHeights(chartRef.current, h);
    });
    // Captured now, used in cleanup. Reading containerRef.current inside the
    // cleanup function is a real leak, not a style nit: by the time cleanup
    // runs React may already have detached the node and nulled the ref, so the
    // dispose() below would silently no-op and leave the klinecharts instance
    // and its listeners alive. The dispose has to name the exact element the
    // chart was mounted on, which is this one.
    const containerEl = containerRef.current;
    if (containerEl) ro.observe(containerEl);

    return () => {
      disposed = true;
      ro.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      import('klinecharts').then(({ dispose }) => {
        if (containerEl) dispose(containerEl);
      });
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload on coin / tf change ───────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const coinChanged = prevCoinRef.current !== coin;
    const tfChanged   = prevTfRef.current   !== tf;
    if (!coinChanged && !tfChanged) return; // nothing actually changed

    startFade();
    analysisIds.current.forEach(id => chart.removeOverlay({ id }));
    analysisIds.current = [];
    alertOverlayMap.current.forEach(oid => chart.removeOverlay({ id: oid }));
    alertOverlayMap.current.clear();
    chart.removeOverlay({ name: 'emaSignal' });
    chart.removeOverlay({ name: 'reversalWarning' });
    srOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    srOverlayIds.current = [];
    chart.removeOverlay({ name: 'emaRibbonLine' });
    emaRibbonIds.current = EMA_PERIODS.map(() => null);
    emaBarsRef.current = [];
    setSrLevels([]);
    setActiveTool(null);

    // klinecharts' setSymbol AND setPeriod each call resetData() -> getBars().
    // Calling both on one switch fires two parallel fetches whose init callbacks
    // race - the slower (stale) one can win and paint the wrong timeframe/coin.
    // So only call the setter that actually changed, and bump loadGenRef before
    // each so any in-flight fetch from a previous switch is discarded on arrival.
    if (coinChanged) {
      loadGenRef.current += 1;
      const bnSym    = BINANCE_SYMS[coin] as string | undefined;
      const bybitSym = BYBIT_SYMS[coin]   as string | undefined;
      const baseSym  = bnSym ?? bybitSym ?? 'BTCUSDT';
      chart.setSymbol({ ticker: chartDisplaySymbol(coin), shortName: chartDisplaySymbol(coin), pricePrecision: COIN_DEC[coin] ?? 2 });
    }
    if (tfChanged) {
      loadGenRef.current += 1;
      chart.setPeriod(TF_TO_PERIOD[tf] ?? TF_TO_PERIOD['15m']);
    }

    prevCoinRef.current = coin;
    prevTfRef.current   = tf;

    // Safety: clear the freeze-frame overlay even if no getBars fires (e.g. an
    // unsupported symbol) so the chart can never stay stuck behind the screenshot.
    const fallback = setTimeout(endFade, 2000);
    return () => clearTimeout(fallback);
  }, [coin, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fullscreen API ───────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setFullscreen(isFs);
      // Let CSS transition finish then tell klinecharts to repaint
      setTimeout(() => chartRef.current?.resize(), 60);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const handleFullscreen = () => {
    if (!fullscreen) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wrapRef.current as any)?.requestFullscreen?.() ?? (wrapRef.current as any)?.webkitRequestFullscreen?.();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.();
    }
  };

  /* ── Entry / SL / TP lines removed (#260) ──────────────────────────────
     The research output is a directional read now and no longer issues trade
     levels, so there is nothing left for this effect to draw.

     The CLEANUP is kept deliberately. Any overlay this effect created before
     the change still has to be removed when `result` changes, and a stale
     ENTRY line left floating on the chart after a new analysis would be worse
     than the old behaviour - it would be a price level attached to nothing.
     Dropping the effect entirely would have left that dangling for anyone whose
     chart was already showing them.

     Support/resistance is a separate mechanism and is unaffected: those are
     observations about the chart, not instructions about a position, and only
     the second kind was removed. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    analysisIds.current.forEach(id => chart.removeOverlay({ id }));
    analysisIds.current = [];
  }, [result]);

  // ── EMA signal markers - all significant crosses in the loaded data ──────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    chart.removeOverlay({ name: 'emaSignal' });
    if (!emaSignal || emaSignal.loading) return;

    const place = (dir: 'long' | 'short', ts: number, price: number, pending: boolean) => {
      chart.createOverlay({
        // lock stays on. In klinecharts it only gates mouse-down and
        // pressed-move (index.esm.js: `if (overlay.lock) return false` in
        // _figureMouseDownEvent, and the `!overlay.lock` guard on
        // onPressedMoving), so hover still fires and the marker stays
        // undraggable - dropping it would let a user drag a signal off its
        // candle.
        name: 'emaSignal', lock: true,
        // price is carried in extendData as well as in the point, because
        // createPointFigures only receives screen coordinates - by the time it
        // runs, the price behind the y pixel is gone.
        extendData: { dir, pending, price, hovered: false },
        points: [{ timestamp: ts, value: price }],
      } as OverlayCreate);
    };

    for (const sig of emaSignal.signalLongs)  place('long',  sig.timestamp, sig.anchorPrice, sig.pending ?? false);
    for (const sig of emaSignal.signalShorts) place('short', sig.timestamp, sig.anchorPrice, sig.pending ?? false);
  }, [emaSignal, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reversal warnings - RSI divergence, a leading heads-up distinct from the
  //     ribbon's confirmed buy/sell markers above ─────────────────────────────
  // Re-enabled per user request - these amber RSI-divergence markers can
  // contradict the ribbon's own Buy/Sell markers and the AI read (mid-trend
  // exhaustion warning, not a confirmed signal), but the user wants them
  // visible on the chart again rather than only feeding the Confluence
  // "RSI Divergence Warning" penalty silently.
  const SHOW_REVERSAL_WARNINGS = true;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    chart.removeOverlay({ name: 'reversalWarning' });
    if (!SHOW_REVERSAL_WARNINGS) return;
    if (!emaSignal || emaSignal.loading) return;

    for (const w of emaSignal.reversalWarnings) {
      chart.createOverlay({
        name: 'reversalWarning', lock: true,
        extendData: { dir: w.dir },
        points: [{ timestamp: w.timestamp, value: w.anchorPrice }],
      } as OverlayCreate);
    }
  }, [emaSignal, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync price alert lines ───────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    // Remove stale alert overlays
    alertOverlayMap.current.forEach(oid => chart.removeOverlay({ id: oid }));
    alertOverlayMap.current.clear();

    if (!chartAlerts?.length) return;

    chartAlerts.forEach(alert => {
      const id = chart.createOverlay({
        name: 'horizontalStraightLine',
        groupId: 'price_alerts',
        lock: false,
        points: [{ value: alert.target_price }],
        styles: {
          // Baked in at creation, which is why themeInk is in this effect's
          // deps - the line is the control the user drags, and at 1.78:1 on a
          // light chart it was close to invisible (#752).
          line: { style: 'dashed', color: overlayInk.alertLine, size: 1, dashedValue: [5, 3] },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPressedMoveEnd: ({ overlay }: { overlay: { points: Array<{ value?: number }> } }) => {
          const newPrice = overlay.points[0]?.value;
          if (newPrice !== undefined) onAlertMoveRef.current?.(alert.id, newPrice);
        },
      } as OverlayCreate);
      if (typeof id === 'string') alertOverlayMap.current.set(alert.id, id);
    });
  }, [chartAlerts, chartReady, themeInk]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw / redraw S/R level lines ───────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    srOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    srOverlayIds.current = [];
    if (!showSR || !srLevels.length) return;
    const labelOffsets = computeLabelOffsets(srLevels);
    for (const level of srLevels) {
      const id = chart.createOverlay({
        name: 'srLevelLine',
        groupId: 'sr_levels',
        lock: true,
        extendData: { srType: level.type, price: level.price, labelYOffset: labelOffsets.get(level.price) ?? 0 },
        points: [{ value: level.price }],
      } as OverlayCreate);
      if (typeof id === 'string') srOverlayIds.current.push(id);
    }
  }, [srLevels, showSR, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish the newest structure break upward. Separate from the drawing effect
  // below so it is not gated on showPA - a consumer scoring the market wants the
  // signal whether or not the user has markers switched on.
  const onStructureRef = useRef(onStructure);
  useEffect(() => { onStructureRef.current = onStructure; }, [onStructure]);
  useEffect(() => {
    onStructureRef.current?.(paSignals.length ? paSignals[paSignals.length - 1] : null);
  }, [paSignals]);

  // ── Draw / redraw market-structure break markers ─────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    paOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    paOverlayIds.current = [];
    if (!showPA || !paSignals.length) return;
    for (const sig of paSignals) {
      const id = chart.createOverlay({
        name: 'structureBreak',
        groupId: 'structure_breaks',
        lock: true,
        extendData: { dir: sig.dir, kind: sig.kind, volumeBacked: sig.volumeBacked },
        points: [{ timestamp: sig.timestamp, value: sig.price }],
      } as OverlayCreate);
      if (typeof id === 'string') paOverlayIds.current.push(id);
    }
  }, [paSignals, showPA, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GEX context lines (BTC only): max-pain magnet + zero-gamma flip ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    gexLevelIds.current.forEach(id => chart.removeOverlay({ id }));
    gexLevelIds.current = [];
    if (!gexLevels) return;
    const lines: Array<{ gexType: 'maxpain' | 'flip'; price: number }> = [];
    if (gexLevels.maxPain != null && isFinite(gexLevels.maxPain)) lines.push({ gexType: 'maxpain', price: gexLevels.maxPain });
    if (gexLevels.flip    != null && isFinite(gexLevels.flip))    lines.push({ gexType: 'flip',    price: gexLevels.flip });
    const labelOffsets = computeLabelOffsets(lines);
    for (const l of lines) {
      const id = chart.createOverlay({
        name: 'gexLevelLine',
        groupId: 'gex_levels',
        lock: true,
        extendData: { ...l, labelYOffset: labelOffsets.get(l.price) ?? 0 },
        points: [{ value: l.price }],
      } as OverlayCreate);
      if (typeof id === 'string') gexLevelIds.current.push(id);
    }
  }, [gexLevels, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realized liquidation cluster lines (#766) ────────────────────────────
  /* Deliberately NOT built on store.btcLiqLevels. That array is permanently
     empty - Coinglass retired the v2 endpoints this app called, v4 answers
     401 on this tier, and pendings/PENDING.md:18 defers it until revenue
     (MarketProvider.tsx:927-946). An overlay fed from it would compile, pass
     review and never draw a single line. The source here is LiqFeed's live
     keyless streams, lifted through the page - see app/arena/page.tsx.
     The slice is defensive: the caller already limits to LIQ_CLUSTER_LINES,
     but this effect is what actually decides how much ink lands on the chart,
     so it enforces the ruling itself rather than trusting its input. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    liqClusterIds.current.forEach(id => chart.removeOverlay({ id }));
    liqClusterIds.current = [];
    if (!showLiq || !liqClusters?.length) return;
    const lines = liqClusters
      .filter(l => Number.isFinite(l.price) && l.price > 0)
      .slice(0, LIQ_CLUSTER_LINES);
    const labelOffsets = computeLabelOffsets(lines);
    for (const l of lines) {
      const id = chart.createOverlay({
        name: 'liqClusterLine',
        groupId: 'liq_clusters',
        lock: true,
        extendData: { price: l.price, total: l.total, labelYOffset: labelOffsets.get(l.price) ?? 0 },
        points: [{ value: l.price }],
      } as OverlayCreate);
      if (typeof id === 'string') liqClusterIds.current.push(id);
    }
  }, [liqClusters, showLiq, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore user-drawn lines for this coin, and swap them out on coin change ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    userDrawOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    userDrawOverlayIds.current = [];

    for (const p of loadDrawings(coin)) {
      const id = chart.createOverlay({
        name: p.name,
        groupId: DRAWING_GROUP,
        points: p.points,
        styles: p.styles,
        lock: p.lock ?? false,
        onDrawEnd: () => saveDrawings(chart, coinRef.current),
        onRemoved: () => saveDrawings(chart, coinRef.current),
        onPressedMoveEnd: () => saveDrawings(chart, coinRef.current),
      } as OverlayCreate);
      if (typeof id === 'string') userDrawOverlayIds.current.push(id);
    }
  }, [coin, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing toolbar ──────────────────────────────────────────────────
  const handleTool = (toolId: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (activeTool === toolId) {
      chart.removeOverlay({ name: toolId });
      setActiveTool(null);
    } else {
      const id = chart.createOverlay({
        name: toolId,
        groupId: DRAWING_GROUP,
        onDrawEnd: () => saveDrawings(chart, coinRef.current),
        onRemoved: () => saveDrawings(chart, coinRef.current),
        onPressedMoveEnd: () => saveDrawings(chart, coinRef.current),
      } as OverlayCreate);
      if (typeof id === 'string') userDrawOverlayIds.current.push(id);
      setActiveTool(toolId);
    }
  };

  const handleClear = () => {
    chartRef.current?.removeOverlay();
    analysisIds.current = [];
    userDrawOverlayIds.current = [];
    setActiveTool(null);
    try { localStorage.removeItem(drawingsKey(coin)); } catch { /* ignore */ }
  };

  /* ── Setup Quality: price near strong S/R + squeeze forming ── */
  const setupQuality = (() => {
    const price = lastCloseRef.current;
    if (!price || !srLevels.length) return null;
    const sq = computeSqueezeScore(coinData);
    const nearSR = srLevels.find(level => {
      const pct = Math.abs(price - level.price) / price * 100;
      return pct < 0.8 && level.touches >= 2;
    })!;
    if (!nearSR || sq.score < 50 || sq.dir === 'NEUTRAL') return null;
    const aligned =
      (nearSR.type === 'support'    && sq.dir === 'SHORT_SQ') ||
      (nearSR.type === 'resistance' && sq.dir === 'LONG_LIQ');
    // Squeeze + support/resistance confluence - a separate read from the
    // chart's own EMA Buy/Sell marker, not a confirmation or restatement of
    // it. The copy below says so explicitly (past confusion: "signals
    // aren't aligned yet" read as if it meant the Buy/Sell signal itself).
    if (sq.score >= 65 && aligned) return {
      label: 'Prime Setup',
      detail: nearSR.type === 'support'
        ? `Support (${nearSR.touches}T) + Short Squeeze · Score ${sq.score}/100`
        : `Resistance (${nearSR.touches}T) + Long Flush · Score ${sq.score}/100`,
      explanation: nearSR.type === 'support'
        ? "Squeeze + support confluence (separate from the chart's own Buy/Sell signal). Price is sitting on a tested support level while shorts are being squeezed out. High-probability long zone - watch for a confirmation candle before entering."
        : "Squeeze + resistance confluence (separate from the chart's own Buy/Sell signal). Price is pressing against tested resistance while longs are getting flushed. High-probability short zone - watch for a rejection candle before entering.",
      color: 'var(--amber)', bg: 'rgba(251,191,36,0.10)', bdr: 'rgba(251,191,36,0.28)',
    };
    return {
      label: 'Setup Forming',
      detail: `Near ${nearSR.type} (${nearSR.touches} touches) · Squeeze ${sq.score}/100`,
      explanation: `Squeeze + ${nearSR.type} confluence (separate from the chart's own Buy/Sell signal) - the squeeze and the ${nearSR.type} level aren't lined up yet. Watch for direction confirmation - don't jump in early.`,
      color: 'var(--accent)', bg: 'rgba(26,122,255,0.10)', bdr: 'rgba(26,122,255,0.28)',
    };
  })();

  return (
    <div className="klc-wrap" ref={wrapRef}>
      {/* Toolbar */}
      <div className="klc-toolbar">
        {/* Scale badge for the 1000-denominated meme perps (PEPE, BONK).
            Those two plot Bybit's raw 1000-token contract price, because
            klinecharts cannot render a ~2e-8 axis without collapsing it - see
            chartDisplaySymbol in lib/coins. So the chart shows ~0.0029 while the
            rest of the app correctly shows ~0.0000029, a 1000x difference on the
            same screen.

            That was supposed to be stated by the "1000" prefix in setSymbol's
            ticker, but klinecharts only paints the symbol inside its OHLC
            tooltip, and that tooltip is deliberately set to follow_cross so it
            does not cover the candles on a short mobile pane. Net effect: the
            prefix only appeared while actively dragging a crosshair, so in
            normal use nothing told the user the axis was per-1000-tokens - on a
            trading app, where people read entries and stops straight off the
            chart. Rendering it as real DOM here makes it unconditional. */}
        {chartDisplaySymbol(coin).startsWith('1000') && (
          <span className="klc-scale-badge" title="Bybit quotes this perp per 1000 tokens, so the chart axis is 1000x the per-token price shown elsewhere in the app">
            {chartDisplaySymbol(coin)}
          </span>
        )}
        {/* TF selector */}
        {TFS.map(t => (
          <button
            key={t}
            className={`klc-tool-btn klc-tf-btn${tf === t ? ' on' : ''}`}
            onClick={() => onTfChange?.(t)}
          >
            {t}
          </button>
        ))}
        <div className="klc-sep" />

        {/* Drawing tools collapsed into a Draw menu so the toolbar stays clean */}
        <div className="klc-draw-wrap">
          <button
            className={`klc-tool-btn klc-draw-btn${activeTool ? ' on' : ''}`}
            onClick={() => setDrawMenuOpen(v => !v)}
            aria-expanded={drawMenuOpen}
            title="Drawing tools"
          >
            {activeTool ? (TOOLS.find(t => t.id === activeTool)?.label ?? 'Draw') : 'Draw'} {drawMenuOpen ? '▴' : '▾'}
          </button>
          {drawMenuOpen && (
            <div className="klc-draw-menu">
              {TOOLS.map(({ id, label }) => (
                <button
                  key={id}
                  className={`klc-draw-item${activeTool === id ? ' on' : ''}`}
                  onClick={() => { handleTool(id); setDrawMenuOpen(false); }}
                >
                  {label}
                </button>
              ))}
              <button className="klc-draw-item klc-draw-clear" onClick={() => { handleClear(); setDrawMenuOpen(false); }}>✕ Clear all</button>
            </div>
          )}
        </div>
        <div className="klc-sep" />
        <button
          className={`klc-tool-btn${showSR ? ' on' : ''}`}
          onClick={() => setShowSR(v => !v)}
          title="Toggle auto support &amp; resistance levels"
        >
          S/R
        </button>

        <button
          className={`klc-tool-btn${showPA ? ' on' : ''}`}
          onClick={() => setShowPA(v => !v)}
          title="Toggle market structure breaks - price-action signals, separate from the EMA buy/sell markers"
        >
          Structure
        </button>

        {liqClusters && liqClusters.length > 0 && (
          <button
            className={`klc-tool-btn${showLiq ? ' on' : ''}`}
            onClick={() => setShowLiq(v => !v)}
            title="Toggle realized liquidation clusters - the heaviest price levels where positions were actually liquidated in the last 24h. Price memory, not predicted liquidation levels."
          >
            Liq
          </button>
        )}

        {chartAlerts && chartAlerts.length > 0 && (
          <div className="klc-legend">
            {chartAlerts.map(alert => (
              <span
                key={alert.id}
                className="klc-price-chip"
                style={{ color: 'var(--amber)', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)', cursor: 'default' }}
                title={`Alert: ${alert.direction} $${fmtPx(alert.target_price)}${alert.label ? ` · ${alert.label}` : ''} - drag the dashed line to adjust`}
              >
                {alert.direction === 'above' ? '↑' : '↓'} ${fmtPx(alert.target_price)}
                {alert.label ? <>&nbsp;·&nbsp;{alert.label}</> : null}
              </span>
            ))}
          </div>
        )}

        <span style={{ marginLeft: 'auto' }} />
        {setupQuality && (
          <div className="sq-badge">
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              color: setupQuality.color, background: setupQuality.bg,
              border: `0.5px solid ${setupQuality.bdr}`,
              letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'default',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {setupQuality.label}
              <span className="sq-info" style={{ '--sq-bdr': setupQuality.bdr } as React.CSSProperties}>
                <span style={{ opacity: 0.6, fontSize: '0.6875rem', lineHeight: 1 }}>ⓘ</span>
                <div className="sq-tooltip">
                  <div style={{
                    width: 240,
                    background: '#111',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10, padding: '12px 14px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
                    whiteSpace: 'normal',
                  }}>
                    <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>
                      {setupQuality.label}
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'rgba(255,255,255,0.38)', lineHeight: 1.55, marginBottom: 8 }}>
                      {setupQuality.detail}
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'rgba(255,255,255,0.72)', lineHeight: 1.7 }}>
                      {setupQuality.explanation}
                    </div>
                  </div>
                </div>
              </span>
            </span>
          </div>
        )}
        <button
          className="klc-tool-btn klc-fullscreen-btn"
          onClick={handleFullscreen}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? '⊠' : '⛶'}
        </button>
        <span
          className={`klc-ws-dot${wsStatus === 'live' ? ' live' : wsStatus === 'error' ? ' err' : ''}`}
          title={wsStatus}
        />
      </div>

      {/* Chart canvas */}
      <div
        style={{ position: 'relative' }}
        onMouseMove={(e) => {
          const chart = chartRef.current;
          const warnings = emaSignal?.reversalWarnings;
          if (!chart || !warnings?.length) { setRwTooltip(null); return; }
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) { setRwTooltip(null); return; }
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          for (const w of warnings) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const coord = (chart as any).convertToPixel?.(
              { timestamp: w.timestamp, value: w.anchorPrice },
              { paneId: 'candle_pane' },
            ) as { x: number; y: number } | null;
            if (!coord || !isFinite(coord.x) || !isFinite(coord.y)) continue;
            const cy = w.dir === 'bearish' ? coord.y - 24 : coord.y + 24;
            if (Math.sqrt((mx - coord.x) ** 2 + (my - cy) ** 2) <= 14) {
              setRwTooltip({ x: e.clientX, y: e.clientY, dir: w.dir });
              return;
            }
          }
          setRwTooltip(null);
        }}
        onMouseLeave={() => setRwTooltip(null)}
      >
        <div
          ref={containerRef}
          className="klc-canvas"
          style={chartHeight != null && !fullscreen ? { height: chartHeight } : undefined}
        />
        {/* Screenshot crossfade - holds old chart image while new data loads, then fades out */}
        <div ref={canvasFadeRef} style={{
          position: 'absolute', inset: 0,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          opacity: 0,
          pointerEvents: 'none',
        }} />
        {/* Drag-to-resize handle - grab and drag to set chart height (Bybit-style),
            persisted. Hidden in fullscreen (height is fixed to the viewport there). */}
        {!fullscreen && (
          <div
            className="klc-resize-handle"
            onPointerDown={(e) => { e.preventDefault(); onResizeStart(e.clientY); }}
            role="separator"
            aria-label="Drag to resize chart height"
            title="Drag to resize chart height"
          >
            <span className="klc-resize-grip" />
          </div>
        )}
        {/* Reversal warning hover tooltip */}
        {rwTooltip && (
          <div style={{
            position: 'fixed',
            top: rwTooltip.y - 52,
            left: rwTooltip.x,
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: '#13172e',
            border: '0.5px solid rgba(245,158,11,0.35)',
            borderRadius: 8,
            padding: '7px 12px',
            fontSize: 'var(--fs-caption)',
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.78)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 400,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
            textTransform: 'none',
            letterSpacing: 'normal',
          }}>
            <span style={{ color: 'var(--amber)', marginRight: 5, lineHeight: 0 }}><Warn size={13} /></span>
            {rwTooltip.dir === 'bearish'
              ? 'Trend reversal - RSI divergence detected'
              : 'Potential bottom - RSI divergence detected'}
          </div>
        )}

        {/* Candle-close countdown - anchored below the klinecharts current-price label.
            Clamped away from the bottom-right corner because the global "Ask AI" FAB
            (components/GrokChat.tsx, fixed to the viewport's bottom-right) lives there
            too - whenever price trades in the lower part of the visible range, the
            unclamped badge would drift into and overlap the FAB. */}
        {priceLabelY !== null && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: Math.min(priceLabelY + 11, (containerRef.current?.clientHeight ?? 400) - 90),
            pointerEvents: 'none',
            background: 'rgba(30,30,30,0.88)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderTop: 'none',
            borderRadius: '0 0 3px 3px',
            padding: '1px 6px 2px',
            fontSize: 'var(--fs-caption)',
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.70)',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
            userSelect: 'none',
            minWidth: 54,
            textAlign: 'center',
          }}>
            {countdown}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Price formatter for chip labels ──────────────────────────────────────
// The sub-0.01 branch used toFixed(6), which printed a PEPE support at
// 0.0000271 as "$0.00003" - a level chip that rounds away the level. Same
// rounding-floor family as the structure card's "$0"; significant digits fix
// both without a per-coin table.
function fmtPx(n: number): string {
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toFixed(2);
  if (n >= 1)     return n.toFixed(3);
  if (n >= 0.01)  return n.toFixed(4);
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/* Cluster size for the overlay label. Its own formatter rather than LiqFeed's
   fmtUSD: this one shares a ~28-character label with a price, so it rounds
   harder ($4.2M, $840K) than the feed's two-decimal version. */
function fmtLiqUsd(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
  return '$' + Math.round(n);
}

// ── Helper ────────────────────────────────────────────────────────────────
function setChartSymbolPeriod(chart: KChart, coin: CoinId, tf: string) {
  const bnSym    = BINANCE_SYMS[coin] as string | undefined;
  const bybitSym = BYBIT_SYMS[coin]   as string | undefined;
  chart.setSymbol({ ticker: chartDisplaySymbol(coin), shortName: chartDisplaySymbol(coin), pricePrecision: COIN_DEC[coin] ?? 2 });
  chart.setPeriod(TF_TO_PERIOD[tf] ?? TF_TO_PERIOD['15m']);
}
