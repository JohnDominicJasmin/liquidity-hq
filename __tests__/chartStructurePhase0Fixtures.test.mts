/* #1818 PHASE 0 — THE FIXTURES' OWN CONTROL SUITE.
 *
 * WHAT THIS DOES AND DOES NOT COVER, first, because the distinction is the whole reason it exists.
 * It does NOT test `lib/chartStructures.ts`. That file does not exist yet — Dev is writing it — and
 * this suite deliberately lands first.
 *
 * What it tests is `_chartStructureFixtures.mts`: that the expected values in it are the values the
 * DEFINITIONS produce. The definitions are the repo's fractal-pivot convention and the textbook
 * least-squares closed form, and the recomputation below is written from them, not from any
 * implementation of them. Fixtures whose expectations came out of the module under test are a
 * failure this project has already paid for once; writing them before the module exists is the only
 * airtight version of not doing that.
 *
 * THE SECOND SUITE IS THE ONE THAT GATES PHASE 0 — `lib/chartStructures.ts` driven by these
 * fixtures — and it is a separate file, added when the API exists. Proving a predicate with
 * fixtures is not proving the implementation satisfies it. Both, every time.
 *
 * WHY A FIXTURE NEEDS A CONTROL AT ALL. Two defects were already caught here by running this rather
 * than reading it:
 *
 *   1. F3, the NEGATIVE fixture, lost its first pivot to a too-shallow flank ramp, and the three
 *      survivors fitted a trendline at R² 0.987. The "no clean structure" fixture would have
 *      asserted that a clean structure was present.
 *   2. The expected R² for F2 is exactly 0.9 on two of the three standard formulas and one ulp
 *      higher on the third. An exact-equality assertion would have failed a correct implementation
 *      for choosing a legitimate formula.
 *
 * Neither looked wrong on the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, byId, INTERVAL_MS, type Fixture, type FixtureCandle } from './_chartStructureFixtures.mts';
import { findPivots } from '../lib/priceAction.ts';

/* ══ THE DEFINITIONS, RE-EXPRESSED ══════════════════════════════════════════════════════════════
 *
 * Written from `lib/priceAction.ts:62`, `components/KLineProChart.tsx:520` and
 * `lib/divergence.ts:24`, which all three agree: a bar is a pivot when NO bar within `strength`
 * either side is strictly beyond it. An equal neighbour does not disqualify it, and the outermost
 * `strength` bars on each end can never hold one — the bars to a pivot's right are what confirm it.
 */
function referencePivots(
  bars: readonly FixtureCandle[],
  strength = 3,
  strict = false,
): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = strength; i < bars.length - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (strict ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) isHigh = false;
      if (strict ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/** Least squares, closed form, over centred sums. `r2*` are the three formulas in common use. */
function referenceFit(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = xs.map((x, i) => ys[i] - (slope * x + intercept));
  const ssres = residuals.reduce((a, r) => a + r * r, 0);
  return {
    slope,
    intercept,
    sxx,
    sxy,
    syy,
    ssres,
    residuals,
    r2Product: (sxy * sxy) / (sxx * syy),
    r2Residual: 1 - ssres / syy,
    r2Sqrt: (sxy / Math.sqrt(sxx * syy)) ** 2,
  };
}

const lowsOf = (f: Fixture) => f.pivotLowIndices.map((i) => f.candles[i].low);

/**
 * Pivot lows read from the CANDLES, never from the declared literals.
 *
 * EVERY CELL BELOW BUT C1 USES THIS, and a mutation run is why. An earlier version of C7 fitted
 * `pivotLowPrices` — the literal — so when the mutation control made F3's actual candles collinear
 * and left the literal alone, C7 PASSED while asserting that a cleanly-fitting series had no clean
 * structure. C1 caught the mutation, so the suite was still red; but the negative cell was reading
 * its own expectation and would have gone on passing if C1 were ever narrowed. A control that reads
 * the answer it is checking is not a control.
 */
function fromCandles(f: Fixture): { idx: number[]; prices: number[] } {
  const idx = referencePivots(f.candles).lows;
  return { idx, prices: idx.map((i) => f.candles[i].low) };
}

/* ══ CONTROLS ON THE FIXTURES ══════════════════════════════════════════════════════════════════ */

test('C1. CONTROL: the construction forces every declared pivot set', () => {
  for (const f of FIXTURES) {
    const got = referencePivots(f.candles);
    assert.deepEqual(
      got.lows, f.pivotLowIndices,
      `${f.id} (${f.title}): the series does not actually produce the pivot lows it declares. ` +
      `Declared [${f.pivotLowIndices.join(' ')}], the convention gives [${got.lows.join(' ')}]. ` +
      'This is a FIXTURE defect, not an implementation one: fix the series or the literal. F3 failed ' +
      'exactly here once, with a flank ramp shallow enough that a distant pivot stole the first one.',
    );
    assert.deepEqual(
      got.highs, f.pivotHighIndices,
      `${f.id}: declared pivot highs [${f.pivotHighIndices.join(' ')}] but got ` +
      `[${got.highs.join(' ')}]. The high side is a by-product of the ramp rather than designed, so ` +
      'a change here means the construction moved, and every low-side expectation needs re-checking too.',
    );
    assert.deepEqual(
      f.pivotLowPrices, lowsOf(f),
      `${f.id}: the declared pivot PRICES do not match the lows at the declared indices.`,
    );
  }
});

test('C2. CONTROL: that detector must be shown to FIRE, or C1 proves nothing', () => {
  /* A reference pass that ignored `strength`, or that returned its input unchanged, would satisfy
     C1 for every fixture. These two are the planted differences that prove it is live. */
  const f2 = byId('F2');
  assert.deepEqual(
    referencePivots(f2.candles, 4).lows, f2.pivotLowsAtStrength[4],
    'F2 at strength 4 must drop two of its four pivot lows. If it returns the strength-3 set, the ' +
    '`strength` argument is not being read and C1 is measuring nothing.',
  );
  assert.notDeepEqual(
    referencePivots(f2.candles, 4).lows, referencePivots(f2.candles, 3).lows,
    'strength 3 and strength 4 must disagree on F2 - that disagreement is the control',
  );

  const f4 = byId('F4');
  assert.deepEqual(
    referencePivots(f4.candles, 3, true).lows, f4.strictVariantPivotLows,
    'F4 under a STRICT comparison must report NO pivot lows, where the non-strict convention reports ' +
    'two. A flat double bottom is the shape where the two rules differ, and a rewrite that adds a ' +
    'configurable strength is the most likely place for a silent switch to strict.',
  );
  assert.equal(f4.strictVariantPivotLows.length, 0, 'F4 strict must be empty - that is the discriminator');
  assert.equal(referencePivots(f4.candles, 3).lows.length, 2, 'and non-strict must find both');

  /* Every fixture's strength table must be internally honest, not just F2's. */
  for (const f of FIXTURES) {
    for (const [s, expected] of Object.entries(f.pivotLowsAtStrength)) {
      assert.deepEqual(
        referencePivots(f.candles, Number(s)).lows, expected,
        `${f.id} at strength ${s}: declared [${expected.join(' ')}]`,
      );
    }
  }
});

test('C3. the fixtures agree with the pivot detector this repo ALREADY has', () => {
  /* `lib/priceAction.ts` findPivots is strength 3, non-strict, and its header says a third
     convention would mean the chart's S/R lines and these signals disagreeing about where the
     swings are - "which is worse than either choice". `components/KLineProChart.tsx:520` and
     `lib/divergence.ts:24` are the other two, and all three match.
     Phase 0 adds a FOURTH detector with a configurable strength. Binding the fixtures to the
     existing one is what makes a divergence fail here instead of showing up as a structure line
     drawn through a swing the S/R lines on the same chart do not believe in. */
  for (const f of FIXTURES) {
    const { highs, lows } = findPivots(f.candles);
    assert.deepEqual(
      lows.map((p) => p.index), f.pivotLowIndices,
      `${f.id}: lib/priceAction.ts findPivots disagrees with this fixture's pivot lows. Either the ` +
      'fixture is wrong, or that detector changed - and if it changed, the chart S/R lines, the RSI ' +
      'divergences and the BOS/CHoCH signals all moved with it.',
    );
    assert.deepEqual(highs.map((p) => p.index), f.pivotHighIndices, `${f.id}: findPivots pivot highs`);
    assert.deepEqual(lows.map((p) => p.price), f.pivotLowPrices, `${f.id}: findPivots pivot prices`);
  }
});

test('C4. the declared fit is the one the closed form produces', () => {
  for (const f of FIXTURES) {
    if (!f.fit) continue;
    const src = fromCandles(f);
    const fit = referenceFit(src.idx, src.prices);
    const exact = f.fit.r2ExactOnEveryFormula;
    const near = (got: number, want: number, what: string) => {
      if (exact) assert.equal(got, want, `${f.id} ${what}: expected exactly ${want}, got ${got}`);
      else assert.ok(Math.abs(got - want) <= 1e-12, `${f.id} ${what}: expected ${want}, got ${got}`);
    };

    /* The centred sums are integers in every fixture, so these are exact regardless. A mismatch
       localises the defect to one sum instead of to "the fit". */
    assert.equal(fit.sxx, f.fit.sxx, `${f.id} Sxx`);
    assert.equal(fit.sxy, f.fit.sxy, `${f.id} Sxy`);
    assert.equal(fit.syy, f.fit.syy, `${f.id} Syy`);
    assert.equal(fit.ssres, f.fit.ssres, `${f.id} SSres`);

    near(fit.slope, f.fit.slopePerBar, 'slope per bar');
    near(fit.intercept, f.fit.intercept, 'intercept');
    near(fit.r2Product, f.fit.r2, 'R²');

    assert.deepEqual(fit.residuals, f.fit.residualsAtPivots, `${f.id}: residuals at the pivots`);
    assert.equal(
      fit.residuals.filter((r) => r === 0).length, f.fit.touchesAtZeroTolerance,
      `${f.id}: touches at tolerance 0`,
    );

    /* The line's VALUE at a point, which is what a drawn line actually is, and the only form of the
       slope that does not depend on the x unit. */
    src.idx.forEach((i, k) => near(fit.slope * i + fit.intercept, f.fit!.lineAtPivots[k], `line at index ${i}`));
    const last = f.candles.length - 1;
    near(fit.slope * last + fit.intercept, f.fit.lineAtLastBar, `line at the last bar (${last})`);
    near(f.candles[last].close - (fit.slope * last + fit.intercept), f.fit.lastCloseMinusLine,
      'last close minus the line under it');

    assert.equal(f.candles[src.idx[0]].timestamp, f.fit.firstTouchTs, `${f.id} first touch timestamp`);
    assert.equal(
      f.candles[src.idx[src.idx.length - 1]].timestamp, f.fit.lastTouchTs,
      `${f.id} last touch timestamp`,
    );
  }
});

test('C5. F1 is exact on all three R² formulas; F2 and F3 are not, and that is recorded', () => {
  const s1 = fromCandles(byId('F1'));
  const f1 = referenceFit(s1.idx, s1.prices);
  assert.equal(f1.r2Product, 1, 'F1 R² via Sxy²/(Sxx·Syy) must be exactly 1');
  assert.equal(f1.r2Residual, 1, 'F1 R² via 1 − SSres/SStot must be exactly 1');
  assert.equal(f1.r2Sqrt, 1, 'F1 R² via r² from the correlation must be exactly 1');
  assert.equal(f1.ssres, 0, 'because the residuals are exactly zero - the pivots are collinear');

  /* F2 is where an exact-equality assertion would fail a CORRECT implementation. The product and
     residual formulas both land on the double nearest 0.9; the correlation formula routes through a
     square root and lands one ulp above it. The expected VALUE is exact; the comparison carries
     1e-12 because the formula is Dev's choice to make. */
  const s2 = fromCandles(byId('F2'));
  const f2 = referenceFit(s2.idx, s2.prices);
  assert.equal(f2.r2Product, 0.9, 'F2 R² via the product formula is exactly 0.9');
  assert.equal(f2.r2Residual, 0.9, 'F2 R² via the residual formula is also exactly 0.9');
  assert.notEqual(f2.r2Sqrt, 0.9, 'and via the sqrt formula it is NOT - this is why C4 uses 1e-12');
  assert.ok(Math.abs(f2.r2Sqrt - 0.9) <= 1e-12, `the gap is one ulp, not an error: ${f2.r2Sqrt}`);
});

test('C6. F4: two pivots at one price give NO R² at all - 0/0, on every formula', () => {
  const f4 = byId('F4');
  assert.equal(f4.fit, null, 'the fixture declares no fit, because none is defined');

  const s4 = fromCandles(f4);
  assert.deepEqual(s4.idx, [10, 11], 'the two tied pivots must come from the candles, not the literal');
  const fit = referenceFit(s4.idx, s4.prices);
  assert.equal(fit.syy, 0, 'SStot is zero: both pivots sit at the same price');
  assert.equal(fit.ssres, 0, 'and so is SSres');
  for (const [name, r2] of [['product', fit.r2Product], ['residual', fit.r2Residual], ['sqrt', fit.r2Sqrt]] as const) {
    assert.ok(Number.isNaN(r2), `R² via the ${name} formula must be NaN here, got ${r2}`);
  }

  /* WHY THIS IS A SPEC ITEM AND NOT A CURIOSITY. NaN fails every `>=` comparison, so a quality gate
     written as `if (r2 >= min) accept` drops this structure - the safe direction, by accident. The
     same rule written as `if (r2 < min) reject` ACCEPTS it, and draws a horizontal line through a
     two-bar plateau while reporting a fit quality of NaN. Phase 0 has to say what a degenerate fit
     returns rather than leave the arithmetic to decide. */
  assert.equal(NaN >= 0.9, false, 'NaN clears no threshold');
  assert.equal(NaN < 0.9, false, 'and fails no threshold either - both guards are false');
});

test('C7. NEGATIVE: F3 finds pivots and still has no clean structure, with F1 and F2 as the control', () => {
  const f3 = byId('F3');
  /* The absence has to be about FIT QUALITY. An empty pivot list would make this fixture pass for
     the wrong reason - the detector finding nothing is a different verdict from the detector
     finding four swings that do not line up. */
  assert.equal(f3.pivotLowIndices.length, 4, 'F3 must FIND four pivot lows - that is what makes it a fit-quality verdict');
  assert.deepEqual(referencePivots(f3.candles).lows, [4, 10, 16, 22], 'and they must be there in the data');

  const r2 = (id: string) => {
    const s = fromCandles(byId(id));
    return referenceFit(s.idx, s.prices).r2Product;
  };
  assert.ok(r2('F3') < 0.2, `F3 must fit badly, got R² ${r2('F3')}`);

  /* THE POSITIVE CONTROL, without which the line above passes while measuring nothing. */
  assert.ok(r2('F1') >= 0.85, `F1 must fit well through the same code, got ${r2('F1')}`);
  assert.ok(r2('F2') >= 0.85, `F2 must fit well through the same code, got ${r2('F2')}`);

  /* And the trap a touch-count rule walks into: F3's pivots sit up to 5 price units off the line,
     so a tolerance of 5 reports FOUR touches on a series that fits at 0.0847. */
  const s3 = fromCandles(f3);
  const res = referenceFit(s3.idx, s3.prices).residuals;
  assert.equal(res.filter((r) => Math.abs(r) <= 5).length, 4,
    'a generous tolerance can be made to swallow all four, which is why the verdict must rest on fit quality');
  assert.equal(res.filter((r) => Math.abs(r) <= 1).length, 0, 'and a tight one swallows none');
});

test('C8. pivots and R² are unit-free; the SLOPE is not, and that is the conversion hazard', () => {
  /* A pre-registered guess of mine was that raw epoch-ms x values would cost the exactness of R² -
     1.7e12 squared overflows a double's exact integer range. MEASURED, IT DOES NOT: F1's R² is
     exactly 1 either way, because the sums are centred before being squared. Recorded because the
     guess was wrong and the real hazard is narrower and easier to miss. */
  for (const f of FIXTURES) {
    if (!f.fit) continue;
    const s = fromCandles(f);
    const byIndex = referenceFit(s.idx, s.prices);
    const byMs = referenceFit(s.idx.map((i) => f.candles[i].timestamp), s.prices);
    assert.equal(byMs.r2Product, byIndex.r2Product, `${f.id}: R² must not depend on the x unit`);
    assert.deepEqual(byMs.residuals, byIndex.residuals, `${f.id}: nor must the residuals`);
  }

  /* The hazard: converting a per-millisecond slope back to per-bar loses the exactness. So a test
     asserting a slope must assert it in the unit the implementation returns, or assert the line's
     VALUE at a timestamp - which C4 does, and which is exact in both units. */
  const f1 = byId('F1');
  const sf1 = fromCandles(f1);
  const perMs = referenceFit(sf1.idx.map((i) => f1.candles[i].timestamp), sf1.prices).slope;
  assert.notEqual(perMs * INTERVAL_MS, 0.5,
    'this is expected to be 0.49999999999999994, not 0.5 - one ulp lost in the conversion. If it ' +
    'ever becomes exactly 0.5, this note is stale rather than the arithmetic being fixed.');
  assert.ok(Math.abs(perMs * INTERVAL_MS - 0.5) <= 1e-12, `and the gap is one ulp: ${perMs * INTERVAL_MS}`);
});
