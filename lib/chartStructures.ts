/* Chart structures, Phase 0 (#1818) - the MEASURED half of "AI draws on the chart".
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (proposal §2): geometry is computed
 * here, in code. The AI layer that comes later names, ranks and explains what
 * these functions measured - it never returns a coordinate. A model handed OHLC
 * values produces plausible levels that do not touch the candles, and on a
 * price chart the user's own eyes are the test instrument, so a channel 0.4%
 * off fails in public. The precedent in this repo NOT to repeat is
 * `app/api/smc-snapshot/route.ts`, which asks the model for KEY_LEVELS:
 * acceptable for a prose read, not for a line we invite someone to trade
 * against.
 *
 * Pure functions over a candle array. No UI, no AI call, no network, no new
 * dependency, no module-level state - same candles in, same numbers out, every
 * time. That reproducibility is the whole argument for the feature, and it is
 * what lets this layer be tested with exact expected values rather than
 * eyeballed.
 *
 * DELIBERATELY ABSENT, so the absence is a decision and not an oversight:
 * overlays and anything on screen (Phase 1); classification - what counts as a
 * channel, flag or wedge (Phase 1, §3); the timeframe ladder (Phase 2, and see
 * the note on required history below); and the count of candles CLOSING beyond
 * a line, which Phase 1's channel rule needs ("no closes outside beyond
 * tolerance", §3). That last one is one loop away, and it is left out because
 * the tolerance it would be measured against is a threshold nobody has set yet.
 *
 * ── REQUIRED HISTORY, AND WHY IT IS A DESIGN INPUT (§4a) ───────────────────
 *
 * §4a binds Phase 2: each rung of the 1W/1D/4H/1H/15M ladder must be ONE
 * fixed-limit request, never a range, because `canFailoverForRequest(isRange)`
 * returns `!isRange` (`lib/klinesFailover.ts`) - a range request has no Bybit
 * fallback and 502s on its own. So the question Phase 0 has to answer is how
 * much history the detector needs per rung.
 *
 * THE FLOOR IS MEASURED, NOT ESTIMATED. On real BTCUSDT candles - Bybit
 * `category=linear`, which is what `app/api/market/klines/route.ts` asks for,
 * measured 2026-10-30 - pivots at the default strength land about one every
 * ten bars per side. Three same-side pivots, the minimum a trendline wants
 * (§3), took 23 to 50 bars depending on the rung. So a 200-bar window per rung
 * is comfortable and 500 is generous; the exact number is a Phase 1 tuning
 * decision, not a constraint.
 *
 * THE CEILING IS NOT CLOSE. The route accepts `limit` up to 1500 in one
 * fixed-limit request and the exchange returns at most 1000, and every rung of
 * the ladder fits inside one request with room left over:
 *
 *     1W    345 candles exist   (6.6 years - the whole BTCUSDT perp history)
 *     1D   1000 candles = 2.7 years
 *     4H   1000 candles = 167 days
 *     1H   1000 candles = 42 days
 *     15M  1000 candles = 10 days
 *
 * So the ladder never needs a range walk and §4a's constraint costs this
 * feature nothing.
 *
 * THE ONE THING IT DOES COST is the weekly rung's depth, and not because of
 * the request shape: 345 weekly candles is simply all that exists. A weekly
 * structure older than mid-2020 cannot be measured by us or by anyone, so §4's
 * "a weekly trendline outranks a 15-minute one" has a horizon. Worth stating
 * in Phase 2 rather than meeting it as a bug.
 */

import type { PACandle } from './priceAction.ts';

/* NO NEW CANDLE SHAPE. This repo already carries four - `PACandle`, `Bar`
 * (`lib/candles.ts`), `OHLCV` (`lib/strategyCore.ts`) and `Candle`
 * (`lib/patterns.ts`) - and a fifth would be the same mistake the header of
 * `lib/priceAction.ts` records about swing conventions: two definitions of one
 * thing is worse than either of them.
 *
 * `PACandle` is the chart-native one. It names the field `timestamp`, matching
 * klinecharts and `Bar`, and its `volume` is optional so a fixture does not
 * have to invent volumes for functions that never read them. `Bar` is
 * assignable to it unchanged. `OHLCV` is NOT - it names the field `time` - so a
 * caller holding `OHLCV[]` maps it, one line, rather than this file growing a
 * second code path. Aliased rather than re-declared so there is still exactly
 * one shape behind the two names. */
export type StructureCandle = PACandle;

/* ── 1. Swing pivots ──────────────────────────────────────────────────────── */

export interface SwingPivot {
  /** Index into the candle array this pivot was found in. EVERY number in this
   *  file is indexed against that same array - see the warning on `measureFit`. */
  index: number;
  timestamp: number;
  /** The high for a `'high'` pivot, the low for a `'low'` one. */
  price: number;
  kind: 'high' | 'low';
}

/**
 * Fractal swing highs and lows, with configurable left/right strength.
 *
 * THE SAME CONVENTION AS THE REST OF THE APP, ON PURPOSE. At `left = right = 3`
 * this returns exactly what `findPivots` in `lib/priceAction.ts` returns, which
 * is also `SWING_LOOKBACK` in `lib/divergence.ts` and the lookback inside
 * `computeSRLevels` in `components/KLineProChart.tsx`. All three ask one
 * question - is any bar in the window STRICTLY higher (lower) - so a tie does
 * not break a pivot. A fourth convention would put this feature's trendlines
 * through different swings than the chart's own S/R lines, on the same chart,
 * which is precisely the disagreement `lib/priceAction.ts` was written to end.
 *
 * TIES PRODUCE SEVERAL PIVOTS AT ONE PRICE, and that is inherited knowingly: a
 * plateau of equal highs makes every bar in it a pivot high, because none of
 * them is beaten. A caller assembling a candidate set for `fitLine` has to
 * expect it - three "pivots" one bar apart at the same price fit a perfect
 * horizontal line that means nothing at all.
 *
 * A PIVOT IS ONLY KNOWABLE `right` BARS AFTER IT FORMS - the bars to its right
 * are what confirm it - so the most recent `right` bars never contain one. That
 * lag is inherent to swing detection, not a limitation worth engineering
 * around: acting on an unconfirmed pivot means acting on a high that may not
 * turn out to be the high.
 *
 * A NON-FINITE HIGH OR LOW ANYWHERE IN THE WINDOW DISQUALIFIES THE CENTRE BAR,
 * rather than being skipped over. `NaN > hi` is false, so a hole in the series
 * would otherwise fail to veto a pivot, and a gap in the data would silently
 * manufacture one.
 *
 * Throws on a strength that is not an integer >= 1. That is a programming
 * error, and the alternative - returning empty - is indistinguishable from the
 * honest answer "no pivots in this series".
 */
export function findSwingPivots(
  candles: readonly StructureCandle[],
  left = 3,
  right = 3,
): { highs: SwingPivot[]; lows: SwingPivot[] } {
  if (!Number.isInteger(left) || left < 1 || !Number.isInteger(right) || right < 1) {
    throw new RangeError(
      `findSwingPivots: left and right must be integers >= 1 (got ${left}, ${right})`,
    );
  }

  const highs: SwingPivot[] = [];
  const lows: SwingPivot[] = [];

  for (let i = left; i < candles.length - right; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;
    let isHigh = Number.isFinite(hi);
    let isLow = Number.isFinite(lo);

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const h = candles[j].high;
      const l = candles[j].low;
      if (!Number.isFinite(h) || h > hi) isHigh = false;
      if (!Number.isFinite(l) || l < lo) isLow = false;
    }

    if (isHigh) highs.push({ index: i, timestamp: candles[i].timestamp, price: hi, kind: 'high' });
    if (isLow) lows.push({ index: i, timestamp: candles[i].timestamp, price: lo, kind: 'low' });
  }

  return { highs, lows };
}

/* ── 2. Least-squares line fit ────────────────────────────────────────────── */

/** Anything with a position and a price can be fitted - `SwingPivot` satisfies
 *  this, and so does a hand-built candidate set from Phase 1. */
export interface FitPoint {
  index: number;
  price: number;
}

export interface LineFit {
  /** Price per CANDLE, not per millisecond - see the note on the x axis below. */
  slope: number;
  /** The price the line takes at index 0, i.e. at the OLDEST candle in the
   *  array the points came from. Extrapolated when the points start later. */
  intercept: number;
  /** How many points the line was fitted through. Phase 1's trendline rule
   *  wants >= 3; a 2-point line is exact by construction and says nothing. */
  pointCount: number;
  /** Coefficient of determination, 0..1 - or NULL when it cannot discriminate.
   *  See `fitLine` for exactly when, and why that is not a 1. */
  r2: number | null;
}

/**
 * Least-squares line through a set of points, in CANDLE-INDEX space.
 *
 * X IS THE CANDLE INDEX, NOT THE TIMESTAMP, and the choice is load-bearing
 * twice over. Slopes come out in price-per-candle, which is the unit a human
 * threshold is written in ("this channel rises about $40 a bar"), instead of
 * price-per-millisecond, which is ~1e-8 and unreadable in a log. And the
 * conversion back is exact rather than approximate: crypto candles are uniform,
 * so index and timestamp are affine, and Phase 1 renders an overlay by
 * evaluating `lineValueAt` at two indices and reading the timestamps off those
 * same two candles. Fitting in milliseconds would buy nothing and cost
 * precision.
 *
 * Computed mean-centred. The textbook `Σxy - ΣxΣy/n` form loses precision when
 * x is an index in the hundreds and y is a price in the tens of thousands,
 * which is this feature's ordinary case rather than its edge case.
 *
 * RETURNS NULL rather than a degenerate line when there is nothing to fit:
 * fewer than two points, any non-finite input, or every point at the same index
 * (a vertical line, which no `y = mx + b` can express). A null is a caller's
 * problem to handle; a line through one point is a caller's problem to discover
 * on the chart.
 *
 * R² IS NULL WHEN IT CANNOT DISCRIMINATE, which is two cases, and in both the
 * arithmetically defensible answer is 1:
 *
 *   - FEWER THAN 3 POINTS. Any line through two points passes through them
 *     exactly, so R² = 1 describes the geometry rather than the fit.
 *   - EVERY POINT AT THE SAME PRICE. There is no variance to explain, so it is
 *     1 - 0/0; the fit is perfect and the number means nothing. That is the
 *     shape a range box arrives in, so Phase 1 will meet it.
 *
 * Reporting 1 in either case hands the next layer a top-quality score for a
 * measurement that was never made, and a threshold of `r2 >= 0.9` would admit
 * both. Null forces the decision to be taken rather than defaulted - the same
 * rule as every other unknown in this codebase.
 */
export function fitLine(points: readonly FitPoint[]): LineFit | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    if (!Number.isFinite(p.index) || !Number.isFinite(p.price)) return null;
    sumX += p.index;
    sumY += p.price;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.index - meanX;
    sxx += dx * dx;
    sxy += dx * (p.price - meanY);
  }
  if (sxx === 0) return null;                        // every point at one index

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const residual = p.price - (slope * p.index + intercept);
    const deviation = p.price - meanY;
    ssRes += residual * residual;
    ssTot += deviation * deviation;
  }

  /* Clamped because ordinary least squares keeps this inside 0..1 by
     construction, while float arithmetic can land a hair outside it. */
  const r2 = n < 3 || ssTot === 0 ? null : Math.min(1, Math.max(0, 1 - ssRes / ssTot));

  return { slope, intercept, pointCount: n, r2 };
}

/** The line's price at a candle index. Extrapolates freely in both directions -
 *  that is what a trendline is for, and it is also why the caller has to know
 *  which candle array the index refers to. */
export function lineValueAt(fit: LineFit, index: number): number {
  return fit.slope * index + fit.intercept;
}

/* ── 3. Fit quality ───────────────────────────────────────────────────────── */

/**
 * How close a candle has to come to the line to count as touching it.
 *
 * TWO SHAPES, ONE MECHANISM EACH, because the right one is not Phase 0's call.
 * A percentage is scale-free and matches the 0.3% clustering `computeSRLevels`
 * already uses. An absolute band is what a volatility-aware caller needs: ATR
 * is in price units and cannot be expressed as a percentage of the line. Phase
 * 1 owns that choice, and this layer refuses to make it quietly - which is why
 * there is no default.
 */
export type TouchTolerance =
  | { pct: number }   // fraction of the line's value, e.g. 0.003 = 0.3%
  | { abs: number };  // price units, e.g. 0.5 * ATR computed by the caller

export interface FitQualityOptions {
  /** Which price on each candle has to reach the line. A support line is
   *  touched by lows, a resistance line by highs; `'close'` is for a level
   *  whose claim is about where bars closed, not where they wicked. */
  side: 'high' | 'low' | 'close';
  tolerance: TouchTolerance;
}

export interface FitQuality {
  /** Candles within tolerance of the line. Counts the whole array, so it can
   *  exceed the number of pivots the line was fitted through - and that excess
   *  is the evidence the line is real rather than an artefact of three points. */
  touchCount: number;
  /** Null when nothing touched. Together these two say whether the structure is
   *  live or a piece of history (§5: a stale line is worse than no line). */
  firstTouchTimestamp: number | null;
  lastTouchTimestamp: number | null;
  /** SIGNED, in price units: the last close minus the line at the last candle.
   *  Positive means price sits above the line. Null when the array is empty or
   *  the last close is not finite - never 0, which would read as "exactly on
   *  the line". */
  distance: number | null;
  /** The same figure as a fraction of the line's value, for thresholds that
   *  have to work on both BTC and a sub-cent coin. Null when `distance` is, and
   *  also when the line has extrapolated to zero or below, where a percentage
   *  of it is meaningless rather than merely large. */
  distancePct: number | null;
}

/**
 * Touch count, first and last touch, and where price sits now relative to the
 * line.
 *
 * THE FIT AND THE CANDLES MUST SHARE AN INDEX ORIGIN. `fit` is evaluated at
 * `0 .. candles.length - 1` of the array passed HERE. Fit a line through pivots
 * found in a 500-candle array, then measure it against the last 200 of them,
 * and every number below is wrong by 300 bars of slope - silently, and most
 * often showing up as a touch count of zero on a line that plainly touches.
 * Pass the same array to `findSwingPivots` and to this function.
 *
 * Tolerance is taken at the LINE's value on each candle, not at the candle's
 * own price. On a steep line the two differ, and the line is the thing whose
 * neighbourhood is being defined.
 *
 * Throws on a negative or non-finite tolerance, for the reason
 * `findSwingPivots` throws: a silent zero-touch answer to a bad parameter is
 * indistinguishable from the honest one.
 */
export function measureFit(
  candles: readonly StructureCandle[],
  fit: LineFit,
  options: FitQualityOptions,
): FitQuality {
  const { side, tolerance } = options;
  const band = 'pct' in tolerance ? tolerance.pct : tolerance.abs;
  if (!Number.isFinite(band) || band < 0) {
    throw new RangeError(`measureFit: tolerance must be finite and >= 0 (got ${band})`);
  }

  let touchCount = 0;
  let firstTouchTimestamp: number | null = null;
  let lastTouchTimestamp: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = side === 'high' ? candle.high : side === 'low' ? candle.low : candle.close;
    if (!Number.isFinite(price)) continue;

    const line = lineValueAt(fit, i);
    if (!Number.isFinite(line)) continue;

    const allowed = 'pct' in tolerance ? Math.abs(line) * tolerance.pct : tolerance.abs;
    if (Math.abs(price - line) > allowed) continue;

    touchCount++;
    if (firstTouchTimestamp === null) firstTouchTimestamp = candle.timestamp;
    lastTouchTimestamp = candle.timestamp;
  }

  const last = candles.length ? candles[candles.length - 1] : null;
  const lineAtLast = last ? lineValueAt(fit, candles.length - 1) : NaN;
  const haveDistance = last !== null && Number.isFinite(last.close) && Number.isFinite(lineAtLast);
  const distance = haveDistance ? last.close - lineAtLast : null;

  return {
    touchCount,
    firstTouchTimestamp,
    lastTouchTimestamp,
    distance,
    distancePct: distance !== null && lineAtLast > 0 ? distance / lineAtLast : null,
  };
}
