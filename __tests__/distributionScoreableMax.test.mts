/* lib/distribution.ts's `scoreableMax` and the gate that uses it (#673).
 *
 * The Telegram alert compared a partial score against a fixed 70 - a bar set
 * for a complete score. Because every branch in the scorer ADDS and none
 * subtract, that could only ever suppress true alerts, never create false
 * ones, which is the failure that leaves no trace: a missed alert and a quiet
 * market are the same observation.
 *
 * Tested here rather than reasoned about, because the last piece of gate logic
 * that shipped on reasoning alone (lib/pool.ts's rate-limit stop, #667) turned
 * out to be untestable by construction and nobody could have known.
 *
 * No network, no DB - computeDistributionScore is a pure function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDistributionScore, type DistributionInputs } from '../lib/distribution.ts';

/** Every input present and every section at its maximum. */
const FULL: DistributionInputs = {
  change24hPct:   5,          // clears MIN_RUNUP_PCT
  cvdDivergence:  'bearish',  // 25
  takerBuyRatio:  0.35,       // 15, and enables the vol pair
  oiTrend:        'weak_up',  // 20
  whaleLongRatio: 0.40,       // 15
  fundingRatePct: 0.05,       // 15
  volRatio:       2,          // 10 with takerBuyRatio <= 0.48
  priceBelowVwap: true,       // 5
};

test('with every input present, scoreableMax is 100 and the gate is the old fixed 70', () => {
  const res = computeDistributionScore(FULL);
  assert.ok(res);
  assert.equal(res.scoreableMax, 100);
  assert.equal(res.scoreableMax * 0.70, 70,
    'at full data the scaled gate must equal the constant it replaced, or this is a behaviour change rather than a fix');
});

test('the section maxima sum past the cap, so losing VWAP alone changes nothing', () => {
  /* 25+15+20+15+15+10+5 = 105 against a cap of 100. That 5 points of headroom
     is why this defect was invisible: the Telegram caller has passed
     priceBelowVwap: null since it was written and was still scoring out of a
     true 100. #673 as first filed said 95, and that was wrong. */
  const res = computeDistributionScore({ ...FULL, priceBelowVwap: null });
  assert.ok(res);
  assert.equal(res.scoreableMax, 100);
});

test('the gate only moves once a second input drops', () => {
  const res = computeDistributionScore({ ...FULL, priceBelowVwap: null, whaleLongRatio: null });
  assert.ok(res);
  assert.equal(res.scoreableMax, 85, '105 - 5 (vwap) - 15 (whale) = 85');
  assert.equal(Number((res.scoreableMax * 0.70).toFixed(1)), 59.5);
});

test('a score the fixed 70 would swallow clears the scaled gate', () => {
  /* THE CASE THE ISSUE IS ABOUT. lsr down and no VWAP, so scoreableMax is 85,
     and this coin fires three of its five reachable sections: cvd 25 + taker 15
     + oi 20 = 60. Sixty is 71% of what was scoreable and would have been a
     clear Distribution on full data - and the fixed gate never sees it.

     My first version of this test used FULL minus two inputs and asserted the
     score fell short of 70. It scores 85, because every remaining section is at
     maximum, so the fixed gate WOULD have fired. The test caught that; the
     swallowed case needs a coin that is distributing without maxing everything,
     which is what a real one looks like. */
  const res = computeDistributionScore({
    ...FULL,
    priceBelowVwap: null,   // server-side caller never has it
    whaleLongRatio: null,   // lsr unavailable
    fundingRatePct: 0,      // a real reading, below the +0.01 tier - scores 0
    volRatio:       1.0,    // below the 1.5 spike tier - the pair scores 0
  });
  assert.ok(res);
  assert.equal(res.scoreableMax, 85, 'funding and volRatio are PRESENT but unscoring - still reachable points');
  assert.equal(res.score, 60, 'cvd 25 + taker 15 + oi 20');
  assert.ok(res.score < 70, 'the fixed gate swallows it');
  assert.ok(res.score >= res.scoreableMax * 0.70,
    `${res.score} must clear the scaled gate ${(res.scoreableMax * 0.70).toFixed(1)}`);
});

test('the vol-pair section needs BOTH of its inputs', () => {
  const noVol   = computeDistributionScore({ ...FULL, volRatio: null });
  const noTaker = computeDistributionScore({ ...FULL, takerBuyRatio: null });
  assert.ok(noVol && noTaker);
  assert.equal(noVol.scoreableMax, 95, 'losing volRatio costs the 10-point pair: 105 - 10, capped at 100 -> 95');
  /* takerBuyRatio gates its own 15 AND the 10-point pair: 105 - 15 - 10 = 80. */
  assert.equal(noTaker.scoreableMax, 80);
});

test('scoreableMax never exceeds 100 and never goes negative', () => {
  const empty: DistributionInputs = {
    change24hPct: 5, cvdDivergence: null, takerBuyRatio: null, oiTrend: null,
    whaleLongRatio: null, fundingRatePct: null, volRatio: null, priceBelowVwap: null,
  };
  const res = computeDistributionScore(empty);
  assert.ok(res);
  assert.equal(res.scoreableMax, 0, 'no scoreable input means nothing could have been scored');
  assert.equal(res.score, 0);
  /* AND THIS IS WHY THE CALLER NEEDS A FLOOR. `0 >= 0 * 0.70` is true, so
     scaling ALONE would let a coin with no data through - something the fixed
     `< 70` blocked for free. Writing this assertion is what found it.
     app/api/telegram/alert/route.ts requires scoreableMax >= 60 before it
     applies the ratio, so this case is rejected on the first condition. */
  assert.ok(res.score >= res.scoreableMax * 0.70,
    'the ratio alone passes a no-data score - the caller must gate on scoreableMax first');
  assert.ok(res.scoreableMax < 60, 'and the caller floor of 60 is what rejects it');
});

test('the scorer is still additive-only, which is what makes the score a floor', () => {
  /* Every claim above depends on it, and #672's tooltip states it to users.
     A future penalty branch invalidates both silently. */
  const partial = computeDistributionScore({ ...FULL, whaleLongRatio: null });
  const full    = computeDistributionScore(FULL);
  assert.ok(partial && full);
  assert.ok(partial.score <= full.score,
    'removing an input raised the score - the scorer has gained a subtraction and the "floor" claim is now false');
});
