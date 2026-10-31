/* #1818 PHASE 0 — THE BINDING SUITE. `lib/chartStructures.ts` driven by the fixtures.
 *
 * `chartStructurePhase0Fixtures.test.mts` proves the fixtures' expected values are what the
 * DEFINITIONS produce. It says nothing about whether the implementation produces them. This file is
 * the other half, and it is the half that gates Phase 0.
 *
 * The expected values it asserts were committed in PR #1831, BEFORE `lib/chartStructures.ts`
 * existed. Nothing here was derived from the module under test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, byId, INTERVAL_MS, tsAt, type Fixture } from './_chartStructureFixtures.mts';
import {
  findSwingPivots,
  fitLine,
  lineValueAt,
  measureFit,
  type FitPoint,
} from '../lib/chartStructures.ts';

const asPoints = (f: Fixture): FitPoint[] =>
  f.pivotLowIndices.map((i) => ({ index: i, price: f.candles[i].low }));

/* ══ PIVOTS ═════════════════════════════════════════════════════════════════════════════════════ */

test('B1. findSwingPivots at 3/3 returns exactly the fixtures pivot sets', () => {
  for (const f of FIXTURES) {
    const { highs, lows } = findSwingPivots(f.candles, 3, 3);
    assert.deepEqual(lows.map((p) => p.index), f.pivotLowIndices, `${f.id} (${f.claim}): pivot low indices`);
    assert.deepEqual(lows.map((p) => p.price), f.pivotLowPrices, `${f.id}: pivot low prices`);
    assert.deepEqual(highs.map((p) => p.index), f.pivotHighIndices, `${f.id}: pivot high indices`);
    for (const p of lows) {
      assert.equal(p.kind, 'low', `${f.id}: a low pivot must say so`);
      assert.equal(p.timestamp, f.candles[p.index].timestamp, `${f.id}: pivot timestamp must be its candle's`);
      assert.equal(p.price, f.candles[p.index].low, `${f.id}: a low pivot's price is the LOW`);
    }
    for (const p of highs) {
      assert.equal(p.kind, 'high', `${f.id}: a high pivot must say so`);
      assert.equal(p.price, f.candles[p.index].high, `${f.id}: a high pivot's price is the HIGH`);
    }
  }
});

test('B2. the strength argument is read, and the default is 3/3', () => {
  for (const f of FIXTURES) {
    for (const [s, expected] of Object.entries(f.pivotLowsAtStrength)) {
      const n = Number(s);
      assert.deepEqual(
        findSwingPivots(f.candles, n, n).lows.map((p) => p.index), expected,
        `${f.id} at strength ${n}`,
      );
    }
    assert.deepEqual(
      findSwingPivots(f.candles).lows.map((p) => p.index), f.pivotLowIndices,
      `${f.id}: the default must BE 3/3, not merely resemble it`,
    );
  }
  /* The control: F2 must disagree between 3 and 4, or the row above proves nothing. */
  const f2 = byId('F2');
  assert.notDeepEqual(
    findSwingPivots(f2.candles, 4, 4).lows.map((p) => p.index),
    findSwingPivots(f2.candles, 3, 3).lows.map((p) => p.index),
    'F2 at strength 4 must differ from strength 3 - that disagreement is what makes B2 a test',
  );
});

test('B3. a tie does not break a pivot, which is the convention the rest of the app uses', () => {
  const f4 = byId('F4');
  const lows = findSwingPivots(f4.candles, 3, 3).lows;
  assert.deepEqual(lows.map((p) => p.index), [10, 11],
    'two ADJACENT bars at the same low must BOTH be pivots. A strict comparison returns neither, ' +
    'and that is the silent difference a configurable-strength rewrite is most likely to introduce.');
  assert.deepEqual(lows.map((p) => p.price), [100, 100]);
});

test('B4. asymmetric left/right, and the confirmation lag', () => {
  const f1 = byId('F1');
  /* A pivot needs `right` bars after it to be confirmed, so the last `right` bars can never hold
     one. At right=3 the window is [left, n-4]; the fixture's last pivot is at 16 of 21. */
  assert.deepEqual(findSwingPivots(f1.candles, 3, 1).lows.map((p) => p.index), [4, 10, 16]);
  assert.deepEqual(findSwingPivots(f1.candles, 1, 3).lows.map((p) => p.index), [4, 10, 16]);
  /* A strength wider than the series can hold returns nothing - the honest answer, not an error. */
  assert.deepEqual(findSwingPivots(f1.candles, 20, 20).lows, []);
  assert.deepEqual(findSwingPivots([], 3, 3).lows, []);
});

test('B5. a bad strength throws rather than returning an empty answer', () => {
  const f1 = byId('F1');
  for (const bad of [0, -1, 2.5, NaN, Infinity]) {
    assert.throws(() => findSwingPivots(f1.candles, bad as number, 3), RangeError,
      `left=${bad} must throw: an empty result is indistinguishable from "no pivots in this series"`);
    assert.throws(() => findSwingPivots(f1.candles, 3, bad as number), RangeError, `right=${bad} must throw`);
  }
});

test('B6. a hole in the series vetoes a pivot instead of being stepped over', () => {
  const f1 = byId('F1');
  /* NaN > hi is false, so an unguarded comparison would fail to veto and a gap in the data would
     MANUFACTURE a pivot. Planted one bar away from pivot 10, inside its window. */
  const holedLow = f1.candles.map((c, i) => (i === 9 ? { ...c, low: NaN } : c));
  const lows = findSwingPivots(holedLow, 3, 3).lows.map((p) => p.index);
  assert.ok(!lows.includes(10), `a NaN low at index 9 must disqualify the pivot at 10, got [${lows.join(' ')}]`);
  /* THE CONTROL: the same candles without the hole DO produce that pivot, so the line above is
     measuring the veto and not an unrelated absence. */
  assert.ok(findSwingPivots(f1.candles, 3, 3).lows.map((p) => p.index).includes(10),
    'and without the hole, pivot 10 must be there');

  /* AND THE HIGH SIDE, SEPARATELY. The two vetoes are two conditions on two different fields, so a
     low-side test says nothing about the high side - an adversarial pass that removed only the
     high-side guard left this suite GREEN until this half was added. F1's pivot highs are 8 and 14;
     bar 7 is inside bar 8's window. */
  assert.deepEqual(findSwingPivots(f1.candles, 3, 3).highs.map((p) => p.index), [8, 14],
    'the control for the line below: without a hole, pivot highs 8 and 14 are found');
  const holedHigh = f1.candles.map((c, i) => (i === 7 ? { ...c, high: NaN } : c));
  const highs = findSwingPivots(holedHigh, 3, 3).highs.map((p) => p.index);
  assert.ok(!highs.includes(8),
    `a NaN high at index 7 must disqualify the pivot high at 8, got [${highs.join(' ')}]. ` +
    'NaN > hi is false, so an unguarded comparison MANUFACTURES a pivot out of a data hole.');
  assert.ok(highs.includes(14), 'while a pivot outside the hole window survives - the local control');

  /* AND THE HOLE AT THE CENTRE BAR - the bar that would BECOME the pivot, which is a third distinct
     condition and the last one this cell was missing. The neighbour vetoes above do not cover it:
     with the centre-bar seed removed, every neighbour comparison `h > NaN` is false and nothing
     disqualifies the bar, so the hole is reported AS a pivot, at a price of NaN, and every
     downstream fit silently returns null from it. An adversarial pass found this gap; the suite was
     green with the seed deleted. */
  const holedPivotHigh = f1.candles.map((c, i) => (i === 8 ? { ...c, high: NaN } : c));
  assert.ok(
    !findSwingPivots(holedPivotHigh, 3, 3).highs.map((p) => p.index).includes(8),
    'a bar whose OWN high is NaN must not be reported as a pivot high',
  );
  const holedPivotLow = f1.candles.map((c, i) => (i === 10 ? { ...c, low: NaN } : c));
  assert.ok(
    !findSwingPivots(holedPivotLow, 3, 3).lows.map((p) => p.index).includes(10),
    'and a bar whose OWN low is NaN must not be reported as a pivot low',
  );

  /* The general form of all five, so a future hole in the input cannot leak a non-finite price into
     anything that fits a line through it. */
  for (const series of [f1.candles, holedLow, holedHigh, holedPivotHigh, holedPivotLow]) {
    const { highs: hs, lows: ls } = findSwingPivots(series, 3, 3);
    for (const p of [...hs, ...ls]) {
      assert.ok(Number.isFinite(p.price), `a pivot must never carry a non-finite price (index ${p.index})`);
      assert.ok(Number.isFinite(p.timestamp), `nor a non-finite timestamp (index ${p.index})`);
    }
  }
});

/* ══ THE FIT ════════════════════════════════════════════════════════════════════════════════════ */

test('B7. fitLine reproduces every fixture slope, intercept and R2', () => {
  for (const f of FIXTURES) {
    if (!f.fit) continue;
    const fit = fitLine(asPoints(f));
    assert.ok(fit, `${f.id}: a fit must be returned`);
    assert.equal(fit.pointCount, f.pivotLowIndices.length, `${f.id}: pointCount`);

    const exact = f.fit.r2ExactOnEveryFormula;
    const near = (got: number, want: number, what: string) => {
      if (exact) assert.equal(got, want, `${f.id} ${what}: expected exactly ${want}, got ${got}`);
      else assert.ok(Math.abs(got - want) <= 1e-12, `${f.id} ${what}: expected ${want}, got ${got}`);
    };
    near(fit.slope, f.fit.slopePerBar, 'slope (price per CANDLE)');
    near(fit.intercept, f.fit.intercept, 'intercept (the line at index 0)');
    assert.ok(fit.r2 !== null, `${f.id}: R2 must not be null for ${fit.pointCount} distinct-price points`);
    near(fit.r2, f.fit.r2, 'R2');

    /* The line's VALUE, which is what gets drawn, and the only form of the slope that does not
       depend on the x unit. */
    f.pivotLowIndices.forEach((i, k) => near(lineValueAt(fit, i), f.fit!.lineAtPivots[k], `line at index ${i}`));
    const last = f.candles.length - 1;
    near(lineValueAt(fit, last), f.fit.lineAtLastBar, `line at the last bar (${last})`);
  }
});

test('B8. F2 R2 is EXACTLY 0.9 through this implementation, and F1 exactly 1', () => {
  /* Not a duplicate of B7. Three standard R2 formulas disagree by one ulp on F2 - the product and
     residual forms give exactly 0.9, squaring the correlation gives 0.9000000000000001 - so B7
     allows 1e-12 wherever the fixture records that. `fitLine` uses 1 - SSres/SStot, so for F2 it
     lands on the exact double, and pinning that is what turns a switch to the sqrt form into a
     visible change rather than a silent one. */
  const f1 = fitLine(asPoints(byId('F1')))!;
  assert.equal(f1.r2, 1, 'F1 is exactly collinear: R2 must be exactly 1');
  assert.equal(f1.slope, 0.5);
  assert.equal(f1.intercept, 100);

  const f2 = fitLine(asPoints(byId('F2')))!;
  assert.equal(f2.r2, 0.9, 'F2 must be exactly 0.9 via 1 - SSres/SStot');
  assert.equal(f2.slope, 0.5, 'and the slope survives the residuals exactly, by construction');
  assert.equal(f2.intercept, 100);
});

test('B9. R2 is NULL where it cannot discriminate - never 1, and never NaN', () => {
  /* THE DEGENERATE CASES, and the reason this cell exists. Two pivots at one price give SStot = 0,
     so `1 - SSres/SStot` is 0/0. Arithmetic says NaN; the defensible-looking answer is 1, because
     any line through two points passes through them exactly. BOTH ARE WRONG TO RETURN: a threshold
     of `r2 >= 0.9` admits a 1, and NaN clears no threshold AND fails none, so an inverted guard
     (`if (r2 < min) reject`) accepts it and draws a horizontal line through a two-bar plateau.
     `fitLine` returns null, which forces the caller to decide. */
  const f4 = byId('F4');
  const fit = fitLine(asPoints(f4));
  assert.ok(fit, 'F4 still gets a LINE - two points at distinct indices define one');
  assert.equal(fit.pointCount, 2);
  assert.equal(fit.slope, 0, 'flat, because both pivots sit at 100');
  assert.equal(fit.intercept, 100);
  assert.equal(fit.r2, null, 'but NO R2: a 2-point line is exact by construction and says nothing');
  assert.ok(!Number.isNaN(fit.r2 as unknown as number), 'and it must be null rather than NaN');

  /* Three or more points all at one price: variance to explain is zero, so again null. This is the
     shape a range box arrives in, so Phase 1 will meet it. */
  const flat = fitLine([{ index: 0, price: 50 }, { index: 5, price: 50 }, { index: 9, price: 50 }]);
  assert.ok(flat);
  assert.equal(flat.slope, 0);
  assert.equal(flat.r2, null, 'zero price variance: R2 is 1 - 0/0 and must not be reported as 1');

  /* THE POSITIVE CONTROL for both: the same function on a fixture WITH variance returns a number. */
  assert.equal(fitLine(asPoints(byId('F1')))!.r2, 1, 'F1 through the same code returns a real R2');
});

test('B10. fitLine returns null rather than a degenerate line', () => {
  assert.equal(fitLine([]), null, 'no points');
  assert.equal(fitLine([{ index: 3, price: 100 }]), null, 'one point defines no line');
  assert.equal(
    fitLine([{ index: 4, price: 100 }, { index: 4, price: 110 }]), null,
    'every point at one index is a VERTICAL line, which no y = mx + b can express',
  );
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(fitLine([{ index: 0, price: 1 }, { index: 1, price: bad }]), null, `price ${bad}`);
    assert.equal(fitLine([{ index: 0, price: 1 }, { index: bad, price: 2 }]), null, `index ${bad}`);
  }
  /* THE CONTROL: two finite points at different indices DO fit. */
  assert.ok(fitLine([{ index: 0, price: 1 }, { index: 2, price: 3 }]), 'and a valid 2-point set must fit');
});

/* ══ FIT QUALITY ════════════════════════════════════════════════════════════════════════════════ */

test('B11. measureFit counts every bar in reach, not only the fitted points', () => {
  /* THE POPULATION IS THE WHOLE ARRAY, and the first version of this cell asserted the pivot-only
     count and failed against correct code. `measureFit`'s own doc comment says why it scans
     everything: the excess over the fitted points "is the evidence the line is real rather than an
     artefact of three points". F2 bar 11 is exactly that - a non-pivot bar sitting on the line. */
  for (const f of FIXTURES) {
    if (!f.fit) continue;
    const fit = fitLine(asPoints(f));
    assert.ok(fit, `${f.id}: a fit must be returned`);
    for (const [tolText, expected] of Object.entries(f.fit.touchCountsByTolerance)) {
      const abs = Number(tolText);
      assert.equal(
        measureFit(f.candles, fit, { side: 'low', tolerance: { abs } }).touchCount, expected,
        `${f.id} at tolerance ${abs}`,
      );
    }
  }

  const f1 = byId('F1');
  const q1 = measureFit(f1.candles, fitLine(asPoints(f1))!, { side: 'low', tolerance: { abs: 0 } });
  assert.equal(q1.firstTouchTimestamp, f1.fit!.firstTouchTs);
  assert.equal(q1.lastTouchTimestamp, f1.fit!.lastTouchTs);
  assert.equal(q1.distance, f1.fit!.lastCloseMinusLine, 'last close minus the line under it, signed');

  /* F3 is the trap the negative fixture was built to expose: at a tolerance of 5, EIGHT bars count
     as touching a line that fits at R2 0.0847. The verdict has to rest on fit quality. */
  const f3 = byId('F3');
  const fit3 = fitLine(asPoints(f3))!;
  assert.equal(measureFit(f3.candles, fit3, { side: 'low', tolerance: { abs: 5 } }).touchCount, 8);
  assert.equal(measureFit(f3.candles, fit3, { side: 'low', tolerance: { abs: 0.5 } }).touchCount, 0);
  assert.ok(fit3.r2! < 0.2, `and the fit is still bad: ${fit3.r2}`);
});

test('B12. measureFit: sides, percentage tolerance, empty input, and a bad tolerance', () => {
  const f1 = byId('F1');
  const fit = fitLine(asPoints(f1))!;

  /* The line was fitted through LOWS, so measuring HIGHS against it must not report those same
     bars - highs are low + 1 throughout this fixture. */
  assert.equal(measureFit(f1.candles, fit, { side: 'high', tolerance: { abs: 0 } }).touchCount, 0,
    'a support line is touched by lows, not by the highs one unit above them');
  assert.equal(measureFit(f1.candles, fit, { side: 'high', tolerance: { abs: 1 } }).touchCount, 3,
    'and at a tolerance of 1 the same three bars reach it - the control for the line above');

  /* PERCENTAGE TOLERANCE IS TAKEN AT THE LINE'S VALUE, NOT THE CANDLE'S, and the two readings have
     to be told apart by a case where they DISAGREE. An earlier version of this cell asserted only
     `touchCount >= 1` against F1, where line and price differ by about 1 in 105 - so swapping the
     line for the candle price changed nothing and the mutation survived. Built to discriminate:
     three bars with a low of 100, a flat line at 102, so the gap is exactly 2.
       at the LINE  - 102 x 0.0198 = 2.0196 >= 2, so all three touch
       at the PRICE - 100 x 0.0198 = 1.98   <  2, so none does  */
  const flatCandles = [0, 1, 2].map((i) => ({
    timestamp: tsAt(i), open: 100.5, high: 101, low: 100, close: 100.5,
  }));
  const lineAt102 = fitLine([{ index: 0, price: 102 }, { index: 2, price: 102 }])!;
  assert.equal(lineValueAt(lineAt102, 1), 102, 'the line sits 2 above those lows');
  assert.equal(
    measureFit(flatCandles, lineAt102, { side: 'low', tolerance: { pct: 0.0198 } }).touchCount, 3,
    'the band must be a percentage of the LINE (2.0196), which admits a gap of 2',
  );
  assert.equal(
    measureFit(flatCandles, lineAt102, { side: 'low', tolerance: { pct: 0.0196 } }).touchCount, 0,
    'and just below the line-based threshold (1.9992) it admits nothing - the control that proves ' +
    'the assertion above is sensitive to the band rather than to the bars',
  );

  const empty = measureFit([], fit, { side: 'low', tolerance: { abs: 1 } });
  assert.equal(empty.touchCount, 0);
  assert.equal(empty.firstTouchTimestamp, null);
  assert.equal(empty.distance, null, 'null, NOT 0 - zero would read as "exactly on the line"');
  assert.equal(empty.distancePct, null);

  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(() => measureFit(f1.candles, fit, { side: 'low', tolerance: { abs: bad } }), RangeError,
      `tolerance ${bad} must throw`);
    assert.throws(() => measureFit(f1.candles, fit, { side: 'low', tolerance: { pct: bad } }), RangeError,
      `pct tolerance ${bad} must throw`);
  }
});

test('B13. distancePct is null where a percentage of the line is meaningless', () => {
  /* A descending line extrapolates below zero. A distance expressed as a fraction of a negative or
     zero line is not merely large, it is the wrong sign - so it has to be withheld rather than
     reported. The absolute distance is still available. */
  const candles = byId('F1').candles;
  const belowZero = fitLine([{ index: 0, price: 10 }, { index: 1, price: 5 }, { index: 2, price: 0 }])!;
  assert.ok(lineValueAt(belowZero, candles.length - 1) < 0, 'this line is below zero at the last bar');
  const q = measureFit(candles, belowZero, { side: 'low', tolerance: { abs: 1 } });
  assert.equal(q.distancePct, null, 'so the percentage must be withheld');
  assert.ok(q.distance !== null && Number.isFinite(q.distance), 'while the absolute distance stays available');

  /* THE CONTROL: a line that is positive at the last bar DOES report a percentage. */
  const positive = fitLine(asPoints(byId('F1')))!;
  assert.ok(measureFit(candles, positive, { side: 'low', tolerance: { abs: 1 } }).distancePct !== null);
});

test('B14. the index origin: fit and measurement must share one candle array', () => {
  /* The module's own warning, pinned. A line fitted through pivots found in the full array and then
     measured against a SLICE of it is wrong by the offset, silently, and shows up as a touch count
     of zero on a line that plainly touches. This cell exists so that hazard is a documented,
     tested property rather than a comment. */
  const f1 = byId('F1');
  const fit = fitLine(asPoints(f1))!;
  const whole = measureFit(f1.candles, fit, { side: 'low', tolerance: { abs: 0 } });
  const sliced = measureFit(f1.candles.slice(6), fit, { side: 'low', tolerance: { abs: 0 } });
  assert.equal(whole.touchCount, 3);
  assert.equal(sliced.touchCount, 0,
    'the same line against a re-indexed slice touches NOTHING. Not a defect - the reason the ' +
    'module says to pass the same array to both, and the failure mode a caller will otherwise ' +
    'read as "the detector found no touches".');
});

test('B15. the fixtures sit inside the real history horizon', () => {
  /* The weekly rung is capped by what exists, not by the request: 345 weekly BTCUSDT candles,
     6.6 years, measured 2026-10-30 (#1830's header). A fixture implying deeper weekly history
     would be testing something that cannot be fetched. The longest fixture here is 26 bars. */
  const longest = Math.max(...FIXTURES.map((f) => f.candles.length));
  assert.ok(longest <= 345, `longest fixture is ${longest} bars, which must fit the weekly horizon`);
  /* And the arithmetic floor, so the Phase 2 window is sized from a number rather than a feel: at
     strength k, three pivots spaced s apart need 2s + 2k + 1 bars. */
  const f1 = byId('F1');
  assert.equal(f1.candles.length, 21, 'F1 is 21 bars for 3 pivots at spacing 6, floor 2(6)+2(3)+1 = 19');
  assert.equal(INTERVAL_MS, 3_600_000, 'the fixtures are 1H bars');
});
