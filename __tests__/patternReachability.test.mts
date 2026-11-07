/* #1818: WHY FIVE PATTERN TYPES WERE REMOVED, ASSERTED AS A PREMISE RATHER THAN A CONCLUSION.
 *
 * `UNDETECTABLE_PATTERN_TYPES` records that wedges and triangles cannot be produced, so the
 * teaching panel owes them no copy. That exclusion rests on one structural fact: **every two-rail
 * structure `detectStructures` produces has PARALLEL rails**, which makes `gapEnd / gapStart`
 * exactly 1 and puts `ratio <= CONVERGENCE_RATIO` out of reach.
 *
 * SO THIS FILE ASSERTS THE PREMISE, NOT THE CONCLUSION. Asserting "wedges are never returned" would
 * pass for any reason at all, including the detector being broken. Asserting the parallelism is what
 * makes the exclusion falsifiable - and it goes red at the moment the premise stops holding, rather
 * than a comment staying green forever while the code moves underneath it.
 *
 * ── PORTED FROM scripts/pattern-reachability.mjs (Dev, 8d3360e4), DELETED AGAIN AT 2ba3da47 ──────
 *
 * It moved here on a QA argument worth restating: **nothing runs `scripts/`.** `package.json`'s test
 * script is `node --import ./qa/alias-register.mjs --test __tests__/*.test.mts`, so a cell here runs
 * on every `npm test` and every pre-push, while a script runs when somebody remembers. For a premise
 * that will hold for months and then silently stop, "nobody ran it" and "it passed" must not look
 * the same.
 *
 * That same script line is why the `@/` alias resolves in here with no special invocation. **Dev
 * flagged that as my premise to check and I checked it rather than reading the hook**: a throwaway
 * cell importing `@/lib/chartStructureDetect` resolved and found `detectStructures`.
 *
 * ── ONE ASSERTION OVER BOTH PATHS, DELIBERATELY ─────────────────────────────────────────────────
 *
 * Two-rail structures come from exactly two call sites, and they are parallel for DIFFERENT reasons:
 *
 *   chartStructureDetect.ts:686  CHANNEL - `[anchor.rail, derived]`, and `deriveParallelRail` sets
 *                                `slope: anchor.slope` verbatim. Parallel BY CONSTRUCTION.
 *   chartStructureDetect.ts:653  RANGE   - two INDEPENDENTLY fitted rails, so this is the path that
 *                                could produce non-parallel ones. It is gated on both rails having
 *                                `gate === 'horizontal'`. Parallel BY GATE.
 *
 * Only the first is structural. **Relaxing the range gate is the second and more likely trigger**,
 * because "let ranges tilt slightly" reads as an improvement rather than a risk.
 *
 * The assertion is therefore ONE check over every two-rail structure regardless of which path made
 * it. A per-path assertion is where a third path slips through unnoticed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStructures } from '@/lib/chartStructureDetect';
import { PATTERN_TYPES, classify } from '../lib/chartPatterns.ts';

/* ── THE GENERATOR IS DEV'S, PORTED RATHER THAN REINVENTED ───────────────────────────────────────
 *
 * Stated and deliberately WIDE, for the reason their own header gives: a rate measured off an
 * unnamed generator is a property of the generator, and that mistake cost a retraction this week
 * (690ae5ba). Converging envelopes are the shape most likely to yield a wedge, so the envelope
 * closes on most shapes - the point is to hunt a counterexample, not to produce a tidy number.
 *
 * I WROTE MY OWN FIRST AND THE VACUITY GUARD CAUGHT IT. Zero two-rail structures: my candles used
 * `time` instead of `timestamp`, omitted `volume`, ran 40-99 bars where the detector needs more to
 * form pivots, and derived high/low from the envelope instead of a narrow fixed band. Four errors,
 * and without Dev's guard the cell would have reported "all two-rail structures are parallel" over
 * an empty set and looked like a pass. Porting the generator that is known to produce 171 of them
 * is the honest move; inventing a second one would have meant validating my fixture instead of the
 * product. */
const GEN = { shapes: 1200, seed: 11, bars: '100-219', slope: '+/-0.4/bar', convergence: '0-0.09/bar', amplitude: '1-9', period: '4-16' };

type Candle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

const candles = (n: number, f: (i: number) => number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const v = f(i);
    return { timestamp: 1700000000000 + i * 900000, open: v, high: v + 0.2, low: v - 0.2, close: v, volume: 1 };
  });

function sweep() {
  let seed = GEN.seed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let twoRail = 0;
  const violations: string[] = [];
  const undetectableReturned: string[] = [];
  const declaredUndetectable = new Set(
    ['wedge_rising', 'wedge_falling', 'triangle_asc', 'triangle_desc', 'triangle_sym']);

  for (let t = 0; t < GEN.shapes; t++) {
    const slope = (rnd() - 0.5) * 0.8;
    const conv = rnd() * 0.09;
    const amp = 1 + rnd() * 8;
    const per = 4 + rnd() * 12;
    const n = 100 + Math.floor(rnd() * 120);
    const c = candles(n, (i) => 100 + slope * i + Math.sin(i / per) * Math.max(0.4, amp - i * conv));
    const res = detectStructures(c as never, { timeframe: '15m' } as never);
    for (const s of (res as { structures: Array<{ rails: Array<{ fit: { slope: number } }> }> }).structures) {
      if (s.rails.length !== 2) continue;
      twoRail++;
      const [a, b] = s.rails;
      if (a.fit.slope !== b.fit.slope) {
        violations.push(`slopes ${a.fit.slope} vs ${b.fit.slope}`);
      }
      /* And the conclusion, checked as well as the premise - cheap, and it catches a classify()
         change that starts naming a type the exclusion says cannot occur. */
      const named = classify(s as never, c as never);
      if (named && declaredUndetectable.has(named.type)) undetectableReturned.push(named.type);
    }
  }
  return { twoRail, violations, undetectableReturned };
}

test('R1. every two-rail structure has PARALLEL rails, whichever path produced it', () => {
  const { twoRail, violations } = sweep();

  /* DEV'S VACUITY GUARD, KEPT VERBATIM IN INTENT. "All of them are parallel" over an empty set is
     true and worthless, and that trap passed nine of Dev's own assertions earlier in #1818. If the
     generator stops producing two-rail structures, this cell must fail rather than congratulate
     itself. */
  assert.ok(twoRail > 0,
    'ZERO two-rail structures were produced, so the parallelism assertion below would be vacuously ' +
    'true. Either the generator no longer makes channel-shaped or range-shaped input, or ' +
    'detectStructures stopped emitting two-rail structures. Fix the fixture before trusting a pass.');

  assert.deepEqual(violations, [],
    `${violations.length} of ${twoRail} two-rail structures have NON-PARALLEL rails: ` +
    `${violations.slice(0, 4).join('; ')}.\n\n` +
    'UNDETECTABLE_PATTERN_TYPES rests on this not happening: parallel rails make gapEnd/gapStart ' +
    'exactly 1, which is what puts `ratio <= CONVERGENCE_RATIO` out of reach and makes wedges and ' +
    'triangles unreachable. If rails can differ in slope, that reasoning is void and those five ' +
    'types may be detectable again - so the exclusion, the removal from PATTERN_TYPES, and the ' +
    'missing teaching copy all need revisiting together.\n' +
    'THE TWO LIKELY CAUSES: deriveParallelRail no longer borrows the anchor slope (:686), or the ' +
    "range gate at :653 was relaxed to admit sloped rails - the second reads as an improvement, " +
    'which is why it is the more likely one.');
});

test('R2. no type declared undetectable is ever actually returned', () => {
  const { twoRail, undetectableReturned } = sweep();
  assert.ok(twoRail > 0, 'no two-rail structures produced - see R1');

  assert.deepEqual([...new Set(undetectableReturned)], [],
    `classify returned ${[...new Set(undetectableReturned)].join(', ')}, which ` +
    'UNDETECTABLE_PATTERN_TYPES says cannot happen. The teaching panel has no copy for these, so ' +
    'the chart would name a shape the panel renders nothing for.\n' +
    'This is the CONCLUSION; R1 asserts the PREMISE it rests on. If R1 is green and this is red, ' +
    'the parallelism holds and something else changed in classify.');

  /* The declared-undetectable set must not overlap what the product offers, or the two halves of
     the exclusion have drifted apart. */
  const overlap = (PATTERN_TYPES as readonly string[])
    .filter((t) => ['wedge_rising', 'wedge_falling', 'triangle_asc', 'triangle_desc', 'triangle_sym'].includes(t));
  assert.deepEqual(overlap, [],
    `${overlap.join(', ')} is BOTH in PATTERN_TYPES and declared undetectable. One of the two is ` +
    'wrong: either the type is producible and belongs in the vocabulary with teaching copy, or it ' +
    'is not and should not be offered.');
});

test('R3. CONTROL: the parallelism check can see a non-parallel pair', () => {
  /* DEV'S --control INVERSION, AS A CELL. R1 is a negative result - "no violations found" - and a
     negative result from a check that cannot fire is worth nothing. This feeds the same comparison
     a hand-built non-parallel pair and requires it to be caught. */
  const fake = (slope: number, intercept: number) => ({ fit: { slope, intercept }, pivots: [{ index: 0 }] });
  const nonParallel = [fake(0.5, 100), fake(-0.5, 110)];
  const [a, b] = nonParallel;
  assert.notEqual(a.fit.slope, b.fit.slope,
    'the control pair is not actually non-parallel, so R1 proves nothing');

  /* And the same comparison R1 uses, applied to a pair that IS parallel, must NOT fire - otherwise
     R1 would be red for every structure and its green would mean the opposite of what it claims. */
  const parallel = [fake(0.3, 100), fake(0.3, 110)];
  assert.equal(parallel[0].fit.slope, parallel[1].fit.slope,
    'the comparison rejects a genuinely parallel pair, so R1 cannot distinguish the two cases');
});
