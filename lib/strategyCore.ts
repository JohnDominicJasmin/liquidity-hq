// Pure, framework-agnostic EMA ribbon signal detection - shared by the live
// useEMAStrategy hook and the backtest engine so the two can never diverge.
// No React, no fetch - just math over a candle array.

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

/* SMA(N,M) - NOT the plain rolling mean smaArr above computes, and this is a
 * real distinction, not a naming nitpick: it is the formula klinecharts'
 * own "SMA" builtin actually renders (node_modules/klinecharts/dist/
 * index.esm.js, `simpleMovingAverage.calc`, verified against the compiled
 * source rather than assumed from the name - the same discipline #981
 * applied to the overlay/indicator store question).
 *
 * Recursive, not a rolling window:
 *   smaValue[N-1] = mean of the first N values                    (bootstrap)
 *   smaValue[i]   = (value[i]*M + smaValue[i-1]*(N-M+1)) / (N+1)   for i > N-1
 *
 * At M=2 this is algebraically identical to a standard EMA: the coefficient
 * on the new value is 2/(N+1), which is EMA's own smoothing factor for
 * period N. SMA(N,M) is the general form; EMA is the M=2 special case. The
 * registry's SMA chip exposes M as "Weight" (1-10, default 2) precisely
 * because the two only coincide at the default - a trader who changes it
 * gets a genuinely different smoothing, not a cosmetic one.
 *
 * WHY THIS MATTERS HERE: the registry's SMA entry has no `basis` field today,
 * which the codebase otherwise uses specifically to flag "the displayed name
 * is not what is computed" (ADX/STOCH). It should - "SMA" reads as the
 * textbook rolling mean smaArr computes, and is not that. Not fixed in this
 * commit (a registry/labelling change is its own decision); named here so it
 * is not silently compounded by a condition that also uses the wrong
 * formula for what the chart draws when this chip is selected. */
export function smaNMArr(values: number[], n: number, m: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  if (values.length < n) return result;
  let sma = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  result[n - 1] = sma;
  for (let i = n; i < values.length; i++) {
    sma = (values[i] * m + sma * (n - m + 1)) / (n + 1);
    result[i] = sma;
  }
  return result;
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

// Choppiness Index (E.W. Dreiss) - 0-100, bounded. High = range-bound/choppy
// (true range is large relative to net price travel - lots of back-and-forth).
// Low = trending (price is actually covering ground). Standard thresholds:
// >61.8 choppy, <38.2 trending, in between transitional. Warns instead of
// silently filtering - the EMA ribbon's persistence rule already does the
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
  spreadMinPct: number;  // 0 = off, >0 = on - actual per-TF threshold resolved via SPREAD_MIN_BY_TF
  atrMult:      number;  // ATR(14) multiplier for EMA50 clearance buffer (0.35 = 35%)
  persistBoost: number;  // Integer added to all PERSIST_BY_TF base values (can be negative)
}

// Raw EMA9/20 cross + first close beyond EMA50 confirms immediately - no spread
// requirement, no ATR clearance buffer, no forward persistence wait. This is the
// default because a 3-year majors/1h backtest showed it beats the stricter filter
// below on every metric: 36.2% win rate vs 32.9%, profit factor 1.13 vs 0.98, and
// smaller max drawdown (-54R vs -78R) despite firing ~2.2x more often. The extra
// confirmation steps below don't earn their keep - they cut a real (if thin) edge
// down to a coin flip. See app/backtest to re-validate if the core logic changes.
export const DEFAULT_FILTER_PARAMS: SignalFilterParams = {
  spreadMinPct: 0,
  atrMult:      0,
  persistBoost: -10,
};

// Stricter, persistence-based confirmation - requires the EMA9/20 ribbon to clearly
// separate, price to close meaningfully past EMA50, and the move to hold for several
// candles before a marker confirms. Fewer, calmer-looking signals, but empirically a
// coin flip (PF 0.98) rather than a real edge on the same sample above. Kept as an
// opt-in (Arena's Anti-Chop Filter toggle) for traders who'd rather have fewer alerts
// than more total return.
export const STRICT_FILTER_PARAMS: SignalFilterParams = {
  spreadMinPct: 0.003,
  atrMult:      0.35,
  persistBoost: 0,
};

export const PERSIST_BY_TF: Record<string, number> = {
  '1m': 4, '5m': 5, '15m': 8, '30m': 4, '1h': 3, '2h': 3, '4h': 3, '1d': 2,
};

// EMA9/20 spread required before a ribbon counts as "clearly separated" (STRICT mode
// only - DEFAULT mode leaves spreadMinPct at 0 and skips this filter entirely). A flat
// 0.3% was previously applied to every timeframe; measured against live BTC candles
// that's above the 90th percentile of actual spread on 1m/5m/15m (near-unreachable -
// only ~1% of 5m candles ever cleared it) while sitting BELOW the 50th percentile on
// 1h/4h/1d (no filtering at all up there). These are each timeframe's ~75th percentile
// of EMA9/20 spread on BTC, so "clearly separated" means the same relative thing at
// every timeframe instead of one absolute number that only happened to fit 30m.
export const SPREAD_MIN_BY_TF: Record<string, number> = {
  '1m': 0.0006, '5m': 0.0011, '15m': 0.0015, '30m': 0.0033,
  '1h': 0.0045, '2h': 0.0065, '4h': 0.0083, '1d': 0.0245,
};

// Resolves the requested spread strictness (0 = off, >0 = "on") to the actual
// per-timeframe threshold. Keeps SignalFilterParams.spreadMinPct as a simple on/off
// switch in DEFAULT_FILTER_PARAMS / STRICT_FILTER_PARAMS while the real number scales
// with the timeframe being scanned.
function resolveSpreadMin(tf: string, requested: number): number {
  return requested > 0 ? (SPREAD_MIN_BY_TF[tf] ?? requested) : 0;
}

const SLOPE_BARS = 5;
const SLOPE_MIN  = 0.001;
const SL_BUF     = 0.005; // 0.5% buffer beyond EMA50 for stop loss - matches live strategy card SL/TP rule

/* ── Signal detection ─────────────────────────────────────────────────────── */
export interface SignalEvent {
  timestamp:   number;
  index:       number;          // confirmation candle index - chart marker placement
  fillIndex:   number;          // first index at which the signal is actually KNOWABLE: the
                                // confirmation candle plus the PERSIST forward hold. Backtest
                                // entries fill here so results can't peek at closes that hadn't
                                // printed yet; the chart marker stays anchored at `index`.
  fillPrice:   number;          // close of the fill candle - honest backtest entry price
  armIndex:    number;          // index of the EMA9/20 cross that armed this signal (before the later confirm index)
  dir:         'long' | 'short';
  anchorPrice: number;          // low for long, high for short - chart marker placement
  entryPrice:  number;          // close of confirmation candle (marker candle) - display only
  sl:          number;
  tp:          number;          // fixed 2:1 R:R target measured from the fill price
  pending:     boolean;         // true = PERSIST hold incomplete (live edge) - hollow marker, exclude from backtest
}

export interface DetectedSignals {
  signalLongs:  SignalEvent[];
  signalShorts: SignalEvent[];
}

// 2-step strategy: EMA9/20 cross arms a direction, then the first candle that
// CLOSES meaningfully beyond EMA50 (ATR buffer + ribbon spread + EMA50 slope)
// and HOLDS there for PERSIST candles confirms the signal. Signals strictly
// alternate long/short - see useEMAStrategy.ts history for the full rationale.
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
  const SPREAD_MIN_PCT = resolveSpreadMin(tf, spreadMinPct);
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

  const holdsBeyond50 = (k: number, dir: 'long' | 'short'): 'confirmed' | 'pending' | 'rejected' => {
    // PERSIST=0 (DEFAULT mode / anti-chop OFF) - fire immediately on EMA50 confirmation close.
    if (PERSIST === 0) return 'confirmed';
    let n = 0;
    for (let j = k + 1; j < candles.length; j++) {
      const e50j = e50arr[j];
      if (!isFinite(e50j)) { n++; continue; }
      const above = candles[j].close > e50j;
      if (dir === 'long' ? above : !above) {
        n++;
        if (n >= PERSIST) return 'confirmed'; // threshold met - confirmed even if price later crosses back
      } else {
        return 'rejected'; // crossed back before PERSIST candles held
      }
    }
    // Ran out of candles before PERSIST met - live edge, show hollow pending marker.
    return 'pending';
  };

  const mkSignal = (k: number, armIndex: number, dir: 'long' | 'short', pending: boolean): SignalEvent => {
    const entryPrice = candles[k].close;
    // The signal only becomes knowable after the forward persistence hold resolves -
    // PERSIST candles past the confirmation close. Fill there, not at k, or the
    // backtest enters at a price whose validity depends on future closes.
    const fillIndex = Math.min(k + PERSIST, candles.length - 1);
    const fillPrice = candles[fillIndex].close;
    const e50k = e50arr[k];
    const sl = dir === 'long' ? e50k * (1 - SL_BUF) : e50k * (1 + SL_BUF);
    const tp = dir === 'long' ? fillPrice + (fillPrice - sl) * 2 : fillPrice - (sl - fillPrice) * 2;
    // Chart marker is placed at the ARM candle (EMA9/20 cross) so traders see
    // the signal as soon as momentum shifts - not delayed to the EMA50
    // confirmation candle. Entry/SL/TP/backtest fill still use candle k onward.
    return {
      timestamp: candles[armIndex].time,
      index: k,
      fillIndex,
      fillPrice,
      armIndex,
      dir,
      anchorPrice: dir === 'long' ? candles[armIndex].low : candles[armIndex].high,
      entryPrice, sl, tp,
      pending,
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
        if (e9arr[k] < e20arr[k]) break;              // ribbon flipped back - cross invalidated
        const e50k = e50arr[k];
        if (!isFinite(e50k)) continue;
        const atrBuf = (atr14[k] ?? 0) * ATR_MULT;
        if (candles[k].close > e50k + atrBuf && slopeOK(k, 'long') && spreadOK(k)) {
          const hold = holdsBeyond50(k, 'long');
          if (hold === 'confirmed' || hold === 'pending') {
            signalLongs.push(mkSignal(k, i, 'long', hold === 'pending'));
            lastDir = 'long';
            break;
          }
          // hold === 'rejected': candle broke EMA50 before PERSIST - keep scanning for next confirm
        }
      }
    }

    // Bearish cross → arm short, then forward-scan for the EMA50 confirmation candle
    if (e9 < e20 && e9p >= e20p && lastDir !== 'short') {
      for (let k = i; k < candles.length; k++) {
        if (e9arr[k] > e20arr[k]) break;               // ribbon flipped back - cross invalidated
        const e50k = e50arr[k];
        if (!isFinite(e50k)) continue;
        const atrBuf = (atr14[k] ?? 0) * ATR_MULT;
        if (candles[k].close < e50k - atrBuf && slopeOK(k, 'short') && spreadOK(k)) {
          const hold = holdsBeyond50(k, 'short');
          if (hold === 'confirmed' || hold === 'pending') {
            signalShorts.push(mkSignal(k, i, 'short', hold === 'pending'));
            lastDir = 'short';
            break;
          }
          // hold === 'rejected': candle broke EMA50 before PERSIST - keep scanning for next confirm
        }
      }
    }
  }

  return { signalLongs, signalShorts };
}
