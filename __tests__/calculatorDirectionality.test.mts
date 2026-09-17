import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

/* Antislop audit 001 (#1309) item 15 (AS-E) - the three trading calculators
 * scored a take-profit set on the LOSING side of entry as a winning trade,
 * and the funding-cost calculator had no way to express a short position at
 * all, so it always told the user they were paying when the rate was
 * positive - correct for a long, backwards for a short.
 *
 * REWRITTEN after Dev's actual fix landed (fix/audit-batch-e-calculator-
 * bugs, extraction commit cf6fcb72) - the original version of this file
 * (written before the fix, per PM/DevOps) assumed tpDist/rr/ev/rrRatio/
 * potentialPnL would become SIGNED (negative for a losing-side TP). That
 * is not what Dev built, and PM/DevOps's review of the pre-extraction
 * component already confirmed the actual shape is correct:
 *
 *   lib/riskReward.ts    calcRiskReward(entry, sl, tp, winRatePct): RRResult | null
 *     rr/ev/breakevenWR stay unsigned magnitudes (Math.abs distances, same
 *     as before) - RiskRewardCalc.tsx gates whether they're ever SHOWN
 *     behind the new `tpOnWrongSide` boolean (grep the component: lines
 *     114/130/157), rather than the pure function itself flipping sign.
 *     So the real contract is `tpOnWrongSide`, not a negative `rr`/`ev`.
 *
 *   lib/positionSizer.ts calcPositionSize(acc, riskPct, entry, stop, tp): PositionSizeResult | null
 *     Same shape, one step further: `rrRatio`/`potentialPnL` are simply
 *     never computed (stay `null`) when `tpOnWrongSide` is true, rather
 *     than computed-then-hidden.
 *
 *   lib/fundingCost.ts   calcFundingCost(posSize, fundingRate, hours): FundingCostResult | null
 *     Does NOT take a `side` parameter and does NOT return `isPaying` -
 *     stayed a pure position-agnostic magnitude calculator.
 *
 * Confirmed each of these against a scoped overlay of the real PR #1325
 * head before rewriting - not guessed from reading the diff alone.
 *
 * EXTENDED after PR #1331 (fix/funding-longs-neutral-ending-and-payer-
 * extraction, head 77e98c75): `isPaying` genuinely WAS UI-only derived
 * state at the time of the note above (`side === 'long' ? rate > 0 :
 * rate < 0`, inline in components/FundingCostCalc.tsx) - a unit test
 * couldn't import a one-line component-local expression, so item 15's
 * funding-direction fix was checked by reading the component's own source
 * for that exact shape instead. #1331 moved it out as a real export:
 *
 *   lib/fundingCost.ts   isFundingPaying(side, rate): boolean
 *     Same logic, same threshold, now directly callable - the source-scan
 *     fallback below is no longer needed for this and has been replaced
 *     with direct calls covering all 4 side x sign combinations.
 *   lib/fundingCost.ts   isHighFundingRateWarning(annualRate, isPaying): boolean
 *     `Math.abs(annualRate) > 50 && isPaying` - the calculator's high-rate
 *     warning only fires when the user is actually PAYING that rate, not
 *     receiving it. This is the specific bug PM/DevOps found on #1325's
 *     review (FundingCostCalc.tsx:159's old `annualRate > 50 && isPaying`
 *     never fired for a short paying a large NEGATIVE rate, since
 *     annualRate itself is negative there) - now directly testable.
 */

const libPath = (name: string) => '../lib/' + name + '.ts';
const riskReward: any    = await import(libPath('riskReward')).catch(() => null);
const positionSizer: any = await import(libPath('positionSizer')).catch(() => null);
const fundingCost: any   = await import(libPath('fundingCost')).catch(() => null);
const calcRiskReward    = riskReward?.calcRiskReward;
const calcPositionSize  = positionSizer?.calcPositionSize;
const calcFundingCost   = fundingCost?.calcFundingCost;
const isFundingPaying          = fundingCost?.isFundingPaying;
const isHighFundingRateWarning = fundingCost?.isHighFundingRateWarning;

const RISK_REWARD_SKIP    = calcRiskReward    ? false : 'lib/riskReward.ts does not exist yet';
const POSITION_SIZER_SKIP = calcPositionSize  ? false : 'lib/positionSizer.ts does not exist yet';
const FUNDING_COST_SKIP   = calcFundingCost   ? false : 'lib/fundingCost.ts does not exist yet';
const FUNDING_PAYER_SKIP  = isFundingPaying && isHighFundingRateWarning ? false :
  'lib/fundingCost.ts does not export isFundingPaying/isHighFundingRateWarning yet (PR #1331)';

test('RiskRewardCalc: a take-profit on the losing side of entry is flagged, not scored as reward', { skip: RISK_REWARD_SKIP }, async (t) => {
  await t.test('long (entry > sl): TP below entry (same side as the stop) is flagged tpOnWrongSide', () => {
    const r = calcRiskReward(100, 95, 90, 50);
    assert.ok(r, 'calcRiskReward() returned null for a well-formed input - this run measured nothing');
    assert.equal(r.tpOnWrongSide, true, 'a TP on the stop\'s own side must be flagged tpOnWrongSide');
  });

  await t.test('short (entry < sl): TP above entry (same side as the stop) is flagged tpOnWrongSide', () => {
    const r = calcRiskReward(100, 105, 110, 50);
    assert.ok(r);
    assert.equal(r.tpOnWrongSide, true, 'a TP on the stop\'s own side must be flagged tpOnWrongSide');
  });

  await t.test('sanity: a genuinely winning TP is not flagged, and still scores positive', () => {
    const r = calcRiskReward(100, 95, 110, 50); // long, TP above entry - a real win
    assert.ok(r);
    assert.equal(r.tpOnWrongSide, false, 'a real winning setup must not be flagged tpOnWrongSide');
    assert.ok(r.rr > 0, `rr was ${r.rr} - a real winning setup must still score positive`);
  });
});

test('PositionSizer: a take-profit on the losing side of entry scores no R or PnL at all', { skip: POSITION_SIZER_SKIP }, async (t) => {
  await t.test('long: TP below entry - flagged tpOnWrongSide, rrRatio/potentialPnL stay null', () => {
    const r = calcPositionSize(10_000, 1, 100, 95, 90);
    assert.ok(r, 'calcPositionSize() returned null for a well-formed input - this run measured nothing');
    assert.equal(r.tpOnWrongSide, true, 'a TP on the stop\'s own side must be flagged tpOnWrongSide');
    assert.equal(r.rrRatio, null, `rrRatio was ${r.rrRatio} - a losing-side TP must not be scored at all`);
    assert.equal(r.potentialPnL, null, `potentialPnL was ${r.potentialPnL} - a losing-side TP must not be scored at all`);
  });

  await t.test('short: TP above entry - flagged tpOnWrongSide, rrRatio/potentialPnL stay null', () => {
    const r = calcPositionSize(10_000, 1, 100, 105, 110);
    assert.ok(r);
    assert.equal(r.tpOnWrongSide, true, 'a TP on the stop\'s own side must be flagged tpOnWrongSide');
    assert.equal(r.rrRatio, null, `rrRatio was ${r.rrRatio} - a losing-side TP must not be scored at all`);
    assert.equal(r.potentialPnL, null, `potentialPnL was ${r.potentialPnL} - a losing-side TP must not be scored at all`);
  });

  await t.test('sanity: a genuinely winning TP is not flagged, and still scores positive', () => {
    const r = calcPositionSize(10_000, 1, 100, 95, 110);
    assert.ok(r);
    assert.equal(r.tpOnWrongSide, false, 'a real winning setup must not be flagged tpOnWrongSide');
    assert.ok(r.rrRatio !== null && r.rrRatio > 0, `rrRatio was ${r.rrRatio} - a real winning setup must still score positive`);
  });
});

test('FundingCostCalc: totalCost follows the rate\'s sign; isPaying (component-only) is side-aware', { skip: FUNDING_COST_SKIP }, async (t) => {
  await t.test('positive rate: totalCost is positive (unchanged from before the fix)', () => {
    const r = calcFundingCost(10_000, 0.01, 24);
    assert.ok(r, 'calcFundingCost() returned null for a well-formed input - this run measured nothing');
    assert.ok(r.totalCost > 0, `totalCost was ${r.totalCost} - a positive rate must produce a positive magnitude`);
  });

  await t.test('negative rate: totalCost is negative (the sign genuinely follows the rate, not a hardcoded side)', () => {
    const r = calcFundingCost(10_000, -0.01, 24);
    assert.ok(r);
    assert.ok(r.totalCost < 0, `totalCost was ${r.totalCost} - a negative rate must produce a negative magnitude`);
  });

  await t.test('components/FundingCostCalc.tsx computes isPaying from BOTH side and rate, not rate alone', () => {
    const componentPath = path.resolve(import.meta.dirname, '../components/FundingCostCalc.tsx');
    const src = readFileSync(componentPath, 'utf8');
    const isPayingLine = src.match(/isPaying\s*=\s*[^;]+;/)?.[0];
    assert.ok(isPayingLine, 'no `isPaying = ...` assignment found in FundingCostCalc.tsx at all - has this moved?');
    assert.match(isPayingLine, /side|isFundingPaying/,
      `isPaying is computed as "${isPayingLine}" - it doesn't reference \`side\` (or call isFundingPaying, which ` +
      'itself takes side) at all, so every user still sees the same "Paying"/"Receiving" verdict regardless of ' +
      'which position they hold (item 15\'s original bug)');
  });
});

test('isFundingPaying/isHighFundingRateWarning (PR #1331): all 4 side x sign cases, warning only fires while paying', { skip: FUNDING_PAYER_SKIP }, async (t) => {
  await t.test('long + positive rate: paying (the one case that already worked)', () => {
    assert.equal(isFundingPaying('long', 0.01), true);
  });
  await t.test('long + negative rate: receiving', () => {
    assert.equal(isFundingPaying('long', -0.01), false);
  });
  await t.test('short + positive rate: receiving (longs pay shorts)', () => {
    assert.equal(isFundingPaying('short', 0.01), false);
  });
  await t.test('short + negative rate: paying (shorts pay longs)', () => {
    assert.equal(isFundingPaying('short', -0.01), true);
  });

  await t.test('rate 0 counts as not paying, for either side', () => {
    assert.equal(isFundingPaying('long', 0), false, 'a long at a zero rate must not show as paying');
    assert.equal(isFundingPaying('short', 0), false, 'a short at a zero rate must not show as paying');
  });

  await t.test('warning fires for a short paying a large NEGATIVE annualRate', () => {
    // The exact bug PM/DevOps found on #1325's review: FundingCostCalc.tsx's
    // old `annualRate > 50 && isPaying` used a literal positive-only
    // comparison, so it never fired for a short (paying) at a negative
    // annualRate, exactly the case that matters most for a short.
    const isPaying = isFundingPaying('short', -1); // large negative rate -> short pays
    assert.equal(isPaying, true, 'sanity: a short at a negative rate must be paying');
    assert.equal(isHighFundingRateWarning(-80, isPaying), true,
      'a short paying a large negative annualRate (-80) must trigger the high-rate warning');
  });

  await t.test('warning does NOT fire for a short receiving a large POSITIVE annualRate', () => {
    const isPaying = isFundingPaying('short', 1); // large positive rate -> short receives
    assert.equal(isPaying, false, 'sanity: a short at a positive rate must be receiving');
    assert.equal(isHighFundingRateWarning(80, isPaying), false,
      'a short receiving a large positive annualRate (80) must NOT trigger the high-rate warning - receiving a ' +
      'windfall is not something to warn about');
  });

  await t.test('warning does NOT fire for a long receiving a large NEGATIVE annualRate', () => {
    const isPaying = isFundingPaying('long', -1); // large negative rate -> long receives
    assert.equal(isPaying, false, 'sanity: a long at a negative rate must be receiving');
    assert.equal(isHighFundingRateWarning(-80, isPaying), false,
      'a long receiving a large negative annualRate (-80) must NOT trigger the high-rate warning either - the ' +
      'warning must never fire while receiving, regardless of side');
  });

  await t.test('sanity: warning does not fire below the 50 threshold even while paying', () => {
    assert.equal(isHighFundingRateWarning(30, true), false, 'annualRate 30 is below the 50 threshold');
  });
});
