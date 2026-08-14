/* #413 frame 1a - the evidence grid, and the one rule a colour audit cannot see.
 *
 * README:47: green and red appear ONLY where a signal is firing. The prototype
 * encodes it as a `fire` field per row, and six of its eight values are POSITIVE
 * NUMBERS rendered in --txt. Colouring those green looks better and is wrong,
 * and no contrast or token check catches it, because --green is a legal token.
 *
 * So these tests assert the thing that is otherwise unobservable: that a row
 * sitting in its normal range stays neutral even when its value is signed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidence, firingCount, mobileEvidence, FIRING } from '../lib/arenaEvidence.ts';
import type { CoinData } from '../lib/marketStore.ts';

/** A coin sitting in the middle of every range - nothing should fire. */
function quietCoin(over: Partial<CoinData> = {}): CoinData {
  return {
    price: 100, change: 0, high: 101, low: 99,
    fundingRate: 0.00005,          // well under the crowded threshold
    oi: 1_000_000, vol24: null, volRatio: null,
    longRatio: null, shortRatio: null,
    bnLongRatio: null, bnShortRatio: null,
    bnWhaleLongRatio: null, bnWhaleShortRatio: null,
    rsi14: null, ma20: null, perpPrice: 100,
    rsi5m: null, rsi1h: null, rsi4h: null,
    rsiDaily: null, rsiWeekly: null, rsiMonthly: null,
    cvd: 5, cvdDivergence: null,
    poc: null, vah: null, val: null,
    orderBidWalls: null, orderAskWalls: null,
    vwap: 100,                     // price exactly at VWAP
    oiTrend: 'weak_up',            // drift, not a signal
    takerBuyRatio: 0.52,           // inside the neutral band
    chartPattern: null,
    nextFrEstimate: null, nextFundingTime: null,
    liqDelta: null, liqLongUsd: 1_000_000, liqShortUsd: 1_000_000,  // balanced
    ...over,
  } as CoinData;
}

/* ── 1. the grid is always eight rows, in the frame's order ──────────────── */

test('the frame eight come first, in the frame order, then ours', () => {
  // The design draws 8 cells in a 4x2. That is the PATTERN, not a cap - the
  // owner's rule is to extend it to the data we actually have, in the same
  // cell design. So the grid is 4x3 and the frame's eight keep their order,
  // because the designed reading order is the part that is binding.
  const rows = buildEvidence({ coin: null });
  assert.deepEqual(rows.slice(0, 8).map(r => r.label), [
    'Funding 8h', 'CVD 4h', 'OI 1h', 'VWAP', 'CB prem', 'Taker buy', 'Basis', 'Liq 15m',
  ]);
  assert.deepEqual(rows.slice(8).map(r => r.label), [
    'RSI 14', 'MTF align', 'Volume', 'L/S ratio',
  ]);
  assert.equal(rows.length % 4, 0, 'the grid is 4 wide - a partial row leaves a hole');
  assert.ok(rows.every(r => r.value === null), 'no data must not invent values');
});

test('our added rows obey the same firing rule as the frame ones', () => {
  // Extending the design must not mean extending it with a looser rule.
  const quiet = buildEvidence({ coin: quietCoin({ rsi14: 52, rsi1h: 52, rsi4h: 48, rsiDaily: 51, volRatio: 1.0, longRatio: 50, shortRatio: 50 }) });
  for (const label of ['RSI 14', 'MTF align', 'Volume', 'L/S ratio']) {
    assert.equal(quiet.find(r => r.label === label)!.fire, null, `${label} fired in a quiet market`);
  }
  const hot = buildEvidence({ coin: quietCoin({ rsi14: 78, rsi1h: 61, rsi4h: 58, rsiDaily: 55, volRatio: 2.4, longRatio: 80, shortRatio: 20 }) });
  assert.equal(hot.find(r => r.label === 'RSI 14')!.fire,    'red',   'overbought is a warning, not an endorsement');
  assert.equal(hot.find(r => r.label === 'MTF align')!.fire, 'green');
  assert.equal(hot.find(r => r.label === 'Volume')!.fire,    'green');
  assert.equal(hot.find(r => r.label === 'L/S ratio')!.fire, 'red',   'a crowded long book is the setup, not the confirmation');
});

/* ── 2. THE RULE: signed values do not imply colour ──────────────────────── */

test('a quiet market fires NOTHING - the six-neutral case', () => {
  const rows = buildEvidence({ coin: quietCoin(), spotPrice: 100 });
  const { firing, neutral } = firingCount(rows);
  assert.equal(firing, 0, `expected nothing firing, got: ${rows.filter(r=>r.fire).map(r=>r.label)}`);
  assert.equal(neutral, rows.length);
});

test('positive values still render neutral when the signal is not firing', () => {
  // This is the whole point. Every one of these is a POSITIVE number and every
  // one must come back fire:null. A grid that colours them passes every colour
  // check we have and is still the wrong page.
  const rows = buildEvidence({
    coin: quietCoin({ takerBuyRatio: 0.55, vwap: 99.8, oiTrend: 'weak_up' }),
    spotPrice: 99.95,
    oiChange1h: 0.008,   // open interest up 0.8% - a real positive number, still only drift
  });
  for (const label of ['OI 1h', 'VWAP', 'Taker buy', 'Basis']) {
    const row = rows.find(r => r.label === label)!;
    // "reads favourable" rather than "starts with +": Taker buy is a share
    // (55%), not a signed change, which is how the frame renders it too (58%).
    assert.ok(row.value && !row.value.startsWith('−'),
      `${label} should read favourable in this fixture, got ${row.value}`);
    assert.equal(row.fire, null, `${label} fired on a favourable value that is inside its normal range`);
  }
});

/* ── 3. each signal fires on its own threshold, and in the right direction ─ */

test('crowded long funding is RED, not green - it is a cost signal', () => {
  // Positive funding means longs PAY shorts. Colouring it green because the
  // number is positive inverts the meaning. Same polarity as the funding
  // screen, README:131.
  const hot = buildEvidence({ coin: quietCoin({ fundingRate: FIRING.fundingAbs * 2 }) });
  assert.equal(hot.find(r => r.label === 'Funding 8h')!.fire, 'red');

  const inverted = buildEvidence({ coin: quietCoin({ fundingRate: -FIRING.fundingAbs * 2 }) });
  assert.equal(inverted.find(r => r.label === 'Funding 8h')!.fire, 'green');
});

test('CVD divergence maps straight onto fire - same idea, arrived at separately', () => {
  const bull = buildEvidence({ coin: quietCoin({ cvdDivergence: 'bullish' }) });
  const cvdBull = bull.find(r => r.label === 'CVD 4h')!;
  assert.equal(cvdBull.fire, 'green');
  assert.equal(cvdBull.value, 'Bull div');

  const bear = buildEvidence({ coin: quietCoin({ cvdDivergence: 'bearish' }) });
  assert.equal(bear.find(r => r.label === 'CVD 4h')!.fire, 'red');
});

test('OI drift does not fire; only a strong trend does', () => {
  const weak   = buildEvidence({ coin: quietCoin({ oiTrend: 'weak_up' }) });
  const strong = buildEvidence({ coin: quietCoin({ oiTrend: 'strong_up' }) });
  assert.equal(weak.find(r => r.label === 'OI 1h')!.fire, null);
  assert.equal(strong.find(r => r.label === 'OI 1h')!.fire, 'green');
});

test('basis fires red when perps are rich - leverage paying up, not a bullish tell', () => {
  const rows = buildEvidence({ coin: quietCoin({ perpPrice: 100.5 }), spotPrice: 100 });
  assert.equal(rows.find(r => r.label === 'Basis')!.fire, 'red');
});

test('a balanced liquidation window is neutral and says so', () => {
  const rows = buildEvidence({ coin: quietCoin() });
  const liq = rows.find(r => r.label === 'Liq 15m')!;
  assert.equal(liq.fire, null);
  assert.equal(liq.note, '50% longs');
});

test('an empty liquidation window is not a signal', () => {
  // Zero liquidations is quiet, not bullish. Dividing by the total here would
  // also be a divide-by-zero, which is the other reason to check it.
  const rows = buildEvidence({ coin: quietCoin({ liqLongUsd: 0, liqShortUsd: 0 }) });
  const liq = rows.find(r => r.label === 'Liq 15m')!;
  assert.equal(liq.fire, null);
  assert.equal(liq.value, 'None');
  assert.equal(liq.note, 'quiet window');
});

/* ── 4. the row we may have no source for ────────────────────────────────── */

test('CB prem with no source renders as absent, never as a stand-in', () => {
  const rows = buildEvidence({ coin: quietCoin() });
  const cb = rows.find(r => r.label === 'CB prem')!;
  assert.equal(cb.value, null);
  assert.equal(cb.fire, null);
});

/* ── 5. mobile is a different layout, not a narrower one ─────────────────── */

test('mobile shows only the firing rows - frame 1a mobile, header reads "2 FIRING"', () => {
  const rows = buildEvidence({
    coin: quietCoin({ fundingRate: FIRING.fundingAbs * 2, cvdDivergence: 'bullish' }),
  });
  const m = mobileEvidence(rows);
  assert.equal(m.length, 2);
  assert.deepEqual(m.map(r => r.label), ['Funding 8h', 'CVD 4h']);
});

test('mobile falls back to the full set when nothing fires', () => {
  // "0 FIRING" above an empty box is a worse answer than showing the data.
  const all = buildEvidence({ coin: quietCoin() });
  assert.equal(mobileEvidence(all).length, all.length);
});

/* ── 6. control ──────────────────────────────────────────────────────────── */

test('CONTROL: the grid can produce both fire values and null', () => {
  // Guards against a build where `fire` is hardcoded null - every assertion
  // about neutrality above would pass on a component that never colours
  // anything, which is the opposite failure and just as wrong.
  const rows = buildEvidence({
    coin: quietCoin({ fundingRate: FIRING.fundingAbs * 2, cvdDivergence: 'bullish' }),
  });
  const seen = new Set(rows.map(r => r.fire));
  assert.ok(seen.has('red'),   'nothing ever fires red - the rule is not wired');
  assert.ok(seen.has('green'), 'nothing ever fires green - the rule is not wired');
  assert.ok(seen.has(null),    'everything fires - the neutral case is gone');
});
