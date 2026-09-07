/* Coverage handoff from Dev under the new rule (owner ruling, 2026-09-07):
 * Dev derives and verifies against the library source, QA encodes and owns
 * the test. Derivation here is Dev's, independently re-run by QA against
 * this branch's actual lib/strategyCore.ts (a standalone port of the
 * function, executed with Node, not eyeballed) before encoding - this file
 * encodes it, it does not re-derive it.
 *
 * psarArr(candles, startAf=0.02, step=0.02, maxAf=0.2), ported from
 * klinecharts' own `stopAndReverse.calc` rather than a textbook Parabolic
 * SAR writeup - same discipline as smaNMArr/bollingerBandsArr, and worth it
 * here specifically: klinecharts' SAR has a real, asymmetric quirk between
 * its two branches (see below) that a from-memory implementation would not
 * reproduce.
 *
 * `startAf`/`step`/`maxAf` are TRUE UNITS (0.02/0.02/0.2, the registry's own
 * defaults) - NOT klinecharts' internal calcParams, which are those same
 * values x100 (see `toCalcParams` in lib/strategyRegistry.ts and #1007/#1008).
 *
 * THE ASYMMETRY, PRESERVED RATHER THAN "FIXED": on a bullish-to-bearish
 * reversal the acceleration factor resets to `startAf` (uptrend branch); on
 * a bearish-to-bullish reversal it resets to 0, not `startAf` (downtrend
 * branch). This looks like a copy-paste bug in klinecharts itself - but per
 * the owner's ruling on #985 gap 1, klinecharts is the SPECIFICATION for
 * what its own indicators compute, not a reference to improve on. A
 * "corrected" symmetric version would silently disagree with the actual
 * line the chart draws for the same selected indicator, which is a worse
 * defect than reproducing an upstream quirk.
 *
 * The test case below exercises both asymmetric branches on purpose: the
 * very first bar reverses through the `af = 0` branch (isIncreasing starts
 * false), and the sharp drop at the end reverses through the `af = startAf`
 * branch - the one place a "corrected" symmetric reimplementation would
 * silently diverge from what the chart actually draws. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { psarArr, type OHLCV } from '../lib/strategyCore.ts';

function candle(high: number, low: number): OHLCV {
  return { time: 0, open: 0, high, low, close: 0, volume: 0 };
}

test('empty input: empty output, no throw', () => {
  assert.deepEqual(psarArr([]), []);
});

test('six bars, both reversal branches: high/low only, [10,9] [11,10] [12,11] [13,12] [14,13] [8,7]', () => {
  const candles = [
    candle(10, 9),
    candle(11, 10),
    candle(12, 11),
    candle(13, 12),
    candle(14, 13),
    candle(8, 7), // sharp drop - forces the second reversal
  ];
  const out = psarArr(candles);

  // i=0: isIncreasing starts false. ep=-100 -> ep=low=9, af=startAf+step=0.04.
  // sar = 0 + 0.04*(9-0) = 0.36, which is < high(10) -> immediate reversal:
  // sar=ep=9, af resets to 0 (the downtrend-branch asymmetry), isIncreasing=true.
  assert.equal(out[0], 9);

  // i=1: isIncreasing=true, af=0 from the reversal above. ep=-100 -> ep=high=11,
  // af=min(0+0.02,0.2)=0.02. sar=9+0.02*(11-9)=9.04. lowMin=min(prevLow=9,low=10)=9.
  // 9.04 is not > low(10); 9.04 > lowMin(9) -> sar clamps to lowMin=9.
  assert.equal(out[1], 9);

  // i=2: ep=11<high(12) -> ep=12, af=0.04. sar=9+0.04*(12-9)=9.12. Neither
  // clamp triggers (9.12 < low(11)? no - not > low, and not > lowMin(10) either).
  assert.equal(out[2], 9.12);

  // i=3: ep=12<high(13) -> ep=13, af=0.06. sar=9.12+0.06*(13-9.12)=9.3528.
  assert.equal(out[3], 9.12 + 0.06 * (13 - 9.12));

  // i=4: ep=13<high(14) -> ep=14, af=0.08. sar=9.3528+0.08*(14-9.3528)=9.724576.
  const sar3 = 9.12 + 0.06 * (13 - 9.12);
  assert.equal(out[4], sar3 + 0.08 * (14 - sar3));

  // i=5: sharp drop. isIncreasing=true, ep=14 not<8 so ep/af unchanged (14, 0.08).
  // sar=9.724576+0.08*(14-9.724576)=10.0666... which IS > low(7) -> reversal:
  // sar=ep=14, af resets to startAf=0.02 (the uptrend-branch asymmetry, the
  // OTHER half of the pair i=0 already exercised).
  assert.equal(out[5], 14);
});
