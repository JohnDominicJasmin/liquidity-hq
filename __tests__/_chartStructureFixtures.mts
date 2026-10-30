/* #1818 PHASE 0 FIXTURES — candle series with exact expected pivots, slopes, R² and touch counts.
 *
 * WHY THESE CAN BE EXACT. `lib/chartStructures.ts` (Phase 0) is pure arithmetic over a candle
 * array: no AI call, no network, no clock, no randomness. `docs/proposals/ai-chart-structures.md`
 * §2 keeps the geometry in code *precisely* so it can be tested this way — a model-placed line
 * misses the candles and the user's own eyes are the test instrument. So the expected values below
 * are literals, not tolerances-around-a-guess, and the cells that can assert exact equality do.
 *
 * WHERE THE EXPECTED VALUES COME FROM, because this is the trap this file exists inside. They are
 * NOT read off an implementation. They are hardcoded from the definitions — the fractal-pivot
 * convention this repo already uses in three places, and the textbook least-squares closed form —
 * and `chartStructurePhase0Fixtures.test.mts` recomputes them from those definitions and requires
 * them to match. Deriving a test's expectations from the thing under test is the failure that cost
 * this project a whole session once; writing the fixtures BEFORE `lib/chartStructures.ts` exists
 * is the strongest available guarantee against it.
 *
 * THE CONSTRUCTION, so a reader can audit a pivot set without running anything. Each fixture
 * declares its pivot lows. Every other bar's low is
 *
 *     low(i) = min over declared pivots p of ( low(p) + ramp × |i − p| )
 *
 * so every non-pivot bar inside the detector's range has a declared pivot within `strength` bars
 * that is strictly lower — which is exactly what disqualifies a bar under the convention. That is
 * why the pivot set is FORCED by the data rather than hoped for. `ramp` is per-fixture and is the
 * smallest value that forces the set: a flank too shallow lets a distant pivot's ramp dip under a
 * nearer pivot and steal it. THAT IS NOT HYPOTHETICAL — at ramp 2 the F3 series lost its first
 * pivot and the remaining three fitted a trendline at R² 0.987, so the "no clean structure"
 * fixture would have asserted the opposite of its own purpose. The check caught it; reading did
 * not.
 *
 * Highs are `low + 1` throughout. The high side is therefore a by-product of the ramp rather than
 * designed, and its expected pivot set is recorded as measured — stated plainly so nobody reads
 * `pivotHighIndices` as a designed shape.
 */

/** Matches `PACandle` in `lib/priceAction.ts`, deliberately re-declared so this module imports no app code. */
export interface FixtureCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 1H bars. The absolute epoch is arbitrary; the spacing is what the fit sees. */
export const INTERVAL_MS = 3_600_000;
export const T0 = 1_700_000_000_000;

export const tsAt = (i: number): number => T0 + i * INTERVAL_MS;

export interface FixtureFit {
  /** Slope in price per BAR. See the unit note in the suite: this is not comparable at exact equality with a per-millisecond slope. */
  slopePerBar: number;
  intercept: number;
  /** Centred sums, exposed so a disagreement can be localised to one of them rather than to "the fit". */
  sxx: number;
  sxy: number;
  syy: number;
  ssres: number;
  r2: number;
  /** True when all three standard R² formulas land on the same double. False means assert with a tolerance — the reason is in the suite. */
  r2ExactOnEveryFormula: boolean;
  /** Line value at each pivot index, and at the last bar. The unit-free form of the slope, and what a drawn line actually is. */
  lineAtPivots: number[];
  lineAtLastBar: number;
  /** §3's "distance of current price from the line": last close minus the line under it. */
  lastCloseMinusLine: number;
  firstTouchTs: number;
  lastTouchTs: number;
  /**
   * Pivot price minus the line under it, per pivot, exact. ASSERTED INSTEAD OF A TOUCH COUNT for
   * every fixture but F1, because "touch" needs a tolerance and Phase 0 has not chosen one — a
   * fixture that hardcoded a count would be asserting a threshold Dev is entitled to pick. From
   * these, any tolerance's count is derivable: `residualsAtPivots.filter(r => abs(r) <= tol)`.
   */
  residualsAtPivots: number[];
  /** Touches at tolerance exactly 0, AMONG THE PIVOTS ONLY. For F1 this is also the count at ANY tolerance. */
  touchesAtZeroTolerance: number;
  /**
   * Bars within tolerance of the line, counting the WHOLE candle array on the `low` side — which is
   * a different number from the pivot-only count above, and the one `measureFit` reports.
   *
   * RECORDED BECAUSE THE TWO DIVERGE AND I GOT IT WRONG FIRST. The binding suite asserted the
   * pivot-only count against `measureFit` and failed: F2's bar 11 has a low of 105.5 and the line
   * at index 11 is 105.5, so a NON-PIVOT bar sits exactly on it. `lib/chartStructures.ts` scans the
   * whole array on purpose and says why — the excess over the fitted points "is the evidence the
   * line is real rather than an artefact of three points". F2's bar 11 is exactly that evidence.
   *
   * So a touch count is only meaningful with its population stated. Keyed by tolerance in price
   * units.
   */
  touchCountsByTolerance: Record<string, number>;
}

export interface Fixture {
  id: string;
  title: string;
  /** What this fixture is for, in one line, so a failure reads as a claim rather than a number. */
  claim: string;
  ramp: number;
  candles: FixtureCandle[];
  pivotLowIndices: number[];
  pivotLowPrices: number[];
  /** Measured, not designed — see the header. */
  pivotHighIndices: number[];
  /** Pivot lows at other strengths. A detector whose `strength` argument is ignored returns the strength-3 set for all of these. */
  pivotLowsAtStrength: Record<number, number[]>;
  /** What a STRICT (`<`/`>`) comparison would return. The repo's three existing detectors are all non-strict. */
  strictVariantPivotLows: number[];
  /** `null` when a line fit is not defined for this fixture — F4 is the degenerate case and says why. */
  fit: FixtureFit | null;
}

function build(n: number, pivots: { index: number; low: number }[], ramp: number): FixtureCandle[] {
  const bars: FixtureCandle[] = [];
  for (let i = 0; i < n; i++) {
    let low = Infinity;
    for (const p of pivots) low = Math.min(low, p.low + ramp * Math.abs(i - p.index));
    bars.push({ timestamp: tsAt(i), open: low + 0.5, high: low + 1, low, close: low + 0.5 });
  }
  return bars;
}

/* ── F1. Ascending support, perfectly collinear ──────────────────────────────────────────────────
 * Three swing lows exactly on y = 100 + 0.5x. Every quantity is exact in binary floating point and
 * every one of the three standard R² formulas returns exactly 1, so this is the one fixture that
 * asserts exact equality throughout. Its touch count is 3 at ANY tolerance a detector picks, which
 * makes it immune to a threshold choice Phase 0 has not made yet. */
const F1_PIVOTS = [
  { index: 4, low: 102 },
  { index: 10, low: 105 },
  { index: 16, low: 108 },
];

/* ── F2. Ascending support with real residuals ───────────────────────────────────────────────────
 * Four swing lows, deviations chosen ORTHOGONAL to the x deviations so the least-squares slope
 * stays exactly 0.5 while R² comes down to exactly 0.9. That orthogonality is the whole trick: a
 * naive ±k noise pattern changes the slope as well as the fit, and then neither number is a clean
 * assertion. SSres is 5 and SStot is 50 on the nose. */
const F2_PIVOTS = [
  { index: 4, low: 102.5 },
  { index: 10, low: 103.5 },
  { index: 16, low: 109.5 },
  { index: 22, low: 110.5 },
];

/* ── F3. THE NEGATIVE FIXTURE — pivots exist, no clean structure ─────────────────────────────────
 * §3: "no clean structure on this timeframe right now" is a correct and shippable answer, and
 * drawing a weak line because the user pressed a button is how the tool loses its credibility in
 * one session.
 *
 * The pivot lows deliberately zigzag (108, 100, 104, 110), so a trendline through them fits at
 * R² 0.0847 — below any threshold worth shipping. TWO THINGS MAKE THIS A CONTROL RATHER THAN A
 * COINCIDENCE: the pivots ARE found, so the emptiness is a verdict about fit quality and not about
 * an empty input; and no two pivots share a price, so it is not quietly a range box either. The
 * positive control beside it is F1 and F2 clearing the same path at R² 1 and 0.9 — an absence
 * assertion with nothing shown to fire is an assertion that passes while measuring nothing
 * (`docs/INFRASTRUCTURE.md` §9b, §9e). */
const F3_PIVOTS = [
  { index: 4, low: 108 },
  { index: 10, low: 100 },
  { index: 16, low: 104 },
  { index: 22, low: 110 },
];

/* ── F4. Flat double bottom — the tie, and the degenerate fit ────────────────────────────────────
 * Two ADJACENT bars at the same low. Under the repo's non-strict convention both are pivots,
 * because an equal neighbour does not disqualify a bar; under a strict comparison NEITHER is, and
 * the series reports no pivots at all. That is the single most likely silent behaviour change in a
 * rewrite that adds a configurable strength, and `strictVariantPivotLows` pins it.
 *
 * It is also the degenerate fit, and this is a spec hole rather than a test case: two pivots at one
 * price give SStot = 0, so every standard R² formula computes 0/0 and returns NaN — not 1, not 0.
 * NaN fails every `>=` threshold, so the structure is dropped, which is the safe direction BY
 * ACCIDENT. An inverted guard (`if (r2 < min) reject`) accepts it instead and draws a horizontal
 * line through a two-bar plateau. Phase 0 has to state what a degenerate fit returns; the
 * arithmetic should not be left to decide. */
const F4_PIVOTS = [
  { index: 10, low: 100 },
  { index: 11, low: 100 },
];

export const FIXTURES: Fixture[] = [
  {
    id: 'F1',
    title: 'ascending support, three swing lows exactly collinear',
    claim: 'a clean ascending trendline is measured exactly: slope 0.5/bar, R² 1, 3 touches',
    ramp: 2,
    candles: build(21, F1_PIVOTS, 2),
    pivotLowIndices: [4, 10, 16],
    pivotLowPrices: [102, 105, 108],
    pivotHighIndices: [8, 14],
    pivotLowsAtStrength: { 2: [4, 10, 16], 3: [4, 10, 16], 4: [4, 10, 16] },
    strictVariantPivotLows: [4, 10, 16],
    fit: {
      slopePerBar: 0.5,
      intercept: 100,
      sxx: 72,
      sxy: 36,
      syy: 18,
      ssres: 0,
      r2: 1,
      r2ExactOnEveryFormula: true,
      lineAtPivots: [102, 105, 108],
      lineAtLastBar: 110,
      lastCloseMinusLine: 6.5,
      firstTouchTs: 1_700_014_400_000,
      lastTouchTs: 1_700_057_600_000,
      residualsAtPivots: [0, 0, 0],
      touchesAtZeroTolerance: 3,
      /* The only fixture where the two populations agree at tolerance 0: no non-pivot bar reaches
         this line, because every one of them sits ramp×distance above it. */
      touchCountsByTolerance: { '0': 3, '0.5': 3, '1': 3, '1.5': 6, '5': 18 },
    },
  },
  {
    id: 'F2',
    title: 'ascending support with residuals orthogonal to the x deviations',
    claim: 'slope survives noise exactly (0.5/bar) while R² drops to exactly 0.9',
    ramp: 2,
    candles: build(26, F2_PIVOTS, 2),
    pivotLowIndices: [4, 10, 16, 22],
    pivotLowPrices: [102.5, 103.5, 109.5, 110.5],
    pivotHighIndices: [7, 14, 19],
    /* Strength 4 drops two of the four and strength 2 keeps all four, so this row is a live control
       on the `strength` argument being read at all. */
    pivotLowsAtStrength: { 2: [4, 10, 16, 22], 3: [4, 10, 16, 22], 4: [4, 10] },
    strictVariantPivotLows: [4, 10, 22],
    fit: {
      slopePerBar: 0.5,
      intercept: 100,
      sxx: 180,
      sxy: 90,
      syy: 50,
      ssres: 5,
      r2: 0.9,
      /* The product and residual formulas both give exactly 0.9; the correlation-then-square
         formula gives 0.9000000000000001, one ulp high, because it routes through a square root.
         So R² here is asserted to 1e-12 rather than exactly, and the VALUE is still exact. */
      r2ExactOnEveryFormula: false,
      lineAtPivots: [102, 105, 108, 111],
      lineAtLastBar: 112.5,
      lastCloseMinusLine: 4.5,
      firstTouchTs: 1_700_014_400_000,
      lastTouchTs: 1_700_079_200_000,
      /* Exact, and they are the fixture's real assertion. No pivot lies on the line, so a zero
         tolerance counts no touches and a tolerance of 1.5 counts all four. A detector that
         reports 4 touches here is not wrong — it has chosen a tolerance, and this records what
         that choice costs. */
      residualsAtPivots: [0.5, -1.5, 1.5, -0.5],
      touchesAtZeroTolerance: 0,
      /* ONE at tolerance 0, and not a pivot: bar 11's low is 105.5 and the line at 11 is 105.5. */
      touchCountsByTolerance: { '0': 1, '0.5': 3, '1': 5, '1.5': 8, '5': 22 },
    },
  },
  {
    id: 'F3',
    title: 'NEGATIVE: four swing lows that zigzag, so nothing clean fits',
    claim: 'pivots are found and the best line still fits at R² 0.0847 — the honest answer is none',
    ramp: 6,
    candles: build(26, F3_PIVOTS, 6),
    pivotLowIndices: [4, 10, 16, 22],
    pivotLowPrices: [108, 100, 104, 110],
    pivotHighIndices: [6, 13, 19, 20],
    pivotLowsAtStrength: { 2: [4, 10, 16, 22], 3: [4, 10, 16, 22], 4: [4, 10, 16] },
    strictVariantPivotLows: [4, 10, 16, 22],
    fit: {
      /* 1/6 and 310/3 — irrational in binary, so this fixture's slope, intercept and line values
         are asserted to 1e-12. The quantities that matter here are exact anyway: Sxx, Sxy, Syy and
         SSres are all integers. */
      slopePerBar: 0.16666666666666666,
      intercept: 103.33333333333333,
      sxx: 180,
      sxy: 30,
      syy: 59,
      ssres: 54,
      r2: 0.0847457627118644,
      r2ExactOnEveryFormula: false,
      lineAtPivots: [104, 105, 106, 107],
      lineAtLastBar: 107.5,
      lastCloseMinusLine: 21,
      firstTouchTs: 1_700_014_400_000,
      lastTouchTs: 1_700_079_200_000,
      /* Up to 5 price units off the line. WHICH IS THE POINT OF THE NEGATIVE FIXTURE: at a
         tolerance of 5 a touch-count rule would report FOUR TOUCHES on a series that fits at
         R² 0.0847. So the verdict "no clean structure" has to rest on fit quality, not on how many
         pivots a generous tolerance can be made to swallow. */
      residualsAtPivots: [4, -5, -2, 3],
      touchesAtZeroTolerance: 0,
      /* The negative fixture's whole point, in one row: at a tolerance of 5 EIGHT bars count as
         touching a line that fits at R² 0.0847. A touch count can be made to say anything. */
      touchCountsByTolerance: { '0': 0, '0.5': 0, '1': 1, '1.5': 2, '5': 8 },
    },
  },
  {
    id: 'F4',
    title: 'flat double bottom: a tie, and a fit with zero price variance',
    claim: 'an equal neighbour does not disqualify a pivot, and a two-pivot plateau has no R²',
    ramp: 2,
    candles: build(22, F4_PIVOTS, 2),
    pivotLowIndices: [10, 11],
    pivotLowPrices: [100, 100],
    /* Empty, and it is an absence with a control: F1 has two pivot highs and F3 has four, through
       the same code path on the same shaped data. Both flanks here are monotone, so no interior bar
       can be a local high. */
    pivotHighIndices: [],
    pivotLowsAtStrength: { 2: [10, 11], 3: [10, 11], 4: [10, 11] },
    /* The discriminator. A strict comparison reports NOTHING here. */
    strictVariantPivotLows: [],
    fit: null,
  },
];

export const byId = (id: string): Fixture => {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
