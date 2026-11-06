/* #1818 PHASE 1: THE GATE IS THE EXCESS TOUCH COUNT, NOT THE RAW ONE.
 *
 * Dev's first version of `chartStructureDetect.ts` failed its own null model — 15 of 20 random
 * walks produced a "structure" — and the cause is the reason this file exists:
 *
 *   `measureFit` counts touches across the WHOLE window, so the pivots a line was fitted through
 *   are touches BY CONSTRUCTION. A line fitted through 3 pivots therefore has touchCount >= 3
 *   before anything real has been measured. `touchCount >= 3` is satisfied by every line that
 *   exists, so the threshold was not a threshold.
 *
 * The fix is `touchCount - fit.pointCount >= minExtraTouches` (chartStructureDetect.ts:249). The
 * excess is the evidence; the raw count is arithmetic.
 *
 * WHY A SPEC AND NOT A COMMENT. Dev named this one himself: *"a cell asserting the raw count passes
 * against the broken version."* That is exactly right and it is the whole difficulty — the obvious
 * test here (assert a structure has >= 3 touches) is GREEN on the broken gate, green on the fixed
 * gate, and therefore worthless. P1 below is built the other way round: it is a series where the
 * raw count clears 3 and the excess is 0, so it passes ONLY on the fixed gate.
 *
 * MUTATION-PROVEN, not assumed: changing :249 back to `quality.touchCount < minExtraTouches` turns
 * P1 red. See the file footer for the exact edit and the observed result.
 *
 * Phase 0's own comment had already said what to require — *"it can exceed the number of pivots the
 * line was fitted through - and that excess is the evidence the line is real rather than an
 * artefact of three points"* — and was quoted in the broken version's header. The rule being
 * written down is not the same as the rule being enforced, which is the general case this file is
 * one instance of.
 *
 * NO NETWORK, NO FIXTURES, NOTHING BILLED: the detector is pure and the candles are built here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStructures,
  MAX_CANDIDATES_PER_SIDE,
  CANDIDATE_PIVOT_COUNTS,
  MIN_EXTRA_TOUCHES,
  MIN_TRENDLINE_PIVOTS,
} from '../lib/chartStructureDetect.ts';
import { findSwingPivots, lineValueAt } from '../lib/chartStructures.ts';
import type { StructureCandle } from '../lib/chartStructures.ts';

const TF = '4h';

/** A candle whose high and low are both pinned, so a pivot sits exactly where intended. */
function bar(i: number, high: number, low: number): StructureCandle {
  const mid = (high + low) / 2;
  return { timestamp: 1_700_000_000_000 + i * 14_400_000, open: mid, high, low, close: mid };
}

/**
 * A series with EXACTLY three swing highs on a straight line and nothing else near it.
 *
 * Every other bar is pushed far below the line, so it cannot be a touch at any sane tolerance.
 * The three pivots need `pivotStrength` clear bars either side, which is what the spacing is for.
 *
 * So: a line through 3 pivots, touchCount 3, pointCount 3, EXCESS 0.
 */
function threePivotsNoExcess(): StructureCandle[] {
  /* TWO PROPERTIES THIS FIXTURE HAS TO HAVE AT ONCE, and my first two attempts each missed one.
     Both failures looked like a passing test, which is why they are written down here.

     1. THE PIVOT PRICES MUST DIFFER, so the line has a slope. Three pivots at the SAME price make
        `fitLine` return `r2: null` ("could not discriminate"), and detectStructures rejects a null
        R2 at :245 - BEFORE the touch gate runs. My first fixture used 100/100/100, so the touch
        gate was never reached and the cell passed no matter what the gate said. Here: 100, 110,
        120, which fits r2 = 1 exactly and sails through the R2 guard.

     2. THE BASELINE MUST NOT PRODUCE PIVOTS OF ITS OWN. A run of EQUAL highs is detected as a
        pivot at every bar in the run, so a flat baseline gave 36 high pivots and the most recent
        three were all baseline - flat again, r2 null again. A strictly DESCENDING baseline has no
        local maximum anywhere, so the only pivots are the three spikes.

     Result: 3 pivots, r2 = 1, touchCount 3, pointCount 3, EXCESS 0. The band is 0.3% and the
     baseline runs 3+ away from the line at every index, so nothing else grazes it. */
  const n = 60;
  const out: StructureCandle[] = [];
  const peakAt = new Map<number, number>([[10, 100], [25, 110], [40, 120]]);
  for (let i = 0; i < n; i++) {
    const peak = peakAt.get(i);
    if (peak !== undefined) out.push(bar(i, peak, peak - 1));
    else out.push(bar(i, 90 - 0.5 * i, 89 - 0.5 * i));
  }
  return out;
}

/**
 * The POSITIVE CONTROL for P1: the same three pivots, plus many more bars whose highs sit ON the
 * rail without being pivots themselves. Raw count is large AND the excess is large, so this one
 * must be found on the fixed gate.
 *
 * Without this, P1 passes against a detector that returns nothing for any input at all.
 */
function threePivotsWithRealExcess(): StructureCandle[] {
  /* THE SLOPE HAS TO BE SHALLOW RELATIVE TO THE TOLERANCE BAND, and working out why is the
     interesting part of building this fixture.

     A pivot must be the strict maximum over `pivotStrength` bars either side, so it has to exceed
     the rail three bars LATER: pivotOffset > 3 * slope. A touch must be within the band: 0.3% of
     ~100, so ~0.3. Both can only hold at once when 3 * slope < 0.3, i.e. slope < 0.1 per bar.

     On a STEEP rail the two sets collapse into each other - every bar near the line is either a
     pivot or outside the band - and no fixture can have excess touches at all. That is a property
     of the geometry, not of this detector, and it is why my first two attempts at this control
     returned `no-fit-cleared-thresholds` rather than a structure. */
  const SLOPE = 0.02;
  const n = 60;
  const out: StructureCandle[] = [];
  for (let i = 0; i < n; i++) {
    const rail = 100 + SLOPE * i;
    /* Pivots away from the edges, so each has its clear bars either side. */
    const isPivot = i % 8 === 0 && i >= 6 && i <= n - 7;
    out.push(bar(i, isPivot ? rail + 0.10 : rail - 0.05, rail - 8));
  }
  return out;
}

/**
 * A textbook rising channel: highs on a shallow line, lows on a parallel one below it.
 *
 * THE LOW PIVOTS SIT AT VARYING DEPTHS, and my first version of this fixture had them all at an
 * identical offset - which made P6 useless. With every low pivot the same distance from the rail
 * there is no swing CLOUD to be in the middle of, so the mean of identical offsets IS the tangent:
 * the two constructions are not merely hard to separate, they are arithmetically the same function
 * on that input. The fixture was degenerate in exactly the dimension the behaviour lives in, and it
 * went green.
 *
 * Varying the depths did not make the test stricter, it made the test possible. Measured - tangent
 * leaves 0 of 9 opposite pivots beyond the rail, a least-squares intercept leaves 2 of 9.
 */
function risingChannel(): StructureCandle[] {
  const S = 0.01, WIDTH = 5, PROM = 0.10, n = 90;
  const DEPTH = [0, 0.25, 0.5, 0.25, 0, 0.4, 0.15, 0.5, 0.3, 0.1, 0.45, 0.2];
  let d = 0;
  const out: StructureCandle[] = [];
  for (let i = 0; i < n; i++) {
    const hi = 100 + S * i, lo = hi - WIDTH;
    /* Prominence must exceed 3x the slope or a later bar overtakes the pivot and findSwingPivots
       never sees it - the same geometry as threePivotsWithRealExcess. */
    const highPivot = i % 8 === 0 && i >= 5 && i <= n - 7;
    const lowPivot = i % 8 === 4 && i >= 5 && i <= n - 7;
    out.push(bar(
      i,
      highPivot ? hi : hi - PROM,
      lowPivot ? lo + DEPTH[(d++) % DEPTH.length] : lo + PROM + 0.6,
    ));
  }
  return out;
}

/**
 * Five recent high pivots on a shallow line, with the OLDEST of the five displaced outside the
 * tolerance band. So the nested 3-pivot window (the three newest) is clean, and the 4- and 5-pivot
 * windows carry the displacement.
 *
 * `displaceMult` is in units of the tolerance band at that pivot's price.
 */
function fivePivotsOneDisplaced(displaceMult: number): StructureCandle[] {
  const S = 0.01, PROM = 0.10, n = 90, SP = 8;
  const out: StructureCandle[] = [];
  for (let i = 0; i < n; i++) {
    const rail = 100 + S * i;
    const isPivot = i % SP === 0 && i >= 5 && i <= n - 7;
    out.push(bar(i, isPivot ? rail : rail - PROM, rail - 8));
  }
  const { highs } = findSwingPivots(out, 3, 3);
  const target = highs.slice(-5)[0].index;
  const band = 0.003 * (100 + S * target);
  out[target] = { ...out[target], high: out[target].high + displaceMult * band };
  return out;
}

test('P1. a line whose only touches are its own fitted pivots is NOT a structure', () => {
  const res = detectStructures(threePivotsNoExcess(), { timeframe: TF });

  assert.deepEqual(
    res.structures, [],
    'Three pivots on a straight line, with no other bar anywhere near it, is not a structure - it ' +
    'is three points and a ruler. If this returned something, the gate is counting the fitted ' +
    'pivots as evidence for the line they defined (chartStructureDetect.ts:249 reverted to the raw ' +
    'touchCount). That is the defect that put a "structure" on 15 of 20 random walks.',
  );
  assert.equal(
    res.reason, 'no-fit-cleared-thresholds',
    'the honest reason: there were enough candles and enough pivots, and nothing cleared the bar',
  );
});

test('P2. CONTROL: real touches beyond the fitted pivots ARE a structure', () => {
  /* If this fails, P1 proves nothing - a detector that finds nothing ever would satisfy it. */
  const res = detectStructures(threePivotsWithRealExcess(), { timeframe: TF });

  assert.ok(
    res.structures.length > 0,
    `a rail touched by many bars that are NOT its fitted pivots must be found. Got none, reason ` +
    `${res.reason}. P1 above is meaningless while this is red, because "no structure" would then ` +
    'be this detector\'s answer to everything.',
  );

  const s = res.structures[0];
  const totalTouches = s.rails.reduce((acc, r) => acc + r.quality.touchCount, 0);
  const totalPoints = s.rails.reduce((acc, r) => acc + r.fit.pointCount, 0);
  assert.ok(
    totalTouches - totalPoints >= MIN_EXTRA_TOUCHES,
    `the found structure must itself clear the excess bar: ${totalTouches} touches - ` +
    `${totalPoints} fitted points = ${totalTouches - totalPoints}, needs >= ${MIN_EXTRA_TOUCHES}`,
  );
});

test('P3. the search breadth is pinned, because best-of-N carries no information unless N is known', () => {
  /* Dev's note: an r2 of 0.99998 came out of searching 1000 subsets, and that number meant nothing
     without the 1000. The breadth is three nested candidates per side, by recency. Pinned here so
     widening it is a deliberate change with a spec to update rather than a quiet quality gain. */
  assert.equal(MAX_CANDIDATES_PER_SIDE, 3, 'three nested candidate windows per side');
  assert.deepEqual(
    [...CANDIDATE_PIVOT_COUNTS], [3, 4, 5],
    'the most recent 3, 4 and 5 pivots - nested, by recency, not by best fit',
  );
  assert.equal(MAX_CANDIDATES_PER_SIDE, CANDIDATE_PIVOT_COUNTS.length, 'the constant must track the list');
  assert.equal(MIN_TRENDLINE_PIVOTS, 3);

  const res = detectStructures(threePivotsWithRealExcess(), { timeframe: TF });
  for (const s of res.structures) {
    assert.ok(
      s.candidatesConsidered <= MAX_CANDIDATES_PER_SIDE,
      `a structure reported considering ${s.candidatesConsidered} candidates per side, above the ` +
      `pinned ${MAX_CANDIDATES_PER_SIDE}. The reported N is what makes the fit interpretable.`,
    );
  }
});

test('P4. nothing in the output can be read as advice', () => {
  /* The owner put this feature at the top of the queue to teach beginners to READ structure. A
     field a UI could render as an entry or a target is the one change that turns a chart annotation
     into trading advice, which PRODUCT.md rule 1 forbids. Asserted on the SHAPE rather than by
     reading the file, so a later field addition has to pass here. */
  const res = detectStructures(threePivotsWithRealExcess(), { timeframe: TF });
  assert.ok(res.structures.length > 0, 'needs a structure to inspect - see P2');

  const banned = /^(target|entry|stop|stopLoss|direction|bias|signal|recommendation|confidence|score|forecast|prediction)$/i;
  const walk = (o: unknown, path: string): void => {
    if (o === null || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      assert.ok(
        !banned.test(k),
        `${path}.${k} is a field a UI can render as advice. The detector describes geometry; it ` +
        'does not tell anyone what to do. Rename it or keep it out of the return type.',
      );
      walk(v, `${path}.${k}`);
    }
  };
  for (const s of res.structures) walk(s, 'structure');

  /* invalidationPrice is ALLOWED and is the one to watch: it is the structure's own line at the
     newest candle, not a stop loss, and its comment says so. Pinned as present-and-numeric so
     nobody "clarifies" it into a recommended exit. */
  const s = res.structures[0];
  assert.equal(
    typeof s.invalidationPrice, 'number',
    'invalidationPrice is the line\'s own value at the newest candle - geometry, not a stop',
  );
});

test('P5. a lone HORIZONTAL rail is not a trendline (#2022)', () => {
  /* THE DEFECT THIS PINS, found on live data and now deterministic. The flatness exemption at
     `isHorizontalCandidate` lets a rail skip the R² gate. Before `27ad38ab` a rail admitted that way
     could still be emitted as `kind: 'trendline'` — so the output claimed a SLOPED structure that had
     never been held to the sloped standard.

     Measured on BTCUSDT 15m at the time: a rail reported as a trendline with R² 0.339, admitted
     because its four fitted pivots spanned $228.00 against a $228.79 band — inside it by 79 cents.
     Two more in the same sweep: ADA 15m at R² 0.275, and a "range" at R² 0.050.

     THE FIXTURE BELOW REPRODUCES IT WITHOUT THE MARKET: a flat high rail with many touches, and lows
     that wander so no low rail forms and therefore no range can. The declared kinds are trendline,
     channel and range — there is no "level" — so a lone horizontal rail is not an offerable Phase 1
     structure at all. It reaches the output only as half of a range.

     MUTATION-PROVEN. Dropping the `gate === 'sloped'` condition emits exactly one structure:
     `kind: trendline, gate: horizontal, r2: 0.0975`. That is this cell going red, and it is the
     pre-fix behaviour. */
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const candles: StructureCandle[] = [];
  for (let i = 0; i < 80; i++) {
    /* A flat rail: pivots at one price, the rest a hair below, so the spread clears
       HORIZONTAL_SPREAD_FRACTION and the slope clears MAX_RANGE_SLOPE_PCT_PER_BAR. */
    const isPivot = i % 9 === 0 && i >= 5 && i <= 74;
    candles.push(bar(i, isPivot ? 100 : 99.98, 85 + rnd() * 8));
  }

  const res = detectStructures(candles, { timeframe: TF });

  for (const s of res.structures) {
    const horizontalRails = s.rails.filter(r => r.gate === 'horizontal');
    assert.ok(
      s.kind !== 'trendline' || horizontalRails.length === 0,
      `a ${s.kind} was emitted containing a rail admitted by the HORIZONTAL gate ` +
      `(R² ${s.rails.map(r => r.fit.r2).join(', ')}). A rail that skipped the R² gate cannot be ` +
      'reported as a trendline - that is the output claiming a standard it was never held to.',
    );
    if (horizontalRails.length > 0) {
      assert.equal(
        s.kind, 'range',
        'a horizontal rail reaches the output only as half of a range, never alone',
      );
      assert.equal(s.rails.length, 2, 'a range has two rails');
    }
  }

  assert.deepEqual(
    res.structures, [],
    'this fixture has ONE flat rail and unstructured lows, so no range can form and there is ' +
    'nothing offerable. If it returned a structure, the lone-horizontal guard is gone and the ' +
    'R² gate has an unguarded bypass.',
  );
});

test('P6. a channel\'s DERIVED rail is tangent - outside every opposite pivot, never through them (#2023)', () => {
  /* THE CELL DEV ASKED FOR BY NAME, because his first version passed "kind === 'channel'" while
     being wrong. He held the anchor's slope and took the LEAST-SQUARES intercept over the opposite
     pivots - which sounds principled and is a regression line through the MIDDLE of the opposite
     swing cloud. A channel rail is not there. It is tangent: offset so it sits just outside all of
     them, touching the most extreme one, which is how a trader draws it.

     HIS OWN SYMPTOM WAS A NEGATIVE EXCESS: SOL 1h came back with 39 pivots and FEWER touches than
     pivots, extra = -39. Nonsense on its face, and only legible because `pointCount` had just been
     changed to count the pivots actually ON the rail.

     SO THE ASSERTION CANNOT BE "A CHANNEL WAS FOUND". Both constructions find one. What separates
     them is WHERE the second rail sits, so that is what this checks:

       1. every opposite pivot is on the outside of the derived rail, or exactly on it
       2. the derived rail's own excess is >= 0 - a rail cannot be touched fewer times than the
          pivots it is drawn through

     The pivot set is derived here with `findSwingPivots` rather than read from `rail.pivots`,
     because the rail only carries the pivots ON it - which is precisely the set that would still
     look fine under a least-squares intercept. Checking a rail against its own survivors cannot
     see a rail in the wrong place. */
  const candles = risingChannel();
  const res = detectStructures(candles, { timeframe: TF });
  const channel = res.structures.find(s => s.kind === 'channel');
  assert.ok(channel, `a textbook rising channel must be detected as one. Got ${
    res.structures.map(s => s.kind).join(', ') || `nothing (${res.reason})`}`);

  const derived = channel.rails.find(r => r.gate === 'derived');
  assert.ok(derived, 'a channel has exactly one derived rail - the anchor copied across');
  assert.equal(derived.fit.r2, null,
    'a derived rail fitted no slope, so there is nothing for an R2 to describe. A number here ' +
    'would be a defensible-looking value for a line nobody fitted.');

  /* 2. A rail cannot be touched fewer times than the pivots it is drawn through. */
  /* `excessTouches` RATHER THAN A HAND-COMPUTED DIFFERENCE. I originally wrote
     `touchCount - fit.pointCount`, and flagged to Dev that it was checking a property the SLOPED
     rail did not have: `fit.pointCount` meant "pivots fitted" there and "pivots on the rail" on a
     derived rail, so the same subtraction asked different questions on the two rails of one
     channel. #2024 gave the rail its own field with one meaning on both paths. */
  assert.ok(derived.excessTouches >= 0,
    `the derived rail reports ${derived.quality.touchCount} touches against ${derived.pivotsOnRail} ` +
    `pivots on the rail, excessTouches ${derived.excessTouches}. A negative figure is the ` +
    'least-squares intercept: the rail runs through the middle of the opposite pivots rather than ' +
    'tangent to them.');

  /* 1. THE ONE THAT SEPARATES TANGENT FROM LEAST-SQUARES. */
  const { highs, lows } = findSwingPivots(candles, 3, 3);
  const opposite = derived.side === 'high' ? highs : lows;
  assert.ok(opposite.length >= 3, 'needs opposite pivots to be a meaningful check');

  const band = 0.003 * 100; // the default tolerance at this fixture's price
  const outside = [];
  for (const p of opposite) {
    const railPrice = lineValueAt(derived.fit, p.index);
    const beyond = derived.side === 'high' ? railPrice - p.price : p.price - railPrice;
    if (beyond < -band) outside.push({ index: p.index, pivot: p.price, rail: railPrice });
  }
  assert.deepEqual(
    outside, [],
    `${outside.length} of ${opposite.length} opposite pivots sit BEYOND the derived rail by more ` +
    `than the tolerance band - so the rail cuts through the swing cloud instead of containing it. ` +
    `Worst: ${JSON.stringify(outside[0])}. A channel that does not contain its own pivots is not a ` +
    'channel, and this is exactly what a least-squares intercept produces.',
  );
});

test('P7. every pivot a rail CARRIES sits on that rail - sloped included (#2024)', () => {
  /* THE CELL DEV ASKED TO PIN HARDEST, and it is not about arithmetic - `rail.pivots` is the set a
     UI marks on the chart. Before #2024 a SLOPED rail carried every pivot it was FITTED through,
     including ones nowhere near the resulting line, so a consumer marking those candles would have
     circled the wrong ones in front of the user. Dev found it only by changing the field, and says
     he would not have caught it until it was on screen.

     WHY R-SQUARED CANNOT STAND IN FOR THIS, measured on live data before the fix: ADAUSDT 1d scored
     r2 0.998441 - clearing the 0.99 gate - with 1 of its 3 fitted pivots on the line and the other
     two 0.72% and 0.54% away against a 0.3% band, so 2.4x and 1.8x outside it. R-squared is
     variance explained over the pivot SPREAD; a touch is an absolute band. A steep line over a wide
     range scores beautifully while passing near none of its own points.

     SO THE PROPERTY IS CHECKED DIRECTLY, on every rail of every structure, both gates. Run against
     the two fixtures that produce structures here - P2's trendline and P6's channel, the latter
     having opposite pivots at VARYING depths, so its tangent genuinely leaves some off the rail and
     they must not be carried. */
  const fixtures: Array<[string, StructureCandle[]]> = [
    ['single trendline', threePivotsWithRealExcess()],
    ['channel', risingChannel()],
  ];

  let railsChecked = 0;
  for (const [name, candles] of fixtures) {
    const res = detectStructures(candles, { timeframe: TF });
    assert.ok(res.structures.length > 0, `${name}: needs a structure to inspect (${res.reason})`);

    for (const s of res.structures) {
      for (const rail of s.rails) {
        railsChecked++;
        const band = (price: number) => 0.003 * price;
        const off = rail.pivots
          .map(p => ({ index: p.index, pivot: p.price, rail: lineValueAt(rail.fit, p.index) }))
          .filter(x => Math.abs(x.pivot - x.rail) > band(x.rail) + 1e-9);

        assert.deepEqual(
          off, [],
          `${name}: a ${rail.gate} rail CARRIES ${off.length} of ${rail.pivots.length} pivots that ` +
          `are NOT within tolerance of its own line. Worst: ${JSON.stringify(off[0])}. ` +
          'rail.pivots is what a chart marks for the user, so an off-rail pivot here is a circled ' +
          'candle the line does not touch. R-squared cannot establish this - see the header.',
        );

        /* And the count must agree with the set it describes. */
        assert.equal(
          rail.pivotsOnRail, rail.pivots.length,
          `${name}: a ${rail.gate} rail reports pivotsOnRail ${rail.pivotsOnRail} while carrying ` +
          `${rail.pivots.length} pivots. The count and the set must be the same thing.`,
        );
        assert.equal(
          rail.excessTouches, rail.quality.touchCount - rail.pivotsOnRail,
          'excessTouches must be touchCount minus pivotsOnRail, on both paths - one meaning per field',
        );
      }
    }
  }
  assert.ok(railsChecked >= 3, `expected at least 3 rails across both fixtures, checked ${railsChecked}`);

  /* WHAT THIS CELL DOES NOT COVER, stated because Dev asked for the sloped half specifically and it
     is NOT pinned here. Mutation-measured, both directions:

       derived rail carries all opposite pivots   -> P7 RED      (covered)
       sloped rail carries the FITTED window      -> P7 GREEN    (NOT covered)

     The sloped mutation survives because every fitted pivot in both fixtures is already on its
     rail, so `[...window]` and `onRail` are the same set and the two versions agree.

     AND PART OF THAT IS STRUCTURAL RATHER THAN A FIXTURE GAP. `MIN_PIVOTS_ON_RAIL` equals
     `MIN_TRENDLINE_PIVOTS`, both 3, so for a 3-pivot window all three must be on the rail to pass
     at all - window and onRail are identical BY CONSTRUCTION. The distinction can only exist for
     the 4- and 5-pivot windows, and those are reachable: a live sweep found sloped rails with 3, 4
     and 5+ pivots on rail.

     So a fixture that would pin the sloped half needs a 4- or 5-pivot window that clears R² >= 0.99
     and the excess gate while leaving at least one fitted pivot outside tolerance. I could not
     construct one: the displacement needed to put a pivot off the band also sinks R² at the shallow
     slopes the pivot-prominence geometry forces. That is a real gap, not a solved problem. */
});

/* ── WHY THERE IS NO P8, AND WHY THE SLOPED HALF OF P7 IS UNWRITABLE ────────────────────────────
 *
 * Dev measured 250 configurations and concluded the off-rail sloped state is UNREACHABLE. That
 * conclusion is CONFIRMED from this side. His stated MECHANISM is not.
 *
 * He attributed it to the RANKING: `bestRail` ranks by touch count then R-squared, so a clean nested
 * 3-window beats a dirty wider one, and the window carrying the off-rail pivot is never admitted. He
 * suggested pinning the ranking instead of the pivots, and I wrote that cell.
 *
 * **IT PASSED UNDER A RANKING MUTATION.** Rewriting `better` to prefer `fit.pointCount` over touch
 * count - the exact change he said would make the state reachable - left all eight cells green. So
 * the ranking is not what keeps it unreachable, and a cell asserting the ranking guards nothing.
 *
 * WHAT ACTUALLY REFUSES IT, measured per candidate window with the displaced pivot at 1.2x to 5x the
 * band:
 *
 *   shallow slopes (0.01/bar)   the 5-window is refused by R-SQUARED: 0.011, 0.102, 0.237, 0.351.
 *                               One displaced pivot dominates the variance when the line's own range
 *                               over the window is only a few bands wide.
 *   steeper slopes (0.03-0.09)  R-squared recovers to 0.99+, but then the FIT ABSORBS the
 *                               displacement - onRail comes back 5/5, so there is no off-rail pivot
 *                               to carry. A single outlier among five points rotates the line toward
 *                               itself.
 *
 * And the slope cannot go higher: pivot prominence must exceed 3x the slope for `findSwingPivots` to
 * see a pivot at all, while staying inside the touch band so the non-pivot bars still count as
 * touches. That squeezes the usable slope from both sides.
 *
 * SO THE TWO EXPLANATIONS ARE DIFFERENT AND THE DIFFERENCE MATTERS: under his, the state becomes
 * reachable if the ranking is ever changed, and a ranking cell would warn. Under this one, changing
 * the ranking does nothing - the dirty window is refused or absorbed before ranking is consulted -
 * so there is nothing a cell can usefully hold.
 *
 * A cell that passes under the mutation it was written to catch is documentation wearing an
 * assertion's clothes, which is the thing this whole file keeps catching. So there is no P8. The
 * sloped half of P7 rests on the implementation and the live audit, and this note is the record of
 * why that is the honest state rather than an oversight. */

/* ── MUTATION RESULT, AND THE TWO MUTATIONS THAT PROVED NOTHING ──────────────────────────────────
 *
 * THE ONE THAT WORKS - the original defect, raw count against MIN_TRENDLINE_PIVOTS:
 *
 *     -    if (quality.touchCount - fit.pointCount < minExtraTouches) continue;
 *     +    if (quality.touchCount < MIN_TRENDLINE_PIVOTS) continue;
 *
 *   Observed: P1 RED (4 tests, 3 pass, 1 fail). P2, P3, P4 green.
 *
 * P2 STAYING GREEN UNDER IT IS THE POINT, not a gap: it has 57 excess touches, so it clears both
 * gates. Only a negative cell can separate them, which is why P1 is written as one.
 *
 * MUTATION 1, WHICH LEFT EVERYTHING GREEN: `touchCount < minExtraTouches`, keeping the threshold at
 * 5. Not the original bug - the original gated on 3. P1's fixture has touchCount 3, which fails
 * `< 5` either way, so the mutated and unmutated code agree and the cell says nothing.
 *
 * MUTATION 2, ALSO ALL GREEN, and this one was a defect in the FIXTURE rather than the mutation:
 * the first version of `threePivotsNoExcess` put all three pivots at the SAME price. `fitLine`
 * returns `r2: null` for that, and :245 rejects a null R2 before the touch gate is reached. The
 * cell was passing because the structure was refused for an unrelated reason - the exact shape of
 * failure this whole file exists to catch, reproduced inside the file written to catch it.
 *
 * So: a green mutation run means the mutation was wrong, the fixture was wrong, or the cell is
 * worthless, and the three are not distinguishable from the green. Each one has to be chased. */
