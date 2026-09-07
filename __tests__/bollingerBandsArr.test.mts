/* Coverage handoff from Dev under the new rule (owner ruling, 2026-09-07):
 * Dev derives and verifies against the library source, QA encodes and owns
 * the test. Derivation here is Dev's, hand-checked against klinecharts'
 * bollingerBands.calc and run against the real implementation (21/21) before
 * handoff - this file encodes it, it does not re-derive it.
 *
 * bollingerBandsArr(closes, length, mult):
 *   mid = rolling mean of the trailing `length` closes
 *   md  = sqrt(mean of squared deviations from mid over the same window)
 *         (population variance - divide by length, not length-1)
 *   up  = mid + mult*md
 *   dn  = mid - mult*md
 *
 * Returns `Array<{ mid, up, dn } | null>` - null per index, not NaN, for any
 * index before `length` closes exist. Different return shape from
 * smaNMArr/emaArr on purpose (checked against lib/strategyCore.ts directly)
 * - do not assert NaN here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bollingerBandsArr } from '../lib/strategyCore.ts';

test('fewer than `length` values: every index is null, not NaN', () => {
  const closes = [1, 2, 3];
  const out = bollingerBandsArr(closes, 5, 2);
  assert.equal(out.length, closes.length);
  for (const v of out) assert.equal(v, null);
});

test('classic textbook series: closes=[2,4,4,4,5,5,7,9], length=8, mult=2 - the whole series is the one window', () => {
  const closes = [2, 4, 4, 4, 5, 5, 7, 9];
  const out = bollingerBandsArr(closes, 8, 2);

  for (let i = 0; i < 7; i++) assert.equal(out[i], null, `index ${i} should be null - fewer than 8 values yet`);

  // sum of squared deviations from mid=5: 9+1+1+1+0+0+4+16 = 32, /8 = 4, sqrt = 2
  assert.deepEqual(out[7], { mid: 5, up: 9, dn: 1 });
});

test('rolling window: closes=[1,2,3,4,5,6], length=3, mult=1 - three consecutive integers always give the same md', () => {
  const closes = [1, 2, 3, 4, 5, 6];
  const out = bollingerBandsArr(closes, 3, 1);
  const md = Math.sqrt(2 / 3);

  assert.equal(out[0], null);
  assert.equal(out[1], null);

  // window [1,2,3]: mid=2, sq-dev sum = 1+0+1 = 2
  assert.equal(out[2]!.mid, 2);
  assert.equal(out[2]!.up, 2 + md);
  assert.equal(out[2]!.dn, 2 - md);

  // window [2,3,4]: mid=3, same md - three consecutive integers, same spread
  assert.equal(out[3]!.mid, 3);
  assert.equal(out[3]!.up, 3 + md);
  assert.equal(out[3]!.dn, 3 - md);

  // window [4,5,6]: mid=5, same md again
  assert.equal(out[5]!.mid, 5);
  assert.equal(out[5]!.up, 5 + md);
  assert.equal(out[5]!.dn, 5 - md);
});
