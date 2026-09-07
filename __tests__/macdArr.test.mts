/* Coverage handoff from Dev under the new rule (owner ruling, 2026-09-07):
 * Dev derives and verifies against the library source, QA encodes and owns
 * the test. Derivation here is Dev's, independently re-run by QA against
 * this branch's actual lib/strategyCore.ts (standalone Node port, executed,
 * not eyeballed) AND cross-checked against klinecharts'
 * movingAverageConvergenceDivergence.calc directly - this file encodes it,
 * it does not re-derive it.
 *
 * macdArr(closes, fastPeriod=12, slowPeriod=26, signalPeriod=9):
 *
 *   emaShort[i] = SMA(fastPeriod, 2) of closes   (bootstrap: mean of first N)
 *   emaLong[i]  = SMA(slowPeriod, 2) of closes    (same recursion, M=2 hardcoded)
 *   dif[i]      = emaShort[i] - emaLong[i]                    (once both exist)
 *   dea[i]      = SMA(signalPeriod, 2) of the dif series       (once dif exists)
 *   macd[i]     = (dif[i] - dea[i]) * 2
 *
 * Returns `Array<{dif,dea,macd}|null>` - null per index until `dea` exists.
 * klinecharts itself has a dif-only window between `maxPeriod-1` and
 * `maxPeriod+signalPeriod-2` where an entry carries `dif` but not
 * `dea`/`macd` - not exposed here as a distinct state, since every consumer
 * needs both dif and dea to compare (same reasoning as bollingerBandsArr's
 * null-not-NaN shape).
 *
 * NOT composed from smaNMArr, even though emaShort/emaLong are that exact
 * SMA(N,2) recursion - dea applies the same recursion to the dif series,
 * which does not exist for the first maxPeriod-1 bars. Composing via
 * smaNMArr(difArray, signalPeriod, 2) would feed its bootstrap a slice
 * containing those leading gaps and corrupt the sum; this port matches
 * klinecharts' own running `difSum` (which only starts accumulating once
 * `dif` does) rather than papering over the gap with a slice.
 *
 * WORTH KNOWING, not this file's business to enforce: MACD's fast line
 * (SMA(12,2) of closes) is numerically identical to SMA's own registry
 * default. Selecting both SMA and MACD gates the verdict on one signal
 * doubled, not two independent ones (#1007) - already noted in the registry
 * entry and useEMAStrategy's own comment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { macdArr } from '../lib/strategyCore.ts';

test('empty input: empty output, no throw', () => {
  assert.deepEqual(macdArr([]), []);
});

test('fast=2, slow=3, signal=2, linear ramp closes=[1..8]: constant lag converges to dif=0.5, dea=0.5, macd=0', () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = macdArr(closes, 2, 3, 2);

  // dif-only window (maxPeriod-1=2) hasn't reached dea readiness
  // (maxPeriod+signal-2=3) until index 3 - null throughout, including index 2.
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], null);

  // A linear ramp makes both EMA lines lag the price by the same constant
  // offset once bootstrapped, so dif is constant from index 2 onward and
  // dea converges to it immediately - every post-warmup index checks the
  // same values.
  for (let i = 3; i <= 7; i++) {
    assert.deepEqual(out[i], { dif: 0.5, dea: 0.5, macd: 0 }, `index ${i}`);
  }
});

test('fast=2, slow=3, signal=2, sharp jump on the last bar: fast line pulls above the signal line, macd > 0', () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 20];
  const out = macdArr(closes, 2, 3, 2);
  // Directional check, not an exact-value one - the jump is there to exercise
  // dif reacting harder than dea, not to pin a specific number.
  assert.ok(out[7]!.macd > 0, `expected macd > 0 for a sharp upward jump, got ${out[7]!.macd}`);
});

test('registry defaults (12,26,9): 40 closes needs 34 bars before dea exists - index 32 null, 33 not', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  const out = macdArr(closes, 12, 26, 9);
  // maxPeriod(26) + signal(9) - 2 = 33, the first index dea exists.
  assert.equal(out[32], null);
  assert.notEqual(out[33], null);
});
