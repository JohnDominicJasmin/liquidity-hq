/* Chart structures, Phase 1 (#1818) - DETERMINISTIC detection, built on Phase 0's measurements.
 *
 * Phase 0 (`lib/chartStructures.ts`) answers "where are the pivots, what line fits these points,
 * how well does it fit". This file answers the next question - "is there a trendline, a channel or
 * a range here at all" - and it answers it in code, with no AI call and no network.
 *
 * WHY THAT ORDER MATTERS, because the repo already contains the other order. `lib/drawStructure.ts`
 * takes `RawProposal.touchIndices` from the model and fits a line through whatever candles the
 * model picked. It defends itself well - nothing is asserted and the user declines a bad line - but
 * it is AI-proposes/code-validates, and #1818 §2 asks for the reverse:
 *
 *     deterministic pivots -> deterministic fits -> deterministic classification -> THEN the AI
 *     picks the one to three that matter and writes the read
 *
 * This file is the third step. It is what lets the AI layer rank structures it did not invent, and
 * it is the half that can never hallucinate a coordinate.
 *
 * ── DESCRIPTIVE, NEVER PREDICTIVE (QA's guardrail, owner did not object, 2026-11-07) ──────────
 *
 * Nothing here returns a target, an entry, a stop or a direction to trade. The output is geometry
 * plus the evidence for it:
 *
 *     OK   "rising channel; price has touched the lower rail three times"
 *     NOT  "buy here, target $X"
 *
 * `invalidationPrice` is the one field that could be misread as advice, so it is defined narrowly:
 * it is the structure's OWN line evaluated at the most recent candle - the price at which this
 * structure stops being the thing that was measured. It is a property of the geometry, not a stop
 * loss and not a recommendation, and the field comment says so where a reader will meet it. There
 * is deliberately no `confidence`, no `score` and no `direction`, for the reason
 * `lib/drawStructure.ts` gives about its own omitted confidence: a component cannot render a number
 * it was never handed.
 *
 * ── THE SEARCH IS DELIBERATELY TINY, AND THIS IS THE DESIGN DECISION WORTH ARGUING WITH ───────
 *
 * The obvious implementation tries many subsets of pivots and keeps the best R². That is exactly
 * how this project has produced a meaningless 0.99998 before: searching 1000 subsets for the best
 * fit finds a superb fit in pure noise, because the search itself is the thing generating the
 * number. Best-of-N carries no information unless N is reported and compared against a null.
 *
 * So the candidate set here is FIXED, SMALL and NESTED: the most recent 3, 4 and 5 same-side
 * pivots. Three candidates per side, chosen by recency rather than by fit, which is also what a
 * human drawing the line does. `candidatesConsidered` is returned on every structure so the next
 * layer can see the exposure rather than infer it, and `MAX_CANDIDATES_PER_SIDE` is exported so a
 * test can assert the number did not quietly grow.
 *
 * WHAT THIS COSTS, STATED PLAINLY: a genuine trendline through pivots 1, 3 and 6 is not found. That
 * is accepted. A line a human would not have drawn, discovered by searching, is worse than a missed
 * line - the user's own eyes are the test instrument here, and an invented structure fails in
 * public while a missing one is merely an incomplete answer. "No clean structure right now" is a
 * correct and shippable answer (§Non-negotiable).
 *
 * ── THE THRESHOLDS ARE MEASURED AGAINST A NULL MODEL, NOT CHOSEN ──────────────────────────────
 *
 * A detector is only as good as its false-positive rate on data with no structure in it, so the
 * thresholds were set by sweeping them against 300 seeded random walks of 160 candles, with two
 * synthetic positive controls that must keep passing: a textbook rising channel and a flat range.
 * Percentages are walks where ANY structure was returned.
 *
 *     R2     extra=2   extra=3   extra=5   extra=8      channel / range still found?
 *     0.90    42.0%     32.3%     17.0%      8.7%       extra=8 degrades channel to trendline
 *     0.95    31.3%     24.3%     12.7%      7.0%       same
 *     0.97    26.7%     21.3%     10.7%      5.0%       both controls passed
 *     0.99    16.0%     12.0%      5.3%      2.0%       RANGE NO LONGER FOUND
 *     0.995   12.7%      9.3%      4.0%      1.7%       RANGE NO LONGER FOUND
 *
 * THAT LAST COLUMN WAS THE BUG, NOT A TRADEOFF, and the second table is the one that matters now.
 * Horizontal rails were being judged by R², which is the wrong question for them - so the range
 * row was not telling us "0.99 is too strict", it was telling us the range gate was broken. With
 * `isHorizontalCandidate` splitting the two shapes, re-swept against the same 300 walks plus a
 * THIRD control (a textbook range whose rails are exactly flat, which the old code could not find
 * at any threshold):
 *
 *     R2      noise FP    channel   wobbly range   EXACT range
 *     0.97      11.0%        ok          ok            ok
 *     0.99     * 5.7% *      ok          ok            ok        * chosen
 *     0.995      4.3%        ok          ok            ok
 *
 * So fixing the gate halved the noise rate rather than trading anything away: 10.7% -> 5.7% with
 * one more control passing than before.
 *
 * AND THE FIRST VERSION OF THAT GATE WAS ITSELF WRONG - QA caught it before it merged, and it is
 * recorded here because the synthetic controls above all PASSED while it was broken. It tested
 * pivot SPREAD against the touch band (`max - min <= 0.3% of price`) instead of SLOPE. On BTCUSDT
 * that band is ~229 dollars and four 15m swing highs land inside it routinely, so the exemption
 * from the only quality gate in the file became the cheapest way in. Measured on live data: rails
 * admitted at R2 0.34 (BTC 15m), 0.28 (ADA 15m) and 0.05 (BNB 15m) while MIN_TRENDLINE_R2 was
 * 0.99, one of them clearing the spread test by 79 CENTS with a cluster 99.7% as wide as the band.
 *
 * Two repairs: the test is now slope-per-bar relative to price (the scale-free form) AND requires
 * the cluster to sit well inside the band rather than merely within it. After them, a live audit
 * of all 40 cells admitted 7 structures, every one via the sloped gate, worst R2 0.9917, none
 * below 0.99.
 *
 * THE LESSON THAT GENERALISES: a synthetic control cannot catch a threshold that is wrong about
 * SCALE, because the synthetic prices were ~100 and the defect needs a price of ~76,000 to open
 * up. Null models bound noise; they say nothing about whether the gate means what it says. 0.995 measures 4.3% and all three controls still pass, so
 * there is headroom left - it is not taken here because 0.99 is the conventional threshold and the
 * extra 1.4 points costs tolerance for genuinely sloped trendlines that nothing has measured yet.
 *
 * TWO THINGS THAT TABLE SHOWS WHICH ARE WORTH MORE THAN THE CHOSEN CELL:
 *
 *   1. The excess-touch count is a far stronger lever than R². Going 2 -> 5 at fixed R² cuts the
 *      noise rate by about 60%; going 0.90 -> 0.97 at fixed extra cuts it by about 35%.
 *   2. R² >= 0.99 stops finding ranges at all, and that is not a tuning accident. A flat rail has
 *      almost no variance for a line to explain, so its R² is low or null however real it is -
 *      which is exactly what Phase 0's `fitLine` header predicted this layer would meet. **R² is
 *      the wrong gate for a horizontal rail.** Giving ranges their own gate - flatness plus
 *      touches, no R² - should let the sloped structures move to 0.99 and roughly halve the noise
 *      rate again. Left as a follow-up rather than done here, because it needs its own controls.
 *
 * 5.7% ON PURE NOISE IS STILL NOT A GOOD NUMBER and is recorded as a known limit rather than
 * presented as a result. It is tolerable only because nothing here asserts: the caller offers a
 * line, marks the candles it was drawn through, and the user declines it. It would not be
 * tolerable in anything that fired an alert.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────────────────────────
 *
 * Flags, wedges, triangles, double tops and head-and-shoulders are Phase 2 and Phase 4. The
 * timeframe ladder and higher-timeframe weighting are Phase 2 - this file takes ONE candle array
 * and labels every structure with the timeframe it was given, so a ladder is a caller looping, not
 * a change here. Overlay rendering is the caller's; this module never imports klinecharts.
 */
import {
  findSwingPivots,
  fitLine,
  lineValueAt,
  measureFit,
  type FitQuality,
  type LineFit,
  type StructureCandle,
  type SwingPivot,
  type TouchTolerance,
} from './chartStructures.ts';

/* ── Thresholds ───────────────────────────────────────────────────────────── */

/** Minimum same-side pivots a trendline may be fitted through. Two points fit exactly and say
 *  nothing - Phase 0's `fitLine` returns `r2: null` for them precisely so this layer cannot
 *  accept one by accident. */
export const MIN_TRENDLINE_PIVOTS = 3;

/** The nested candidate windows: most recent 3, 4 and 5 pivots. Exported so a spec can assert the
 *  search has not grown - see the header on best-of-N. */
export const CANDIDATE_PIVOT_COUNTS: readonly number[] = [3, 4, 5];
export const MAX_CANDIDATES_PER_SIDE = CANDIDATE_PIVOT_COUNTS.length;

/** How much of a SLOPED line's pivot variance it must explain. Horizontal rails do not go through
 *  this gate at all - see `isHorizontalCandidate` for why R² is the wrong question for them.
 *  MEASURED, not chosen; see the null-model tables in the header. */
export const MIN_TRENDLINE_R2 = 0.99;

/** Touches IN EXCESS of the pivots the line was fitted through.
 *
 * THIS IS THE THRESHOLD THAT DOES THE WORK, and the first version of this file got it wrong in a
 * way worth recording. `measureFit` counts the whole window, so a line fitted through 3 pivots has
 * at least 3 touches BY CONSTRUCTION - those same 3 candles. A plain `touchCount >= 3` is
 * therefore satisfied by every line that exists, and it let 15 of 20 random walks through.
 *
 * Phase 0's own comment on `touchCount` had already said what to require: *"it can exceed the
 * number of pivots the line was fitted through - and that excess is the evidence the line is real
 * rather than an artefact of three points."* The excess is the measurement; the raw count is not.
 *
 * Set to 5 from the null-model sweep in the header, not from taste. */
export const MIN_EXTRA_TOUCHES = 5;

/** Default touch band. A percentage rather than an absolute, matching the 0.3% clustering
 *  `computeSRLevels` already uses, so a trendline and the chart's own S/R agree about what "near"
 *  means. A volatility-aware caller passes `{ abs: 0.5 * atr }` instead. */
export const DEFAULT_TOLERANCE: TouchTolerance = { pct: 0.003 };

/** A range's rails have to be flat. Measured as price-per-candle slope relative to the rail's own
 *  price, so it is scale-free: over a 100-candle window a rail may drift at most this fraction of
 *  its value per candle and still count as horizontal. */
export const MAX_RANGE_SLOPE_PCT_PER_BAR = 0.0002;

/** A channel's two rails must be near enough to parallel. Compared as a fraction of the steeper
 *  rail, so it is scale-free and does not punish a steep channel for a small absolute difference. */
export const MAX_CHANNEL_SLOPE_DIVERGENCE = 0.25;

/* ── Output ───────────────────────────────────────────────────────────────── */

export type StructureKind = 'trendline' | 'channel' | 'range';

/** One rail of a structure: the line, and the evidence for it. */
export interface StructureRail {
  side: 'high' | 'low';
  /** Which gate admitted this rail.
   *
   *  CARRIED BECAUSE THE OUTPUT USED TO LIE ABOUT IT. A rail admitted on the horizontal path was
   *  emitted as `kind: 'trendline'`, so a structure that had never been held to the sloped R²
   *  standard claimed to be a sloped structure and nothing downstream could tell. A horizontal
   *  rail is now only ever offered as part of a `range`. */
  gate: 'sloped' | 'horizontal';
  fit: LineFit;
  quality: FitQuality;
  /** The pivots the line was fitted through - kept so the UI can mark them and the user can see
   *  WHAT the line was drawn through rather than only the line, the same reasoning
   *  `lib/drawStructure.ts` gives for keeping `touchTimestamps`. */
  pivots: SwingPivot[];
  /** The rail's endpoints in chart coordinates, ready for an overlay. */
  from: { timestamp: number; price: number };
  to: { timestamp: number; price: number };
}

export interface DetectedStructure {
  kind: StructureKind;
  /** Whatever the caller called this candle array - '4h', '1d'. Carried, never parsed: Phase 2's
   *  ladder weights by it and this file has no opinion about which timeframes exist. */
  timeframe: string;
  /** A trendline has one rail. A channel and a range have two, low first. */
  rails: StructureRail[];
  /** How many candidate pivot windows were tried to produce this, so the reader can discount a
   *  best-of-N fit instead of having to guess. Always <= MAX_CANDIDATES_PER_SIDE per rail. */
  candidatesConsidered: number;
  /** The nearest rail's own value at the most recent candle: the price at which this structure
   *  stops being what was measured.
   *
   *  NOT A STOP LOSS AND NOT ADVICE. It is a geometric property - the line is here, and below or
   *  above it the structure described is no longer the structure present. Named as #1818
   *  §Non-negotiable requires; defined narrowly so the AI layer cannot restate it as a target. */
  invalidationPrice: number;
  /** Candles between the structure's first touch and the newest candle. "Age" in §Non-negotiable;
   *  bars rather than milliseconds so it is comparable across timeframes without a clock. */
  ageBars: number;
  /** Candles since the most recent touch of any rail. A structure last touched 200 bars ago is
   *  history, and §5 says a stale line is worse than no line - this is the number that says so. */
  barsSinceLastTouch: number;
}

/** Why nothing was returned. A caller shows "no clean structure right now" (§Non-negotiable) and
 *  can say which wall was hit, which is the difference between a product that looks broken and one
 *  that looks honest. */
export type NoStructureReason =
  | 'not-enough-candles'
  | 'not-enough-pivots'
  | 'no-fit-cleared-thresholds';

export interface DetectionResult {
  structures: DetectedStructure[];
  /** Set only when `structures` is empty. Never a silent empty array. */
  reason: NoStructureReason | null;
}

export interface DetectOptions {
  timeframe: string;
  tolerance?: TouchTolerance;
  /** Pivot strength, passed straight to `findSwingPivots`. Defaults to the app-wide 3/3. */
  pivotStrength?: number;
  minR2?: number;
  /** Touches beyond the fitted pivots - see MIN_EXTRA_TOUCHES. */
  minExtraTouches?: number;
}

/* ── Detection ────────────────────────────────────────────────────────────── */

/** The nested candidate windows for one side's pivots, most recent first, largest last. Returns
 *  fewer than `CANDIDATE_PIVOT_COUNTS.length` entries when there are not enough pivots, and never
 *  the same window twice. */
function candidateWindows(pivots: readonly SwingPivot[]): SwingPivot[][] {
  const out: SwingPivot[][] = [];
  for (const n of CANDIDATE_PIVOT_COUNTS) {
    if (pivots.length < n) break;
    out.push(pivots.slice(pivots.length - n));
  }
  return out;
}

/** The price band `measureFit` would call a touch, at this price level. */
function toleranceBand(tolerance: TouchTolerance, price: number): number {
  return 'pct' in tolerance ? Math.abs(price) * tolerance.pct : tolerance.abs;
}

/** How tightly a horizontal rail's pivots must cluster, as a fraction of the touch band.
 *
 * NOT 1.0, AND THAT WAS THE DEFECT QA FOUND. The first version asked only `spread <= band`, which
 * on BTCUSDT is a 229-dollar window - four 15m swing highs land inside it routinely. A measured
 * case cleared it by 79 CENTS with a spread 99.7% as wide as the band, which is not a level, it is
 * a smear as wide as the tolerance itself. If every pivot sits at the edge of what counts as a
 * touch, they are not at one price. */
export const HORIZONTAL_SPREAD_FRACTION = 0.35;

/**
 * Is this candidate a HORIZONTAL rail?
 *
 * TWO TESTS, AND THE FIRST ONE IS THE REPAIR. "Flat" is a statement about SLOPE, so it is tested
 * as slope per candle relative to the line's own price - the scale-free form already used by
 * `MAX_RANGE_SLOPE_PCT_PER_BAR`. The original version tested only pivot SPREAD against the touch
 * band, which is a different claim: "a small range relative to a large price" rather than "flat".
 * Because this path is an exemption from the only quality gate in the file, that made "nearly flat
 * on an expensive asset" the cheapest way in - it admitted rails at R2 0.05 to 0.34 on live data
 * while MIN_TRENDLINE_R2 was 0.99.
 *
 * The second test keeps the cluster tight: the pivots must sit well inside the band, not merely
 * within it. See HORIZONTAL_SPREAD_FRACTION.
 *
 * WHY THIS EXISTS, AND WHY R² CANNOT ANSWER IT. R² asks how much of the pivots' price VARIANCE the
 * line explains. A horizontal rail has almost none, so the cleaner the rail the worse it scores,
 * which is the opposite of the intended direction. Measured:
 *
 *     3 pivots at an identical price      -> r2: null   (ssTot === 0; `fitLine` returns null, and
 *                                            the sloped gate refuses null outright)
 *     3 pivots at a NEARLY identical price -> r2: 0.138  (the line is explaining noise)
 *
 * So a textbook range whose rails are exactly flat scored WORSE than a random walk, and returned
 * nothing at any threshold. This is not the 0.99-only effect the first version of this file
 * recorded - QA found the null case from the other direction and it holds at 0.97 too.
 *
 * The test is the one the rest of the app already uses for "same level": the pivots' total price
 * spread fits inside the band `measureFit` would count as a touch. If they are all within a touch
 * of each other, they are one level, and the question is how many candles came back to it - not
 * how well a line through them explains their wobble.
 */
function isHorizontalCandidate(
  window: readonly SwingPivot[],
  fit: LineFit,
  tolerance: TouchTolerance,
  lastIndex: number,
): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const p of window) {
    if (!Number.isFinite(p.price)) return false;
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;

  /* FLAT is about slope. Null when the line has extrapolated to zero or below, where a percentage
     of it is meaningless - treated as not-horizontal rather than admitted. */
  const perBar = slopePctPerBar(fit, lastIndex);
  if (perBar === null || Math.abs(perBar) > MAX_RANGE_SLOPE_PCT_PER_BAR) return false;

  /* And the pivots must be at ONE price, not merely inside the tolerance. */
  return max - min <= HORIZONTAL_SPREAD_FRACTION * toleranceBand(tolerance, (min + max) / 2);
}

/** Best rail for one side, or null. "Best" is by touch count then R², among at most three nested
 *  candidates - see the header for why the search is this small. */
function bestRail(
  candles: readonly StructureCandle[],
  pivots: readonly SwingPivot[],
  side: 'high' | 'low',
  tolerance: TouchTolerance,
  minR2: number,
  minExtraTouches: number,
): { rail: StructureRail; considered: number } | null {
  const windows = candidateWindows(pivots);
  let best: StructureRail | null = null;

  for (const window of windows) {
    const fit = fitLine(window.map(p => ({ index: p.index, price: p.price })));
    if (!fit) continue;

    /* TWO GATES, because the two shapes are measured by different things - see
       `isHorizontalCandidate`. A horizontal rail is judged by whether its pivots sit at one level
       and how many candles returned to it; a sloped one by R². Applying R² to both is what made a
       perfectly flat range unfindable at every threshold.

       `pointCount >= MIN_TRENDLINE_PIVOTS` is required on BOTH paths, so the horizontal path
       cannot become a way in for the 2-point lines the sloped path refuses by checking r2 null. */
    if (fit.pointCount < MIN_TRENDLINE_PIVOTS) continue;
    const horizontal = isHorizontalCandidate(window, fit, tolerance, candles.length - 1);
    if (!horizontal && (fit.r2 === null || fit.r2 < minR2)) continue;

    const quality = measureFit(candles, fit, { side, tolerance });
    /* EXCESS, not the raw count - the fitted pivots are touches by construction. */
    if (quality.touchCount - fit.pointCount < minExtraTouches) continue;

    /* Touch count first, and ONLY touch count as a tiebreak between a horizontal and a sloped
       candidate: `r2 ?? 0` would rank a perfect flat rail (null) below a mediocre sloped one,
       which is the same inversion this change exists to remove. R² breaks ties only when both
       candidates have one. */
    const bothHaveR2 = fit.r2 !== null && best !== null && best.fit.r2 !== null;
    const better =
      best === null ||
      quality.touchCount > best.quality.touchCount ||
      (quality.touchCount === best.quality.touchCount && bothHaveR2 &&
        (fit.r2 as number) > (best.fit.r2 as number));
    if (!better) continue;

    const firstIndex = window[0].index;
    const lastIndex = candles.length - 1;
    best = {
      side,
      gate: horizontal ? 'horizontal' : 'sloped',
      fit,
      quality,
      pivots: [...window],
      from: { timestamp: candles[firstIndex].timestamp, price: lineValueAt(fit, firstIndex) },
      to: { timestamp: candles[lastIndex].timestamp, price: lineValueAt(fit, lastIndex) },
    };
  }

  return best ? { rail: best, considered: windows.length } : null;
}

/** Slope as a fraction of the line's own price at the newest candle, so "flat" means the same
 *  thing on BTC and on a sub-cent coin. Null when the line has extrapolated to zero or below,
 *  where a percentage of it is meaningless rather than merely large - the same rule
 *  `measureFit`'s `distancePct` follows. */
function slopePctPerBar(fit: LineFit, lastIndex: number): number | null {
  const value = lineValueAt(fit, lastIndex);
  if (!Number.isFinite(value) || value <= 0) return null;
  return fit.slope / value;
}

function barsSince(candles: readonly StructureCandle[], timestamp: number | null): number {
  if (timestamp === null) return candles.length;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].timestamp === timestamp) return candles.length - 1 - i;
  }
  return candles.length;
}

/**
 * Every structure this window supports, strongest evidence first.
 *
 * ONE ARRAY, ONE INDEX ORIGIN. Pivots, fits and touch measurements all index against the array
 * passed here, which is the hazard `measureFit`'s own header warns about: fit against 500 candles,
 * measure against the last 200, and every number is wrong by 300 bars of slope while looking
 * plausible. Everything below passes `candles` through unchanged.
 *
 * Returns `{ structures: [], reason }` rather than an empty array on its own. "Nothing cleared the
 * thresholds" and "there were never enough candles to ask" are different answers and the product
 * says which.
 */
export function detectStructures(
  candles: readonly StructureCandle[],
  options: DetectOptions,
): DetectionResult {
  const {
    timeframe,
    tolerance = DEFAULT_TOLERANCE,
    pivotStrength = 3,
    minR2 = MIN_TRENDLINE_R2,
    minExtraTouches = MIN_EXTRA_TOUCHES,
  } = options;

  /* The smallest window that could produce MIN_TRENDLINE_PIVOTS pivots: each needs `pivotStrength`
     bars either side, and they cannot overlap. Below this the honest answer is "not enough
     candles", which is a different thing from "no structure". */
  const minCandles = MIN_TRENDLINE_PIVOTS * (2 * pivotStrength + 1);
  if (candles.length < minCandles) return { structures: [], reason: 'not-enough-candles' };

  const { highs, lows } = findSwingPivots(candles, pivotStrength, pivotStrength);
  if (highs.length < MIN_TRENDLINE_PIVOTS && lows.length < MIN_TRENDLINE_PIVOTS) {
    return { structures: [], reason: 'not-enough-pivots' };
  }

  const lastIndex = candles.length - 1;
  const highRail = bestRail(candles, highs, 'high', tolerance, minR2, minExtraTouches);
  const lowRail = bestRail(candles, lows, 'low', tolerance, minR2, minExtraTouches);

  const structures: DetectedStructure[] = [];

  const build = (
    kind: StructureKind,
    rails: StructureRail[],
    considered: number,
  ): DetectedStructure => {
    const lastClose = candles[lastIndex].close;
    /* The NEAREST rail is the one price would cross first, so it is the one whose level the
       structure stops at. For a single trendline there is only one. */
    const nearest = rails.reduce((a, b) =>
      Math.abs(lineValueAt(a.fit, lastIndex) - lastClose) <=
      Math.abs(lineValueAt(b.fit, lastIndex) - lastClose) ? a : b);
    const firstTouches = rails
      .map(r => r.quality.firstTouchTimestamp)
      .filter((t): t is number => t !== null);
    const lastTouches = rails
      .map(r => r.quality.lastTouchTimestamp)
      .filter((t): t is number => t !== null);
    return {
      kind,
      timeframe,
      rails,
      candidatesConsidered: considered,
      invalidationPrice: lineValueAt(nearest.fit, lastIndex),
      ageBars: firstTouches.length ? barsSince(candles, Math.min(...firstTouches)) : 0,
      barsSinceLastTouch: lastTouches.length ? barsSince(candles, Math.max(...lastTouches)) : candles.length,
    };
  };

  /* A RANGE IS CHECKED BEFORE A CHANNEL, because a range IS a channel whose rails are both flat and
     calling it "a rising channel with a slope of nearly zero" would be true and useless. */
  if (highRail && lowRail) {
    const highSlopePct = slopePctPerBar(highRail.rail.fit, lastIndex);
    const lowSlopePct = slopePctPerBar(lowRail.rail.fit, lastIndex);
    const rails = [lowRail.rail, highRail.rail];
    const considered = highRail.considered + lowRail.considered;

    const bothFlat =
      highSlopePct !== null && lowSlopePct !== null &&
      Math.abs(highSlopePct) <= MAX_RANGE_SLOPE_PCT_PER_BAR &&
      Math.abs(lowSlopePct) <= MAX_RANGE_SLOPE_PCT_PER_BAR;

    if (bothFlat) {
      structures.push(build('range', rails, considered));
    } else {
      /* Parallel enough? Compared against the STEEPER rail so the test is scale-free; two rails
         sloping 1.0 and 1.2 are a channel, two sloping 0.1 and 0.3 are not. */
      const a = highRail.rail.fit.slope;
      const b = lowRail.rail.fit.slope;
      const steeper = Math.max(Math.abs(a), Math.abs(b));
      const parallel = steeper > 0 && Math.abs(a - b) / steeper <= MAX_CHANNEL_SLOPE_DIVERGENCE;
      if (parallel) structures.push(build('channel', rails, considered));
    }
  }

  /* Single trendlines are offered whether or not a channel was found: a channel's rails are
     individually useful, and the caller ranks. A rail already inside a channel is not repeated -
     it is the same object, so the caller can identify it by reference if it wants to. */
  /* A SINGLE RAIL IS A TRENDLINE ONLY IF THE SLOPED GATE ADMITTED IT. The declared kinds are
     trendline, channel and range - there is no "level" - so a lone horizontal rail is simply not
     an offerable structure in Phase 1, and calling it a trendline is the claim QA caught. A
     horizontal rail reaches the output only as half of a range. */
  if (!structures.length) {
    if (highRail?.rail.gate === 'sloped') {
      structures.push(build('trendline', [highRail.rail], highRail.considered));
    }
    if (lowRail?.rail.gate === 'sloped') {
      structures.push(build('trendline', [lowRail.rail], lowRail.considered));
    }
  }

  if (!structures.length) return { structures: [], reason: 'no-fit-cleared-thresholds' };

  /* Strongest evidence first: total touches, then the freshest. No score is computed and none is
     returned - ordering is a presentation choice, and a number would be rendered. */
  structures.sort((x, y) => {
    const tx = x.rails.reduce((s, r) => s + r.quality.touchCount, 0);
    const ty = y.rails.reduce((s, r) => s + r.quality.touchCount, 0);
    return ty - tx || x.barsSinceLastTouch - y.barsSinceLastTouch;
  });

  return { structures, reason: null };
}
