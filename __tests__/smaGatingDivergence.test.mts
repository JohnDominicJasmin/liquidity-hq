/* Coverage handoff from Dev under the new rule (owner ruling, 2026-09-07):
 * Dev derives and verifies against the library source, QA encodes and owns
 * the test. #1007's fix switches SMA's verdict-gating threshold from
 * `smaNMArr(cl4, 12, 2)` (klinecharts' own recursive "SMA", algebraically
 * EMA(12) at M=2 - see smaNMArr.test.mts) to `smaArr(cl4, 12)` (a plain
 * rolling mean). Both functions are pre-existing and already covered
 * elsewhere - `smaArr` for the 200D core gate, `smaNMArr` in its own test
 * file - so this file's job isn't proving either formula correct. It's
 * proving they're GENUINELY DIFFERENT, not a relabel: a hand-picked closes
 * array where the two thresholds land on opposite sides of a chosen price,
 * independently re-derived and executed by QA (not Dev's real-market-data
 * cases, which needed a live fetch to reproduce) rather than trusted as
 * stated.
 *
 * Eleven flat closes at 100, then a sharp three-bar run to 130. A rolling
 * mean weighs all twelve bars in its window equally, so it lags the run;
 * klinecharts' recursive SMA(N,M) leans harder on recent bars even before
 * the run finishes bootstrapping its own momentum. At the last bar:
 *
 *   smaArr(closes, 12)      = 105.00
 *   smaNMArr(closes, 12, 2) = 108.32...
 *
 * A price of 106.5 sits strictly between them - "price <= threshold" (the
 * gating condition's own shape, see lib/useEMAStrategy.ts) is false against
 * the rolling mean and true against the recursive SMA. Same closes, same
 * price, opposite answer depending on which formula gates - which is
 * exactly the property #1007 needed and #1006/#1010's PRs did not have to
 * prove, because nothing changed under them mid-fix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { smaArr, smaNMArr } from '../lib/strategyCore.ts';

test('smaArr(12) and smaNMArr(12,2) land on opposite sides of the same price', () => {
  const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110, 120, 130];
  const rollingMean = smaArr(closes, 12).at(-1)!;
  const recursiveSma = smaNMArr(closes, 12, 2).at(-1)!;

  // Pin the exact values, not just their relative order - a future change to
  // either formula that keeps them on the same side of 106.5 by coincidence
  // should still fail this test.
  assert.equal(rollingMean, 105);
  assert.ok(Math.abs(recursiveSma - 108.32043695949021) < 1e-9, `recursiveSma was ${recursiveSma}`);

  const price = 106.5;
  assert.ok(price > rollingMean, 'price should sit above the rolling mean');
  assert.ok(price < recursiveSma, 'price should sit below the recursive SMA(12,2)');

  // The gating condition's own shape (lib/useEMAStrategy.ts): "price <=
  // threshold" downgrades a LONG_SETUP. Same price, opposite verdict-gating
  // outcome depending on which formula is the threshold - the property that
  // makes #1007's swap a real fix rather than a rename.
  assert.equal(price <= rollingMean, false, 'rolling mean: SMA should NOT disagree with a long entry here');
  assert.equal(price <= recursiveSma, true, 'recursive SMA(12,2): SMA WOULD have disagreed here - the collision #1007 fixes');
});
