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
 *     unlike the two above, this one stayed a pure position-agnostic
 *     magnitude calculator. `isPaying` is genuinely UI-only derived state
 *     in components/FundingCostCalc.tsx (`side === 'long' ? rate > 0 :
 *     rate < 0`, ~line 43) - it depends on `side`, a piece of component
 *     state this pure function was never given and doesn't need, not on
 *     anything `calcFundingCost` computes. A unit test can't import a
 *     one-line component-local expression, so item 15's funding-direction
 *     fix is checked below by reading the component's own source for that
 *     exact fixed shape (same technique as the wording-batch tests'
 *     banned-phrase scan) rather than by calling `calcFundingCost` with a
 *     `side` it was never meant to accept.
 *
 * Confirmed each of these against a scoped overlay of the real PR #1325
 * head before rewriting - not guessed from reading the diff alone.
 */

const libPath = (name: string) => '../lib/' + name + '.ts';
const riskReward: any    = await import(libPath('riskReward')).catch(() => null);
const positionSizer: any = await import(libPath('positionSizer')).catch(() => null);
const fundingCost: any   = await import(libPath('fundingCost')).catch(() => null);
const calcRiskReward    = riskReward?.calcRiskReward;
const calcPositionSize  = positionSizer?.calcPositionSize;
const calcFundingCost   = fundingCost?.calcFundingCost;

const RISK_REWARD_SKIP    = calcRiskReward    ? false : 'lib/riskReward.ts does not exist yet';
const POSITION_SIZER_SKIP = calcPositionSize  ? false : 'lib/positionSizer.ts does not exist yet';
const FUNDING_COST_SKIP   = calcFundingCost   ? false : 'lib/fundingCost.ts does not exist yet';

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
    assert.match(isPayingLine, /side/,
      `isPaying is computed as "${isPayingLine}" - it doesn't reference \`side\` at all, so every user still sees ` +
      'the same "Paying"/"Receiving" verdict regardless of which position they hold (item 15\'s original bug)');
  });
});
