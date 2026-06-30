// WaveTrend oscillator (the core of the popular "VuManChu Cipher B" indicator) —
// a momentum oscillator that catches reversals at extremes, used here as a
// confirming/confluence layer alongside the EMA ribbon strategy. Public-domain
// formula, originally popularized by LazyBear's WaveTrend script.

import { OHLCV, emaArr, smaArr } from './strategyCore';

const CHANNEL_LEN = 10;
const AVG_LEN     = 21;
const SIGNAL_LEN  = 4;
const OB_LEVEL     = 53;   // overbought threshold
const OS_LEVEL     = -53;  // oversold threshold
const PIVOT_WINDOW  = 3;   // candles each side required to confirm a local high/low
const DIVERGENCE_LOOKBACK = 60; // candles to scan back for divergence pivots
const CROSS_RECENCY_BARS  = 5;  // how many candles back a cross still counts as "recent"

/* EMA over an array that may start with a run of NaN — skip the NaN prefix,
   compute EMA on the valid tail, then re-pad so indices still line up. */
function emaSkipLeadingNaN(values: number[], period: number): number[] {
  const n = values.length;
  const start = values.findIndex(v => isFinite(v));
  const out = new Array<number>(n).fill(NaN);
  if (start < 0) return out;
  const tail = emaArr(values.slice(start), period);
  for (let i = 0; i < tail.length; i++) out[start + i] = tail[i];
  return out;
}

export interface WaveTrendResult {
  wt1: number[];
  wt2: number[];
}

export function computeWaveTrend(
  candles: OHLCV[],
  channelLen = CHANNEL_LEN,
  avgLen     = AVG_LEN,
  sigLen     = SIGNAL_LEN,
): WaveTrendResult {
  const ap  = candles.map(c => (c.high + c.low + c.close) / 3);
  const esa = emaArr(ap, channelLen);
  const absDiff = ap.map((v, i) => isFinite(esa[i]) ? Math.abs(v - esa[i]) : NaN);
  const d   = emaSkipLeadingNaN(absDiff, channelLen);
  const ci  = ap.map((v, i) =>
    (isFinite(esa[i]) && isFinite(d[i]) && d[i] !== 0) ? (v - esa[i]) / (0.015 * d[i]) : NaN
  );
  const wt1 = emaSkipLeadingNaN(ci, avgLen);
  const wt2 = smaArr(wt1, sigLen);
  return { wt1, wt2 };
}

/* ── Cross + zone signals ─────────────────────────────────────────────────── */
export interface WaveTrendCross {
  index:     number;
  timestamp: number;
  dir:       'long' | 'short';
}

export function detectWaveTrendCrosses(
  candles: OHLCV[],
  wt1: number[],
  wt2: number[],
  obLevel = OB_LEVEL,
  osLevel = OS_LEVEL,
): WaveTrendCross[] {
  const signals: WaveTrendCross[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!isFinite(wt1[i]) || !isFinite(wt2[i]) || !isFinite(wt1[i - 1]) || !isFinite(wt2[i - 1])) continue;
    const crossUp   = wt1[i] > wt2[i] && wt1[i - 1] <= wt2[i - 1];
    const crossDown = wt1[i] < wt2[i] && wt1[i - 1] >= wt2[i - 1];
    if (crossUp && wt1[i - 1] <= osLevel)   signals.push({ index: i, timestamp: candles[i].time, dir: 'long' });
    if (crossDown && wt1[i - 1] >= obLevel) signals.push({ index: i, timestamp: candles[i].time, dir: 'short' });
  }
  return signals;
}

/* ── Divergence ────────────────────────────────────────────────────────────── */
function findPivotLows(values: number[], window = PIVOT_WINDOW): number[] {
  const idxs: number[] = [];
  for (let i = window; i < values.length - window; i++) {
    if (!isFinite(values[i])) continue;
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (!isFinite(values[j]) || values[j] < values[i]) { isPivot = false; break; }
    }
    if (isPivot) idxs.push(i);
  }
  return idxs;
}

function findPivotHighs(values: number[], window = PIVOT_WINDOW): number[] {
  const idxs: number[] = [];
  for (let i = window; i < values.length - window; i++) {
    if (!isFinite(values[i])) continue;
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (!isFinite(values[j]) || values[j] > values[i]) { isPivot = false; break; }
    }
    if (isPivot) idxs.push(i);
  }
  return idxs;
}

export interface DivergenceResult {
  bullish:        boolean;
  bearish:        boolean;
  detailBullish:  string;
  detailBearish:  string;
}

// Regular divergence: price makes a lower low (bullish) or higher high (bearish)
// while WaveTrend fails to confirm — a classic exhaustion / reversal tell.
export function detectWaveTrendDivergence(
  candles: OHLCV[],
  wt1: number[],
  lookback = DIVERGENCE_LOOKBACK,
  pivotWindow = PIVOT_WINDOW,
): DivergenceResult {
  const n = candles.length;
  const start = Math.max(0, n - lookback);
  const lows  = candles.map(c => c.low);
  const highs = candles.map(c => c.high);

  const priceLowPivots  = findPivotLows(lows, pivotWindow).filter(i => i >= start);
  const priceHighPivots = findPivotHighs(highs, pivotWindow).filter(i => i >= start);

  let bullish = false, bearish = false;
  let detailBullish = 'No recent bullish divergence';
  let detailBearish = 'No recent bearish divergence';

  if (priceLowPivots.length >= 2) {
    const [i1, i2] = priceLowPivots.slice(-2); // i1 older, i2 newer
    if (isFinite(wt1[i1]) && isFinite(wt1[i2]) && lows[i2] < lows[i1] && wt1[i2] > wt1[i1]) {
      bullish = true;
      detailBullish = `Price lower low (${lows[i2].toFixed(4)} < ${lows[i1].toFixed(4)}) but WaveTrend higher low — bullish divergence`;
    }
  }

  if (priceHighPivots.length >= 2) {
    const [i1, i2] = priceHighPivots.slice(-2);
    if (isFinite(wt1[i1]) && isFinite(wt1[i2]) && highs[i2] > highs[i1] && wt1[i2] < wt1[i1]) {
      bearish = true;
      detailBearish = `Price higher high (${highs[i2].toFixed(4)} > ${highs[i1].toFixed(4)}) but WaveTrend lower high — bearish divergence`;
    }
  }

  return { bullish, bearish, detailBullish, detailBearish };
}

/* ── Confirmation helper for the EMA ribbon checklist ─────────────────────── */
export interface WaveTrendConfirmation {
  pass:    boolean | null;
  detail:  string;
  wt1Last: number | null;
  wt2Last: number | null;
}

export function getWaveTrendConfirmation(
  candles: OHLCV[],
  dir: 'long' | 'short' | null,
): WaveTrendConfirmation {
  if (candles.length < CHANNEL_LEN + AVG_LEN + SIGNAL_LEN) {
    return { pass: null, detail: 'Not enough data for WaveTrend', wt1Last: null, wt2Last: null };
  }
  const { wt1, wt2 } = computeWaveTrend(candles);
  const last = candles.length - 1;
  const wt1Last = isFinite(wt1[last]) ? wt1[last] : null;
  const wt2Last = isFinite(wt2[last]) ? wt2[last] : null;

  if (wt1Last == null || wt2Last == null || !dir) {
    return { pass: null, detail: 'WaveTrend unavailable', wt1Last, wt2Last };
  }

  const div = detectWaveTrendDivergence(candles, wt1);
  const crosses = detectWaveTrendCrosses(candles, wt1, wt2);
  const lastCross = crosses[crosses.length - 1];
  const recentCrossAgrees = !!lastCross && lastCross.dir === dir && (last - lastCross.index) <= CROSS_RECENCY_BARS;

  if (dir === 'long') {
    if (div.bullish) return { pass: true, detail: div.detailBullish, wt1Last, wt2Last };
    if (recentCrossAgrees) {
      return { pass: true, detail: `WaveTrend crossed bullish from oversold ${last - lastCross.index} candle(s) ago — momentum confirms`, wt1Last, wt2Last };
    }
    return { pass: false, detail: `WaveTrend at ${wt1Last.toFixed(1)} — no recent bullish cross or divergence to confirm`, wt1Last, wt2Last };
  } else {
    if (div.bearish) return { pass: true, detail: div.detailBearish, wt1Last, wt2Last };
    if (recentCrossAgrees) {
      return { pass: true, detail: `WaveTrend crossed bearish from overbought ${last - lastCross.index} candle(s) ago — momentum confirms`, wt1Last, wt2Last };
    }
    return { pass: false, detail: `WaveTrend at ${wt1Last.toFixed(1)} — no recent bearish cross or divergence to confirm`, wt1Last, wt2Last };
  }
}
