/* Coverage handoff from Dev under the new rule (owner ruling, 2026-09-07):
 * Dev derives and verifies against the library source, QA encodes and owns
 * the test. Derivation here is Dev's, independently re-confirmed by PM
 * against the same klinecharts source before being handed over - this file
 * encodes it, it does not re-derive it.
 *
 * smaNMArr(values, N, M) is klinecharts' own SMA(N,M), read out of
 * `simpleMovingAverage.calc` rather than assumed:
 *
 *   i === N-1   sma = mean of the first N values                (bootstrap)
 *   i >  N-1    sma = (value[i]*M + sma[i-1]*(N-M+1)) / (N+1)    (recursive)
 *
 * The recursive form is the whole point of this test. It is NOT the same
 * function as a plain moving average, and an implementation that is
 * algebraically correct but computed via the closed-form fraction instead of
 * the chained recursion will differ from the real one by floating-point
 * rounding - see the N=12,M=2 case below, where the two forms disagree in
 * the 15th significant digit. `smaArr` (this file's neighbour, a plain
 * N-period mean) already exists in lib/strategyCore.ts; smaNMArr is a
 * distinct function for a distinct klinecharts indicator and must not be
 * satisfied by reusing it.
 *
 * #1005 asks whether klinecharts' "SMA" is the right name for what this
 * computes - a naming question for the owner, not a reason to test something
 * other than what the function actually does. If the label changes, this
 * test does not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { smaNMArr } from '../lib/strategyCore.ts';

test('fewer than N values: every index is NaN', () => {
  const closes = [10, 20];
  const out = smaNMArr(closes, 3, 1);
  assert.equal(out.length, closes.length);
  for (const v of out) assert.ok(Number.isNaN(v));
});

test('N=3, M=1: bootstrap then the recursive step, closes [10,20,30,40,50,60]', () => {
  const closes = [10, 20, 30, 40, 50, 60];
  const out = smaNMArr(closes, 3, 1);

  for (let i = 0; i < 2; i++) assert.ok(Number.isNaN(out[i]), `index ${i} should be NaN`);

  assert.equal(out[2], 20);      // bootstrap: mean(10,20,30)
  assert.equal(out[3], 25);      // (40*1 + 20*3) / 4
  assert.equal(out[4], 31.25);   // (50*1 + 25*3) / 4
  assert.equal(out[5], 38.4375); // (60*1 + 31.25*3) / 4
});

test('N=12, M=2: the registry default, and the chained-vs-closed-form trap', () => {
  const closes = [...Array(12).fill(100), 112, 100];
  const out = smaNMArr(closes, 12, 2);

  for (let i = 0; i < 11; i++) assert.ok(Number.isNaN(out[i]), `index ${i} should be NaN`);

  assert.equal(out[11], 100); // bootstrap: mean of twelve 100s

  // index 12: (112*2 + 100*11) / 13
  const sma12 = (112 * 2 + 100 * 11) / 13;
  assert.equal(out[12], sma12);
  assert.equal(sma12, 1324 / 13);

  /* index 13 is the trap. The implementation must feed its own prior
   * computed value (sma12 as a float) back into the recursion - matching
   * what a real, stateful SMA(N,M) does - not recompute from the tidy
   * closed-form fraction. The two are algebraically equal and numerically
   * different by 1 ULP:
   *
   *   chained:      (100*2 + sma12*11) / 13  = 101.56213017751477
   *   closed form:  17164/169                = 101.56213017751479
   *
   * Asserting the closed form here would fail against a correct,
   * recursively-implemented function - this is the one place a "simpler"
   * expected value would be the wrong one. */
  const chained = (100 * 2 + sma12 * 11) / 13;
  const closedForm = 17164 / 169;
  assert.notEqual(chained, closedForm, 'the trap stopped existing - re-check the derivation, not this test');
  assert.equal(out[13], chained);
});
