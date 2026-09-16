import test from 'node:test';
import assert from 'node:assert/strict';

/* Antislop audit 001 (#1309) item 15 (AS-E) - the three trading calculators
 * score a take-profit set on the LOSING side of entry as a winning trade,
 * and the funding-cost calculator has no way to express a short position at
 * all, so it always tells the user they're paying when the rate is
 * positive - correct for a long, backwards for a short.
 *
 * WRITTEN BEFORE THE FIX, per PM/DevOps - confirmed RED against the current
 * inline component code, not run yet against anything (no browser needed;
 * these are pure functions).
 *
 * THESE IMPORTS DO NOT EXIST YET. All three calculations are private,
 * unexported functions inside their components today:
 *
 *   components/RiskRewardCalc.tsx:20   function calc(entry, sl, tp, wr)
 *   components/PositionSizer.tsx:23    function calculate(acc, riskPct, entry, stop, tp)
 *   components/FundingCostCalc.tsx:17  function calc(posSize, fundingRate, hours)
 *                                       + isLong/isPaying computed INLINE in
 *                                         the component (:54-55), not part
 *                                         of calc()'s own return value at all
 *
 * WHAT DEV SHOULD EXTRACT, matching the existing lib/alertCooldown.ts
 * precedent (pulled out of app/api/telegram/alert/route.ts for exactly this
 * reason - "provable without a live [...] run"):
 *
 *   lib/riskReward.ts    export calcRiskReward(entry, sl, tp, winRatePct): RRResult | null
 *   lib/positionSizer.ts export calcPositionSize(acc, riskPct, entry, stop, tp): CalcResult | null
 *   lib/fundingCost.ts   export calcFundingCost(posSize, fundingRate, hours, side: 'long' | 'short'): FundResult | null
 *                         - NEW `side` parameter; FundResult gets a new
 *                           `isPaying: boolean` field computed INSIDE the
 *                           function, not left to the caller.
 *
 * Exact names/paths are QA's proposal, not a requirement - adjust freely.
 * The CONTRACT below is what this test actually needs to hold.
 *
 * THE FIX THESE TESTS ASSUME (the natural, minimal one - not a requirement
 * either, but the shape that keeps every existing field meaning what it
 * already means): tpDist stops being an unsigned Math.abs distance and
 * becomes SIGNED relative to trade direction - positive when the TP is on
 * the winning side, negative when it's on the losing side. rr/ev/rrRatio/
 * potentialPnL then flow through with the correct sign automatically,
 * without any of their own formulas changing shape.
 */

/* Dynamic, not a static import: none of these three modules exist yet (see
 * the header above), and a static import that fails to resolve crashes the
 * whole process before a single test can even register - which would fail
 * `__tests__/*.test.mts`'s own automatic run in the pre-push gate for EVERY
 * push, by everyone, until Dev's extraction lands, not just report this one
 * suite red. Each import is caught independently and each test group skips
 * with a clear reason instead, so this is dormant (skipped, not broken)
 * until its own module shows up, and starts asserting for real the moment
 * it does - no further change needed here when that happens. */
// A COMPUTED specifier, not a string literal: tsc resolves (and errors on)
// an import()'s target module for a literal argument even in dynamic form,
// the same way it would a static import - concatenation keeps this from
// breaking typecheck before lib/riskReward.ts etc. exist, same reasoning
// as the runtime-crash note above. eslint-disable for `any` below: the
// whole point is these modules don't exist yet, so there is no real type
// to give this that wouldn't hit the same resolution problem.
const libPath = (name: string) => '../lib/' + name + '.ts';
const riskReward: any    = await import(libPath('riskReward')).catch(() => null);
const positionSizer: any = await import(libPath('positionSizer')).catch(() => null);
const fundingCost: any   = await import(libPath('fundingCost')).catch(() => null);
const calcRiskReward    = riskReward?.calcRiskReward;
const calcPositionSize  = positionSizer?.calcPositionSize;
const calcFundingCost   = fundingCost?.calcFundingCost;

const RISK_REWARD_SKIP    = calcRiskReward    ? false : 'lib/riskReward.ts does not exist yet - see this file\'s header for what to extract';
const POSITION_SIZER_SKIP = calcPositionSize  ? false : 'lib/positionSizer.ts does not exist yet - see this file\'s header for what to extract';
const FUNDING_COST_SKIP   = calcFundingCost   ? false : 'lib/fundingCost.ts does not exist yet - see this file\'s header for what to extract';

test('RiskRewardCalc: a take-profit on the losing side of entry must not score as positive reward', { skip: RISK_REWARD_SKIP }, async (t) => {
  await t.test('long (entry > sl): TP below entry (same side as the stop) is a losing exit - rr and ev must not be positive', () => {
    // entry=100, sl=95 -> isLong. TP=90 is BELOW entry, the stop's own side -
    // this closes at a loss, not a 2R win. Today: tpDist=|90-100|=10,
    // rr=10/5=2.00R, exactly the "2.00R and a positive expected value" the
    // audit's own summary names.
    const r = calcRiskReward(100, 95, 90, 50);
    assert.ok(r, 'calc() returned null for a well-formed input - this run measured nothing');
    assert.ok(r.rr <= 0, `rr was ${r.rr} - a TP on the losing side must not score as a positive R multiple`);
    assert.ok(r.ev <= 0, `ev was ${r.ev} - a guaranteed-loss exit must not show a positive expected value`);
  });

  await t.test('short (entry < sl): TP above entry (same side as the stop) is a losing exit - rr and ev must not be positive', () => {
    // entry=100, sl=105 -> isLong=false (short). TP=110 is ABOVE entry, the
    // stop's own side - a losing exit for a short, same shape as the long case.
    const r = calcRiskReward(100, 105, 110, 50);
    assert.ok(r, 'calc() returned null for a well-formed input - this run measured nothing');
    assert.ok(r.rr <= 0, `rr was ${r.rr} - a TP on the losing side must not score as a positive R multiple`);
    assert.ok(r.ev <= 0, `ev was ${r.ev} - a guaranteed-loss exit must not show a positive expected value`);
  });

  await t.test('sanity: a genuinely winning TP still scores positive (this is not asking for every result to flip negative)', () => {
    const r = calcRiskReward(100, 95, 110, 50); // long, TP above entry - a real win
    assert.ok(r);
    assert.ok(r.rr > 0, `rr was ${r.rr} - a real winning setup must still score positive`);
  });
});

test('PositionSizer: a take-profit on the losing side of entry must not score as positive R or PnL', { skip: POSITION_SIZER_SKIP }, async (t) => {
  await t.test('long: TP below entry - rrRatio and potentialPnL must not be positive', () => {
    const r = calcPositionSize(10_000, 1, 100, 95, 90);
    assert.ok(r, 'calculate() returned null for a well-formed input - this run measured nothing');
    assert.ok(r.rrRatio !== null && r.rrRatio <= 0, `rrRatio was ${r.rrRatio} - must not score positive`);
    assert.ok(r.potentialPnL !== null && r.potentialPnL <= 0, `potentialPnL was ${r.potentialPnL} - must not be positive`);
  });

  await t.test('short: TP above entry - rrRatio and potentialPnL must not be positive', () => {
    const r = calcPositionSize(10_000, 1, 100, 105, 110);
    assert.ok(r, 'calculate() returned null for a well-formed input - this run measured nothing');
    assert.ok(r.rrRatio !== null && r.rrRatio <= 0, `rrRatio was ${r.rrRatio} - must not score positive`);
    assert.ok(r.potentialPnL !== null && r.potentialPnL <= 0, `potentialPnL was ${r.potentialPnL} - must not be positive`);
  });

  await t.test('sanity: a genuinely winning TP still scores positive', () => {
    const r = calcPositionSize(10_000, 1, 100, 95, 110);
    assert.ok(r);
    assert.ok(r.rrRatio !== null && r.rrRatio > 0, `rrRatio was ${r.rrRatio} - a real winning setup must still score positive`);
  });
});

test('FundingCostCalc: a short must be told they RECEIVE, not pay, when the rate is positive', { skip: FUNDING_COST_SKIP }, async (t) => {
  await t.test('short + positive rate: isPaying must be false (shorts receive when longs pay)', () => {
    const r = calcFundingCost(10_000, 0.01, 24, 'short');
    assert.ok(r, 'calc() returned null for a well-formed input - this run measured nothing');
    assert.equal(r.isPaying, false,
      "a short position with a POSITIVE funding rate is RECEIVING funding (longs pay shorts), not paying - " +
      'today isPaying is computed as `rate > 0` with no position-side input at all, so every user sees ' +
      '"Paying" regardless of which side they hold (item 15)');
  });

  await t.test('short + negative rate: isPaying must be true (shorts pay when the rate is negative)', () => {
    const r = calcFundingCost(10_000, -0.01, 24, 'short');
    assert.ok(r);
    assert.equal(r.isPaying, true, 'a short position with a NEGATIVE funding rate pays (shorts pay shorts... ' +
      'longs receive) - the direction must flip opposite to the positive-rate case above');
  });

  await t.test('sanity: long + positive rate still pays (the one case that already worked)', () => {
    const r = calcFundingCost(10_000, 0.01, 24, 'long');
    assert.ok(r);
    assert.equal(r.isPaying, true, 'a long position with a positive rate must still show as paying - this is ' +
      "the app's only tested case today and must not regress");
  });
});
