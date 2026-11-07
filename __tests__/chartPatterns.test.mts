/* #1818 Phase 2 Part A: the names put on measured chart structures.
 *
 * DELIBERATELY DETERMINISTIC, AND THAT IS THE WHOLE SCOPE. Not one cell here asserts that the
 * detector finds real patterns in real candles, or how often it is right. That question was asked
 * and answered the hard way on this branch: a "two-rail shapes are 0% false-positive" claim was
 * refuted by an independent null model and retracted in 690ae5ba, because the figure came from the
 * shape of the generator rather than from the detector. Accuracy belongs to that null model. These
 * cells cover what arithmetic can settle - the thresholds, the relationships between them, and
 * which name `classify` returns for a structure whose geometry is constructed rather than sampled.
 *
 * NO NETWORK, NO BROWSER, NO CANDLE FIXTURES FROM AN EXCHANGE. Every structure below is built by
 * hand so the right answer is computable by the reader: `lineValueAt` is `slope * index +
 * intercept`, so every gap and slope quoted in a comment can be checked without running anything.
 *
 * WHY THE RAILS ARE CAST. `StructureRail` and `DetectedStructure` carry fields the DETECTOR fills -
 * touch counts, timestamps, R², pivot windows - and `classify` reads exactly four of them: a rail's
 * `side`, its `fit`, its `pivots[].index`, and the structure's `rails` array. Building complete
 * detector output to test a pure classifier would mean maintaining a second copy of Phase 1's shape
 * in here, and it would drift. The cast is confined to the two helpers below and nowhere else, so
 * what each cell constructs stays readable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  PATTERN_TYPES,
  PATTERN_TIMEFRAMES,
  FLAT_SLOPE_PCT_PER_BAR,
  CONVERGENCE_RATIO,
  DIVERGENCE_RATIO,
  POLE_WINDOWS,
  POLE_MIN_PCT,
  FLAG_MAX_BARS_PER_POLE_BAR,
} from '../lib/chartPatterns.ts';

/** A rail whose line is `slope * index + intercept`, anchored by a pivot at `pivotIndex`. */
function rail(side: 'high' | 'low', slope: number, intercept: number, pivotIndex = 0) {
  return {
    side,
    gate: 'sloped',
    fit: { slope, intercept, pointCount: 3, r2: 0.99 },
    quality: { side, tolerance: { kind: 'pct', value: 0.001 }, touchCount: 3,
      firstTouchTimestamp: null, lastTouchTimestamp: null },
    pivots: [{ index: pivotIndex }],
    pivotsOnRail: 3,
    excessTouches: 0,
    from: { timestamp: 0, price: intercept },
    to: { timestamp: 1, price: intercept },
  } as unknown as Parameters<typeof classify>[0]['rails'][number];
}

function structure(rails: ReturnType<typeof rail>[]) {
  return { kind: rails.length === 1 ? 'trendline' : 'channel', timeframe: '1h', rails,
    candidatesConsidered: 1 } as unknown as Parameters<typeof classify>[0];
}

/** 21 candles, so `lastIndex` is 20. Close is constant because every cell below starts its
 *  structure at index 0, which puts every POLE_WINDOWS lookback before the array and makes
 *  `poleBefore` return null - isolating the geometry from the flag/pole path on purpose. */
const CANDLES = Array.from({ length: 21 }, () => ({ open: 100, high: 101, low: 99, close: 100, time: 0 })) as
  unknown as Parameters<typeof classify>[1];
const LAST = 20;

test('P1. the thresholds are the measured ones, pinned exactly', () => {
  /* HARDCODED ON PURPOSE. Reading these from the module would make the cell agree with whatever
     the module says, which is not a test. Each is a number somebody chose for a reason recorded
     beside it, and a silent edit is what this catches. */
  assert.equal(FLAT_SLOPE_PCT_PER_BAR, 0.0002, 'the flatness threshold moved');
  assert.equal(CONVERGENCE_RATIO, 0.7, 'the convergence threshold moved');
  assert.equal(POLE_MIN_PCT, 0.03, 'the minimum pole size moved');
  assert.equal(FLAG_MAX_BARS_PER_POLE_BAR, 2.5, 'a flag may now last longer relative to its pole');
  assert.deepEqual([...POLE_WINDOWS], [10, 20, 30, 45], 'the searched pole windows changed');
  assert.deepEqual([...PATTERN_TIMEFRAMES], ['15m', '1h', '4h'], 'the offered timeframes changed');
});

test('P2. DIVERGENCE_RATIO is DERIVED from CONVERGENCE_RATIO, not a second literal', () => {
  /* THE POINT IS THE RELATIONSHIP, NOT THE VALUE. `1/0.7` is 1.4285714...; writing `1.43` beside
     it looks harmless and silently breaks the symmetry the file promises - the band would no longer
     be "converge by 30%, diverge by the reciprocal". Asserting the arithmetic identity means
     anyone who changes one and hardcodes the other goes red, which is the only way this stays true
     without being re-derived by a reader. */
  assert.equal(DIVERGENCE_RATIO, 1 / CONVERGENCE_RATIO, 'DIVERGENCE_RATIO is no longer the reciprocal');
  /* And the band is the right way round, which a reciprocal alone does not guarantee. */
  assert.ok(CONVERGENCE_RATIO < 1 && DIVERGENCE_RATIO > 1, 'the convergence band is inverted');
});

test('P3. a LONE RAIL is named by its side - never dropped, never collapsed into one name', () => {
  /* THE CELL I WOULD NOT SKIP, and it exists because the first version of this file returned null
     for a single rail. That silently discarded "this descending action line" - the shape the owner
     named most plainly - and on live data it was 5 of 6 hits. A suite that only exercised two-rail
     shapes stayed green through exactly that.
     The two halves are asserted together because the failure has two forms: dropping the rail, and
     giving both sides the same name. */
  const resistance = classify(structure([rail('high', -0.2, 110)]), CANDLES);
  const support = classify(structure([rail('low', 0.2, 100)]), CANDLES);

  assert.notEqual(resistance, null, 'a lone HIGH rail was dropped - this is the #1818 regression');
  assert.notEqual(support, null, 'a lone LOW rail was dropped - this is the #1818 regression');
  assert.equal(resistance!.type, 'line_resistance', 'a rail above price must be resistance');
  assert.equal(support!.type, 'line_support', 'a rail below price must be support');
  assert.notEqual(resistance!.type, support!.type,
    'both sides returned the same name - a line over price and a line under it are different objects');

  /* A line carries no second rail and no impulse claim, and the interface says so. */
  for (const r of [resistance!, support!]) {
    assert.equal(r.gapStart, 0, 'a one-rail structure has no gap to measure');
    assert.equal(r.gapEnd, 0, 'a one-rail structure has no gap to measure');
    assert.equal(r.pole, null, 'a line must not claim a pole');
  }
});

test('P4. both line names are in the vocabulary', () => {
  /* P3 fails if classify stops returning them; this fails if they are removed from PATTERN_TYPES,
     which is the other way the owner's shape disappears. */
  assert.ok(PATTERN_TYPES.includes('line_support'), 'line_support left the vocabulary');
  assert.ok(PATTERN_TYPES.includes('line_resistance'), 'line_resistance left the vocabulary');
  assert.equal(PATTERN_TYPES.length, 12, 'the pattern vocabulary changed size');
});

test('P5. classify names each two-rail geometry, on rails whose arithmetic is checkable', () => {
  /* Every case: 21 candles, structure starts at index 0, rails read at index 20. Gaps are quoted
     so the expected ratio can be checked without running this. */
  const cases: Array<[string, ReturnType<typeof rail>[], string]> = [
    // both flat -> range. Checked BEFORE convergence, because a flat "rising channel" is useless.
    ['range', [rail('low', 0, 100), rail('high', 0, 110)], 'range'],

    // gap 10 -> 6 (ratio 0.6, converging). Flat ceiling, rising floor.
    ['flat ceiling + rising floor', [rail('low', 0.2, 100), rail('high', 0, 110)], 'triangle_asc'],

    // gap 10 -> 6. Flat floor, falling ceiling.
    ['flat floor + falling ceiling', [rail('low', 0, 100), rail('high', -0.2, 110)], 'triangle_desc'],

    // gap 10 -> 6, both rails rising.
    ['both rising, converging', [rail('low', 0.3, 100), rail('high', 0.1, 110)], 'wedge_rising'],

    // gap 10 -> 6, both rails falling.
    ['both falling, converging', [rail('low', -0.1, 100), rail('high', -0.3, 110)], 'wedge_falling'],

    // gap 10 -> 4, closing from both sides at once.
    ['closing from both sides', [rail('low', 0.15, 100), rail('high', -0.15, 110)], 'triangle_sym'],

    // gap 10 -> 10 (ratio 1, parallel), no pole because the structure starts at index 0.
    ['parallel, drifting up', [rail('low', 0.1, 100), rail('high', 0.1, 110)], 'channel_rising'],
    ['parallel, drifting down', [rail('low', -0.1, 100), rail('high', -0.1, 110)], 'channel_falling'],
  ];

  for (const [label, rails, expected] of cases) {
    const got = classify(structure(rails), CANDLES);
    assert.notEqual(got, null, `${label}: expected ${expected}, got null`);
    assert.equal(got!.type, expected, `${label}`);
    /* None of these is a flag - every one starts at index 0, so no pole can be measured - and the
       interface promises `pole` is null on every non-flag. */
    assert.equal(got!.pole, null, `${label}: a non-flag must not carry a pole`);
  }
});

test('P6. DIVERGING rails return null rather than the nearest word', () => {
  /* gap 10 -> 18, ratio 1.8, past DIVERGENCE_RATIO (1.428...). A broadening shape has no name in
     this vocabulary, and the file's own header says inventing one is how "the AI drew a bull flag"
     becomes something a user can show to be wrong. Null is the honest answer and it is the one an
     over-eager tidy-up would remove. */
  const got = classify(structure([rail('low', -0.2, 100), rail('high', 0.2, 110)]), CANDLES);
  assert.equal(got, null, 'a broadening structure was given a name it does not have');
});

test('P7. CONTROL: the geometry fixtures land where I say they do', () => {
  /* Without this, P5 and P6 could both be satisfied by a classify() that returned a constant, and
     every ratio quoted in a comment above would be unverified prose. Recomputing the gaps here from
     the same slope/intercept arithmetic the module uses is what makes those comments checkable. */
  const at = (slope: number, intercept: number, i: number) => slope * i + intercept;

  const convergeStart = at(0, 110, 0) - at(0.2, 100, 0);
  const convergeEnd = at(0, 110, LAST) - at(0.2, 100, LAST);
  assert.equal(convergeStart, 10);
  assert.equal(convergeEnd, 6);
  assert.ok(convergeEnd / convergeStart <= CONVERGENCE_RATIO, 'the "converging" fixture does not converge');

  const divergeStart = at(0.2, 110, 0) - at(-0.2, 100, 0);
  const divergeEnd = at(0.2, 110, LAST) - at(-0.2, 100, LAST);
  assert.equal(divergeStart, 10);
  assert.equal(divergeEnd, 18);
  assert.ok(divergeEnd / divergeStart >= DIVERGENCE_RATIO, 'the "diverging" fixture does not diverge');

  const parallelStart = at(0.1, 110, 0) - at(0.1, 100, 0);
  const parallelEnd = at(0.1, 110, LAST) - at(0.1, 100, LAST);
  assert.equal(parallelEnd / parallelStart, 1, 'the "parallel" fixture is not parallel');

  /* And the flat rails really are flat by the module's own threshold, while the sloped ones are
     not - the distinction P5's range case turns on. */
  assert.ok(Math.abs(0 / at(0, 110, LAST)) <= FLAT_SLOPE_PCT_PER_BAR, 'the flat fixture is not flat');
  assert.ok(Math.abs(0.2 / at(0.2, 100, LAST)) > FLAT_SLOPE_PCT_PER_BAR, 'the sloped fixture reads as flat');
});
