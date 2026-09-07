import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSqueezeScore, type CoinData } from '../lib/marketStore.ts';

/* TEST_GAPS.md §1: "Squeeze/flush boundaries - still open" named #952 (42
 * extensionless imports blocking direct `node --test` of lib/) as the
 * blocker. #952 closed and `marketStore.ts` no longer imports
 * `./healthGradeA11y` without an extension - checked directly, both the
 * issue state and the import are gone - so this is no longer blocked, just
 * previously unwritten. Pins `computeSqueezeScore`'s exact threshold values
 * (lib/marketStore.ts ~259-317) so a refactor that shifts one by a point
 * fails here instead of silently moving a coin across the Flush/Squeeze
 * label.
 *
 * ONE TRAP THIS FILE ALMOST FELL INTO, worth keeping visible: the L/S ratio
 * signal (`if (coin.longRatio != null && coin.shortRatio != null)`) requires
 * BOTH fields non-null to fire AT ALL - passing only `longRatio` produces
 * zero signal, not a degraded one. Every case below that exercises longRatio
 * or shortRatio sets the other to a low, non-triggering value rather than
 * leaving it null. Caught by checking every expected value against the real
 * function before writing the assertion, not by reasoning about the code. */

function baseCoin(overrides: Partial<CoinData> = {}): CoinData {
  return {
    price: 100, change: 0, high: 100, low: 100,
    fundingRate: null, oi: null, vol24: null, volRatio: null,
    longRatio: null, shortRatio: null,
    bnLongRatio: null, bnShortRatio: null,
    bnWhaleLongRatio: null, bnWhaleShortRatio: null,
    rsi14: null, ma20: null, perpPrice: null,
    rsi5m: null, rsi1h: null, rsi4h: null, rsiDaily: null, rsiWeekly: null, rsiMonthly: null,
    cvd: null, cvdDivergence: null,
    poc: null, vah: null, val: null,
    orderBidWalls: null, orderAskWalls: null,
    vwap: null, oiTrend: null,
    takerBuyRatio: null, chartPattern: null,
    nextFrEstimate: null, nextFundingTime: null,
    liqDelta: null, liqLongUsd: null, liqShortUsd: null,
    ...overrides,
  };
}

test('computeSqueezeScore', async (t) => {
  await t.test('no coin: NEUTRAL, score 0, "No data"', () => {
    const r = computeSqueezeScore(undefined);
    assert.deepEqual(r, { score: 0, dir: 'NEUTRAL', label: 'No data', color: 'var(--txt-dim)' });
  });

  await t.test('a single signal, however extreme, cannot label Flush/Squeeze - the >=2-signal gate', () => {
    // Funding alone at its highest tier (40 pts, 1 signal): real risk, but
    // the gate requires 2 independent sources before it will say so.
    const r = computeSqueezeScore(baseCoin({ fundingRate: 0.10 }));
    assert.equal(r.score, 40);
    assert.equal(r.dir, 'NEUTRAL', 'one signal must not produce a directional label');
    assert.equal(r.label, 'Balanced');
  });

  await t.test('funding rate: top-tier boundary (exact) vs. one tick below every tier', () => {
    const withRatio = (fr: number) => computeSqueezeScore(baseCoin({ fundingRate: fr, longRatio: 0.52, shortRatio: 0.1 }));

    const atTop = withRatio(0.0005); // fr = 0.05 exactly after *100
    assert.equal(atTop.dir, 'LONG_LIQ');
    assert.equal(atTop.score, 50); // 40 (funding top tier) + 10 (longRatio bottom tier)

    const belowEveryTier = withRatio(0.00009); // fr = 0.009, under the 0.01 floor
    assert.equal(belowEveryTier.dir, 'NEUTRAL', 'funding contributes nothing below its lowest tier - longRatio alone is one signal, gate fails');
    assert.equal(belowEveryTier.score, 10);
  });

  await t.test('shortRatio top-tier boundary (exact), paired with a weak taker signal', () => {
    const r = computeSqueezeScore(baseCoin({ shortRatio: 0.65, longRatio: 0.1, takerBuyRatio: 0.58 }));
    assert.equal(r.dir, 'SHORT_SQ');
    assert.equal(r.label, 'Short squeeze ↑');
    assert.equal(r.score, 48); // 40 (shortRatio top tier) + 8 (taker's WEAK short tier - 0.58 is not the 0.62 top tier)
  });

  await t.test('takerBuyRatio: top long tier (exact) vs. the weaker tier one step in', () => {
    const topTier = computeSqueezeScore(baseCoin({ takerBuyRatio: 0.38, longRatio: 0.52, shortRatio: 0.1 }));
    assert.equal(topTier.dir, 'LONG_LIQ');
    assert.equal(topTier.score, 25); // 15 (taker top) + 10 (longRatio bottom)

    const weakTier = computeSqueezeScore(baseCoin({ takerBuyRatio: 0.42, longRatio: 0.52, shortRatio: 0.1 }));
    assert.equal(weakTier.dir, 'LONG_LIQ');
    assert.equal(weakTier.score, 18); // 8 (taker weak tier) + 10 (longRatio bottom)
  });

  await t.test('volume bonus: gated on dominant risk already exceeding 10, amplifies rather than creates a signal', () => {
    const withBonus = computeSqueezeScore(baseCoin({ fundingRate: 0.0001, longRatio: 0.52, shortRatio: 0.1, volRatio: 2 }));
    const withoutBonus = computeSqueezeScore(baseCoin({ fundingRate: 0.0001, longRatio: 0.52, shortRatio: 0.1 }));
    assert.equal(withoutBonus.score, 20);   // 10 (funding) + 10 (longRatio), dominant=20
    assert.equal(withBonus.score, 40);      // dominant 20 > 10, volRatio>=2 adds +20
    assert.equal(withBonus.dir, 'LONG_LIQ');

    // A single 10-point signal: dominant=10, which is NOT > 10 - the bonus
    // gate itself fails, so volRatio changes nothing, and it stays NEUTRAL
    // regardless (one signal).
    const loneWeakSignal = computeSqueezeScore(baseCoin({ fundingRate: 0.0001, volRatio: 2 }));
    assert.equal(loneWeakSignal.score, 10, 'dominant=10 is not > 10, so the vol bonus gate does not fire');
    assert.equal(loneWeakSignal.dir, 'NEUTRAL');
  });

  await t.test('score is capped at 100', () => {
    const r = computeSqueezeScore(baseCoin({
      fundingRate: 0.10, longRatio: 0.90, shortRatio: 0.01, takerBuyRatio: 0.10, volRatio: 3,
    }));
    // 40 (funding) + 40 (longRatio) + 15 (taker) + 20 (vol bonus) = 115, capped to 100.
    assert.equal(r.score, 100);
    assert.equal(r.dir, 'LONG_LIQ');
  });
});
