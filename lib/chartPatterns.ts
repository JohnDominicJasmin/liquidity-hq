/* Chart patterns, Phase 2 (#1818) - naming the shapes a retail trader already believes in, from
 * geometry Phase 1 measured. Deterministic, no AI call, no network, no UI.
 *
 * The owner's ask, in his words: retail traders believe in these shapes - parallel channel, bull
 * flag, bear flag - and he wants the lines generated on the chart. This file is the naming step:
 * Phase 1 says "two rails, these slopes, this many touches", and this says "that is a bull flag".
 *
 * ── WHY CLASSIFICATION IS SEPARATE FROM DETECTION ───────────────────────────────────────────────
 *
 * `lib/chartStructureDetect.ts` answers "is there a structure here" and must not know what a flag
 * is. Three of this feature's four defects were a gate measuring the wrong thing for a shape, and
 * every one was found by someone else. Keeping the geometry ignorant of the vocabulary means a
 * wrong NAME cannot change a measured LINE - the worst this file can do is mislabel a structure
 * that is really there, which the user sees and can disagree with.
 *
 * ── TIMEFRAMES ARE DATA, NOT A HARDCODED SET ────────────────────────────────────────────────────
 *
 * `PATTERN_TIMEFRAMES` is 15m, 1h and 4h today and that is a MEASURED scope, not a preference.
 * Measured 2026-11-07 across 8 coins: 1d and 1w produce ZERO structures of any kind, and
 * `lib/chartStructureDetect.ts`'s header carries the sweep showing no tolerance/R-squared/excess
 * combination fixes that without at least doubling the false-positive rate. So the slow rungs are
 * out because they are EMPTY, not because daily shows "different patterns" - there is nothing on
 * them to name.
 *
 * The list is exported and the detector takes it as an argument, so if the owner accepts the noise
 * tradeoff the rungs extend with no change here.
 *
 * ── WHAT THIS FILE WILL NOT SAY ─────────────────────────────────────────────────────────────────
 *
 * No outcome, no target, no direction to trade, and no probability. A `PatternType` is a NOUN. The
 * copy that explains each one lives in labels under `PATTERN_<TYPE>_*`, where QA can assert on it,
 * and the rule there is that `_WATCH` describes TRADER BEHAVIOUR and never price behaviour:
 *
 *     OK   "traders watch whether price breaks the upper line of the drift"
 *     NOT  "bull flags usually resolve upward"
 *
 * The second is a probability claim with no evidence behind it. **The owner's phrase was "expected
 * action" and it is deliberately not implemented**: an expected action is a recommendation however
 * it is worded, and PRODUCT.md rule 1 rules it out. Flagged to him rather than quietly substituted.
 *
 * ── TWO NULL MODELS, AND THEY DISAGREE. NO RELIABILITY CLAIM SURVIVES THEM ──────────────────────
 *
 * The one thing BOTH models agree on, and the only thing stated here as a property of this code:
 *
 *     named == found, exactly, in every run at every volatility.
 *
 * `detectPatterns` names what `detectStructures` already found and invents nothing. That holds
 * because it is an EQUALITY, not a rate - and an equality between two counts of the same walks
 * cannot be an artefact of how the walks were made.
 *
 * EVERY RATE BELOW IS A PROPERTY OF ITS GENERATOR, and the two generators disagree flatly:
 *
 *   Dev, additive step: `p += (rnd() - 0.5) * 4` from p = 100, 160 bars, 300 walks
 *     - that is a FIXED +-2 on a price of 100, so ~2% per bar and not scale-free
 *     structures 16/300 (5.3%)   1-rail 16   2-rail 0
 *
 *   QA, geometric: 300 bars, 300 walks, two volatilities
 *     vol 0.5%/bar   structures 88/300 (29.3%)   1-rail 39   2-rail 53
 *                    channel_falling 23, channel_rising 23, range 4, bear_flag 2, bull_flag 1
 *     vol 1.0%/bar   structures 58/300 (19.3%)   1-rail 52   2-rail  9
 *
 * I CONCLUDED FROM THE FIRST THAT "A CHANNEL IS ~0% FALSE-POSITIVE WHILE A TREND LINE CARRIES
 * 5.3%", AND PROPOSED IT AS A PRODUCT FACT. Under QA's model two-rail is the COMMONEST false
 * positive - 46 channels in 300 walks - the exact inverse. The code is not in dispute; we ran the
 * same functions. My walk is roughly four times noisier per bar, which leaves less that fits a
 * straight line, so it under-produces exactly the shapes a quieter walk over-produces.
 *
 * SO NOTHING HERE RANKS THE SHAPES BY RELIABILITY, and the teaching copy must not either. Telling a
 * beginner that channels are trustworthy and trend lines less so would be teaching an artefact of
 * one generator as a fact about markets.
 *
 * A DEFENSIBLE VERSION WOULD NEED A NOISE MODEL WE DID NOT INVENT - shuffled REAL returns per
 * symbol, so the volatility and tick structure are the market's rather than ours. That is its own
 * piece of work. Until it exists, the honest answer to "which shape is more reliable" is that we
 * have not measured it.
 */
import {
  detectStructures,
  type DetectOptions,
  type DetectedStructure,
  type NoStructureReason,
  type StructureRail,
} from './chartStructureDetect.ts';
import { lineValueAt, type StructureCandle } from './chartStructures.ts';

/** The rungs that produce structures. MEASURED - see the header. */
export const PATTERN_TIMEFRAMES: readonly string[] = ['15m', '1h', '4h'];

/** Shapes this file can NAME, measured rather than intended - see `UNDETECTABLE_PATTERN_TYPES`
 *  below for the five that were here and why they left. */
export const PATTERN_TYPES = [
  'bull_flag', 'bear_flag',
  'channel_rising', 'channel_falling',
  'range',
  /* THE OWNER NAMED THIS ONE AND THE FIRST VERSION DROPPED IT. His ask was "either a parallel line
     channel or **this descending action line**", and a single rail was returning null here because
     it is not a two-rail shape. It is still one of the three things he actually asked for, and on
     live data it is by far the most common - 24 cells produced one nameable two-rail structure and
     several lone rails. Side rather than direction, because a line under price and a line over it
     are different objects to a beginner; the slope goes in the copy. */
  'line_support', 'line_resistance',
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

/**
 * Shapes the proposal names that this detector CANNOT currently produce. Declared rather than
 * silently absent, because a vocabulary that lists what it cannot find is how a teaching panel ends
 * up rendering nothing for a shape it just drew.
 *
 * PROVEN, NOT SAMPLED - and the stronger argument is QA's, not mine. I measured it: 1,200 generated
 * shapes produced 171 two-rail structures, all 171 with identical rail slopes and a single distinct
 * `gapEnd / gapStart` ratio of exactly 1.0000. QA then read the source and showed it holds for ALL
 * inputs rather than for 1,200 of them, because two-rail structures come from exactly two call
 * sites and both are closed. Recorded in that order because a sample would have been the weaker
 * claim had anyone later needed to lean on it.
 *
 * TWO PATHS, AND THEY ARE PARALLEL FOR TWO DIFFERENT REASONS. This distinction is QA's and it is
 * the part worth carrying forward, because only one of the two reasons is structural:
 *
 *   `chartStructureDetect.ts:686` - THE CHANNEL. `[anchor.rail, derived]`, and `deriveParallelRail`
 *   copies `slope: anchor.slope` verbatim. One slope m for both rails, so the gap is
 *   (m*i + b_high) - (m*i + b_low) = b_high - b_low at EVERY index. The ratio is exactly 1 for all
 *   inputs. Parallel BY CONSTRUCTION, and my own doing in #2023.
 *
 *   `chartStructureDetect.ts:653` - THE RANGE. Two INDEPENDENTLY admitted rails, so this is the one
 *   path whose geometry could produce non-parallel rails. It cannot today only because it is gated
 *   on `highRail.gate === 'horizontal' && lowRail.gate === 'horizontal'`, and two flat rails are
 *   parallel. Parallel BY GATE, not by construction.
 *
 * SO THE RANGE GATE IS LOAD-BEARING FOR THIS EXCLUSION, which nothing about reading it suggests.
 * Relaxing it to admit sloped rails would start producing non-parallel rails and make the
 * convergence branch reachable again - a second trigger, independent of the independent-rails fork
 * described below.
 *
 * SO THE CONVERGENCE BRANCH IS GONE TOO, not left in place against a future need. Keeping an
 * unreachable branch that reads as functional is the exact defect QA found in `lib/patterns.ts`
 * this week - `cr >= pr * 0.8`, arithmetically impossible to fail, which read as a tunable
 * threshold and sent the next reader looking elsewhere. Doing the same thing here knowingly, having
 * just removed that one, would be indefensible.
 *
 * WHERE THE ASSERTION LIVES: `__tests__/`, QA's. A `scripts/` prober shipped with this change
 * first and was removed on QA's reasoning, which is better than mine was: `npm test` does not run
 * anything in `scripts/`, so for a premise that stays true for months and then silently stops,
 * "nobody ran it" and "it passed" are indistinguishable. A cell runs on every gate.
 *
 * WHAT IT WOULD TAKE TO BRING THEM BACK: two INDEPENDENTLY fitted rails, which #2023 removed
 * because the joint probability of both clearing R-squared and the excess-touch gate produced ZERO
 * channels across 40 live cells. That is a real fork with its own gates to measure, not a threshold
 * to nudge - and it is what #1818's Phase 2 checkbox is actually asking for.
 */
export const UNDETECTABLE_PATTERN_TYPES = [
  'wedge_rising', 'wedge_falling',
  'triangle_asc', 'triangle_desc', 'triangle_sym',
] as const;

/* ── Thresholds ───────────────────────────────────────────────────────────── */

/** A rail counts as FLAT below this slope, as a fraction of its own price per bar - the same
 *  scale-free form `MAX_RANGE_SLOPE_PCT_PER_BAR` uses, for the reason recorded there: a percentage
 *  of price is the only flatness test that means the same thing on BTC and on a sub-cent coin. */
export const FLAT_SLOPE_PCT_PER_BAR = 0.0002;

/** Two rails CONVERGE when the gap at the structure's end is this much smaller than at its start.
 *  0.7 means the far end is at most 70% of the near end - a visible narrowing, not a rounding. */
export const CONVERGENCE_RATIO = 0.7;

/** ...and DIVERGE when the gap grows by the reciprocal. Between the two a structure is parallel
 *  enough to be a channel. Stated as its own constant rather than `1 / CONVERGENCE_RATIO` so a
 *  reader does not have to work out that the band is symmetric. */
export const DIVERGENCE_RATIO = 1 / CONVERGENCE_RATIO;

/** A FLAG needs a pole: a move before the structure begins. These are the window lengths searched,
 *  and the strongest move among them wins.
 *
 *  SEARCHED RATHER THAN FIXED, because a single lookback measures the wrong thing whenever the
 *  impulse is not that long. At a fixed 20 bars, a 40-bar pole is read from its own midpoint to its
 *  top and comes out at half its size - which is how the first version of this file classified a
 *  textbook bull flag as `channel_falling`. Four lengths, reported, so the choice is visible rather
 *  than assumed; see `candidatesConsidered` on the detector for the same habit. */
export const POLE_WINDOWS: readonly number[] = [10, 20, 30, 45];

/** ...of at least this fraction of price. Below it there is no impulse and a tilted channel is
 *  just a tilted channel. */
export const POLE_MIN_PCT = 0.03;

/** A flag is a PAUSE, so it must be short relative to its pole. A "flag" lasting four times the
 *  move that made it is a trend, and calling it a flag would be the kind of confident mislabel
 *  this file's header says is the only harm it can do. */
export const FLAG_MAX_BARS_PER_POLE_BAR = 2.5;

/* ── Output ───────────────────────────────────────────────────────────────── */

export interface DetectedPattern {
  type: PatternType;
  timeframe: string;
  /** The measured geometry this name was applied to. Carried whole so a caller draws the same
   *  rails Phase 1 produced rather than anything this file invents. */
  structure: DetectedStructure;
  /** Gap between the rails at the structure's start and end, in price. Null for a one-rail
   *  structure, which cannot be a pattern and is not returned. */
  gapStart: number;
  gapEnd: number;
  /** The impulse before a flag: its size as a fraction of price, and its length in bars. Null on
   *  every non-flag, so a consumer cannot read a pole where none was measured. */
  pole: { pct: number; bars: number } | null;
}

export interface PatternResult {
  patterns: DetectedPattern[];
  /** Set only when `patterns` is empty, and it is the DETECTOR's reason when there was no
   *  structure to classify - so "no structure" and "a structure I could not name" stay different
   *  answers. `'unclassified'` is the second one. */
  reason: NoStructureReason | 'unclassified' | null;
}

/* ── Classification ───────────────────────────────────────────────────────── */

function slopePct(rail: StructureRail, lastIndex: number): number | null {
  const v = lineValueAt(rail.fit, lastIndex);
  if (!Number.isFinite(v) || v <= 0) return null;
  return rail.fit.slope / v;
}

/** The impulse immediately before a structure starts: signed fractional move and its bar count.
 *
 *  MEASURED FROM THE CANDLES, NOT FROM THE RAILS. A flag's pole is price action before the shape
 *  exists, so no rail describes it - reading one would be measuring the flag and calling it the
 *  pole. Null when there is not enough history before the structure to look at. */
function poleBefore(
  candles: readonly StructureCandle[],
  startIndex: number,
): { pct: number; bars: number } | null {
  let best: { pct: number; bars: number } | null = null;
  for (const bars of POLE_WINDOWS) {
    const from = startIndex - bars;
    if (from < 0) continue;
    const a = candles[from]?.close;
    const b = candles[startIndex]?.close;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
    const pct = (b - a) / a;
    if (best === null || Math.abs(pct) > Math.abs(best.pct)) best = { pct, bars };
  }
  return best;
}

/**
 * The name for one measured structure, or null when none of them fits.
 *
 * NULL IS A REAL ANSWER AND IS NOT SMOOTHED INTO THE NEAREST SHAPE. A structure whose rails
 * neither converge, diverge nor sit flat, with no impulse behind it, is a structure this
 * vocabulary does not have a word for - and inventing one is exactly how "the AI drew a bull flag"
 * becomes something a user can show to be wrong.
 */
export function classify(
  structure: DetectedStructure,
  candles: readonly StructureCandle[],
): { type: PatternType; gapStart: number; gapEnd: number; pole: DetectedPattern['pole'] } | null {
  const lastIndex = candles.length - 1;
  if (lastIndex < 1) return null;

  /* ONE RAIL IS A LINE, AND A LINE IS A SHAPE HE ASKED FOR. Named by which side of price it sits
     on; the gap fields collapse to the rail's own value because there is no second rail to measure
     against, and `pole` is null because a line carries no impulse claim. */
  if (structure.rails.length === 1) {
    const only = structure.rails[0];
    const at = lineValueAt(only.fit, lastIndex);
    if (!Number.isFinite(at)) return null;
    return {
      type: only.side === 'high' ? 'line_resistance' : 'line_support',
      gapStart: 0,
      gapEnd: 0,
      pole: null,
    };
  }
  if (structure.rails.length < 2) return null;

  const [low, high] = structure.rails[0].side === 'low'
    ? [structure.rails[0], structure.rails[1]]
    : [structure.rails[1], structure.rails[0]];

  /* The structure's own span, not the whole window: a pattern is where the rails are, and the gap
     has to be read at its ends. */
  const startIndex = Math.min(
    ...structure.rails.flatMap(r => r.pivots.map(p => p.index)),
  );
  if (!Number.isFinite(startIndex)) return null;

  const gapStart = lineValueAt(high.fit, startIndex) - lineValueAt(low.fit, startIndex);
  const gapEnd = lineValueAt(high.fit, lastIndex) - lineValueAt(low.fit, lastIndex);
  if (!Number.isFinite(gapStart) || !Number.isFinite(gapEnd) || gapStart <= 0) return null;

  const ratio = gapEnd / gapStart;
  const hs = slopePct(high, lastIndex);
  const ls = slopePct(low, lastIndex);
  if (hs === null || ls === null) return null;

  const highFlat = Math.abs(hs) <= FLAT_SLOPE_PCT_PER_BAR;
  const lowFlat = Math.abs(ls) <= FLAT_SLOPE_PCT_PER_BAR;
  const base = { gapStart, gapEnd };

  /* RANGE FIRST, for the reason the detector gives: a range is a channel whose rails are both
     flat, and "a rising channel with a slope of nearly zero" is true and useless. */
  if (highFlat && lowFlat) return { type: 'range', ...base, pole: null };

  /* CONVERGING AND DIVERGING BOTH RETURN NULL, and the convergence branch that used to sit here
     has been removed rather than left unreachable - see UNDETECTABLE_PATTERN_TYPES. Measured: every
     two-rail structure this detector produces has parallel rails, so `ratio` is always exactly 1
     and neither bound can be crossed. The comparisons stay because they are the honest guard: if a
     future detection path ever produces non-parallel rails, this returns null rather than calling a
     wedge a channel. */
  if (ratio <= CONVERGENCE_RATIO || ratio >= DIVERGENCE_RATIO) return null;

  /* PARALLEL ENOUGH - a channel, and possibly a flag. A FLAG IS A CHANNEL PLUS A CONTEXT: the
     channel drifts AGAINST a strong recent move and is short relative to it. Checked before the
     plain channel so the more specific name wins. */
  const pole = poleBefore(candles, startIndex);
  const flagBars = lastIndex - startIndex;
  const shortEnough = pole !== null && flagBars <= pole.bars * FLAG_MAX_BARS_PER_POLE_BAR;
  const drift = (hs + ls) / 2;

  if (pole !== null && shortEnough && Math.abs(pole.pct) >= POLE_MIN_PCT) {
    /* Against the pole, or flat. A channel drifting WITH a strong move is a trend continuing, not
       a pause in it, and naming that a flag would be the mislabel. */
    if (pole.pct > 0 && drift <= FLAT_SLOPE_PCT_PER_BAR) {
      return { type: 'bull_flag', ...base, pole };
    }
    if (pole.pct < 0 && drift >= -FLAT_SLOPE_PCT_PER_BAR) {
      return { type: 'bear_flag', ...base, pole };
    }
  }

  return { type: drift > 0 ? 'channel_rising' : 'channel_falling', ...base, pole: null };
}

/**
 * Patterns in one candle window, strongest evidence first.
 *
 * ONE ARRAY, ONE INDEX ORIGIN - the hazard `measureFit`'s header warns about. Everything here
 * indexes against the array passed in, and the structures come from `detectStructures` on that
 * same array.
 *
 * Returns the detector's own reason when there was nothing to classify, and `'unclassified'` when
 * there were structures but no name fitted. A caller can then say "no clean structure right now"
 * or "a shape with no name for it", which are different things to tell a user.
 */
export function detectPatterns(
  candles: readonly StructureCandle[],
  options: DetectOptions,
): PatternResult {
  const found = detectStructures(candles, options);
  if (!found.structures.length) return { patterns: [], reason: found.reason };

  const patterns: DetectedPattern[] = [];
  for (const structure of found.structures) {
    const named = classify(structure, candles);
    if (!named) continue;
    patterns.push({
      type: named.type,
      timeframe: structure.timeframe,
      structure,
      gapStart: named.gapStart,
      gapEnd: named.gapEnd,
      pole: named.pole,
    });
  }

  if (!patterns.length) return { patterns: [], reason: 'unclassified' };

  /* Total touches, then freshest. Same ordering the detector uses, and for the same reason: no
     score is computed and none is returned, because a number would get rendered. */
  patterns.sort((a, b) => {
    const t = (p: DetectedPattern) => p.structure.rails.reduce((n, r) => n + r.quality.touchCount, 0);
    return t(b) - t(a) || a.structure.barsSinceLastTouch - b.structure.barsSinceLastTouch;
  });

  return { patterns, reason: null };
}
