// Pure, framework-agnostic EMA ribbon signal detection — shared by the live
// useEMAStrategy hook and the backtest engine so the two can never diverge.
// No React, no fetch — just math over a candle array.

export interface OHLCV { time: number; open: number; high: number; low: number; close: number; volume: number }

/* ── Math helpers ─────────────────────────────────────────────────────────── */
export function emaArr(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = e;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    result[i] = e;
  }
  return result;
}

export function smaArr(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function volMA(volumes: number[], period = 20): number {
  const slice = volumes.slice(-period).filter(v => !isNaN(v));
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

export function atrArr(candles: OHLCV[], period = 14): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return result;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (tr[i] + atr * (period - 1)) / period;
    result[i] = atr;
  }
  return result;
}

// Choppiness Index (E.W. Dreiss) — 0-100, bounded. High = range-bound/choppy
// (true range is large relative to net price travel — lots of back-and-forth).
// Low = trending (price is actually covering ground). Standard thresholds:
// >61.8 choppy, <38.2 trending, in between transitional. Warns instead of
// silently filtering — the EMA ribbon's persistence rule already does the
// filtering; this just tells the trader WHY a coin feels hard to read right now.
export function choppinessIndexArr(candles: OHLCV[], period = 14): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return result;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const log10Period = Math.log10(period);
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const trSum = tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const hh = Math.max(...window.map(c => c.high));
    const ll = Math.min(...window.map(c => c.low));
    const range = hh - ll;
    if (range <= 0 || trSum <= 0) continue;
    result[i] = 100 * Math.log10(trSum / range) / log10Period;
  }
  return result;
}

export type ChopRegime = 'trending' | 'transitional' | 'choppy';
export function chopRegimeFor(ci: number): ChopRegime {
  if (ci >= 61.8) return 'choppy';
  if (ci <= 38.2) return 'trending';
  return 'transitional';
}

/* ── Adjustable filter parameters ───────────────────────────────────────── */
export interface SignalFilterParams {
  spreadMinPct: number;  // EMA9/20 min spread as fraction of price (0.003 = 0.3%)
  atrMult:      number;  // ATR(14) multiplier for EMA50 clearance buffer (0.35 = 35%)
  persistBoost: number;  // Integer added to all PERSIST_BY_TF base values (can be negative)
}

export const DEFAULT_FILTER_PARAMS: SignalFilterParams = {
  spreadMinPct: 0.003,
  atrMult:      0.35,
  persistBoost: 0,
};

// Anti-chop OFF: raw EMA9/20 cross + first close beyond EMA50 confirms immediately —
// no spread requirement, no ATR clearance buffer, no forward persistence wait.
export const ANTICHOP_DISABLED_PARAMS: SignalFilterParams = {
  spreadMinPct: 0,
  atrMult:      0,
  persistBoost: -10,
};

export const PERSIST_BY_TF: Record<string, number> = {
  '1m': 8, '5m': 8, '15m': 8, '30m': 4, '1h': 3, '2h': 3, '4h': 3, '1d': 2,
};

const SLOPE_BARS = 5;
const SLOPE_MIN  = 0.001;
const SL_BUF     = 0.005; // 0.5% buffer beyond EMA50 for stop loss — matches live strategy card SL/TP rule

/* ── Signal detection ─────────────────────────────────────────────────────── */
export interface SignalEvent {
  timestamp:   number;
  index:       number;          // confirmation candle index — chart marker placement
  fillIndex:   number;          // first index at which the signal is actually KNOWABLE: the
                                // confirmation candle plus the PERSIST forward hold. Backtest
                                // entries fill here so results can't peek at closes that hadn't
                                // printed yet; the chart marker stays anchored at `index`.
  fillPrice:   number;          // close of the fill candle — honest backtest entry price
  armIndex:    number;          // index of the EMA9/20 cross that armed this signal (before the later confirm index)
  dir:         'long' | 'short';
  anchorPrice: number;          // low for long, high for short — chart marker placement
  entryPrice:  number;          // close of confirmation candle (marker candle) — display only
  sl:          number;
  tp:          number;          // fixed 2:1 R:R target measured from the fill price
}

export interface DetectedSignals {
  signalLongs:  SignalEvent[];
  signalShorts: SignalEvent[];
}

// 2-step strategy: EMA9/20 cross arms a direction, then the first candle that
// CLOSES meaningfully beyond EMA50 (ATR buffer + ribbon spread + EMA50 slope)
// and HOLDS there for PERSIST candles confirms the signal. Signals strictly
// alternate long/short — see useEMAStrategy.ts history for the full rationale.
export function detectEMASignals(
  candles:      OHLCV[],
  tf:           string,
  filterParams: SignalFilterParams = DEFAULT_FILTER_PARAMS,
): DetectedSignals {
  const { spreadMinPct, atrMult, persistBoost } = filterParams;
  const cl     = candles.map(c => c.close);
  const e9arr  = emaArr(cl, 9);
  const e20arr = emaArr(cl, 20);
  const e50arr = emaArr(cl, 50);
  const atr14  = atrArr(candles, 14);

  const ATR_MULT       = atrMult;
  const SPREAD_MIN_PCT = spreadMinPct;
  const PERSIST         = Math.max(0, (PERSIST_BY_TF[tf] ?? 4) + persistBoost);

  const slopeOK = (k: number, dir: 'long' | 'short'): boolean => {
    if (k < SLOPE_BARS || !isFinite(e50arr[k - SLOPE_BARS])) return true;
    const s = (e50arr[k] - e50arr[k - SLOPE_BARS]) / e50arr[k - SLOPE_BARS];
    return dir === 'long' ? s > -SLOPE_MIN : s < SLOPE_MIN;
  };

  const spreadOK = (k: number): boolean => {
    const p = candles[k].close;
    return p > 0 && Math.abs(e9arr[k] - e20arr[k]) / p >= SPREAD_MIN_PCT;
  };

  const holdsBeyond50 = (k: number, dir: 'long' | 'short'): boolean => {
    let n = 0;
    for (let j = k + 1; j < candles.length; j++) {
      const e50j = e50arr[j];
      if (!isFinite(e50j)) { n++; continue; }
      const above = candles[j].close > e50j;
      if (dir === 'long' ? above : !above) n++; else break;
    }
    return n >= PERSIST || (k + 1 + n >= candles.length);
  };

  const mkSignal = (k: number, armIndex: number, dir: 'long' | 'short'): SignalEvent => {
    const entryPrice = candles[k].close;
    // The signal only becomes knowable after the forward persistence hold resolves —
    // PERSIST candles past the confirmation close. Fill there, not at k, or the
    // backtest enters at a price whose validity depends on future closes.
    const fillIndex = Math.min(k + PERSIST, candles.length - 1);
    const fillPrice = candles[fillIndex].close;
    const e50k = e50arr[k];
    const sl = dir === 'long' ? e50k * (1 - SL_BUF) : e50k * (1 + SL_BUF);
    const tp = dir === 'long' ? fillPrice + (fillPrice - sl) * 2 : fillPrice - (sl - fillPrice) * 2;
    return {
      timestamp: candles[k].time,
      index: k,
      fillIndex,
      fillPrice,
      armIndex,
      dir,
      anchorPrice: dir === 'long' ? candles[k].low : candles[k].high,
      entryPrice, sl, tp,
    };
  };

  const signalLongs:  SignalEvent[] = [];
  const signalShorts: SignalEvent[] = [];
  let lastDir: 'long' | 'short' | null = null;

  for (let i = 1; i < candles.length; i++) {
    const e9 = e9arr[i], e20 = e20arr[i];
    const e9p = e9arr[i - 1], e20p = e20arr[i - 1];
    if (!isFinite(e9) || !isFinite(e20)) continue;

    // Bullish cross → arm long, then forward-scan for the EMA50 confirmation candle
    if (e9 > e20 && e9p <= e20p && lastDir !== 'long') {
      for (let k = i; k < candles.length; k++) {
        if (e9arr[k] < e20arr[k]) break;              // ribbon flipped back — cross invalidated
        const e50k = e50arr[k];
        if (!isFinite(e50k)) continue;
        const atrBuf = (atr14[k] ?? 0) * ATR_MULT;
        if (candles[k].close > e50k + atrBuf && slopeOK(k, 'long') && spreadOK(k)) {
          if (holdsBeyond50(k, 'long')) {
            signalLongs.push(mkSignal(k, i, 'long'));
            lastDir = 'long';
            break;
          }
        }
      }
    }

    // Bearish cross → arm short, then forward-scan for the EMA50 confirmation candle
    if (e9 < e20 && e9p >= e20p && lastDir !== 'short') {
      for (let k = i; k < candles.length; k++) {
        if (e9arr[k] > e20arr[k]) break;               // ribbon flipped back — cross invalidated
        const e50k = e50arr[k];
        if (!isFinite(e50k)) continue;
        const atrBuf = (atr14[k] ?? 0) * ATR_MULT;
        if (candles[k].close < e50k - atrBuf && slopeOK(k, 'short') && spreadOK(k)) {
          if (holdsBeyond50(k, 'short')) {
            signalShorts.push(mkSignal(k, i, 'short'));
            lastDir = 'short';
            break;
          }
        }
      }
    }
  }

  return { signalLongs, signalShorts };
}
