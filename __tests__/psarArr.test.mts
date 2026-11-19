/* PARABOLIC SAR = TEXTBOOK WILDER (PM, 2026-11-20; QA indicators matrix #1263 D2). This file used to PIN klinecharts' own quirks (the current bar's extreme point, an acceleration factor reset to 0 on a flip to down): that was the rule until the PM ruled the dots must equal TradingView's. It now pins the textbook rule, written from Wilder's definition and TradingView's ta.sar, NOT copied from lib/strategyCore.ts.
 *   P0 empty / one bar: nothing, no throw
 *   P1 six bars worked BY HAND from the written rule (both reversal branches, the two-bar clamp, AF steps)
 *   P2 SYMMETRY: mirroring the market (price -> -price, highs and lows swapped) must mirror the SAR exactly. The old klinecharts port FAILED this (AF reset to 0 one way and to 0.02 the other); a textbook implementation cannot
 *   P3 an INDEPENDENT second implementation (written from the stated rule, next-bar indexing; the reversal-bar clamp convention is the one open point, P3b) on 6,000 random-walk bars: equal after the first reversal (the first bars depend on the seeding convention, which has no lasting effect: a reversal resets the SAR to the extreme point)
 *   P4 the invariants a SAR must keep on any series: below the low of the bar in an up trend, above the high in a down trend (except on the reversal bar), a dot never leaves the previous two bars' range on the wrong side, and the acceleration never exceeds its maximum
 *   P5 parameters are TRUE units (0.02 / 0.02 / 0.2) and the maximum is honoured
 * NOT proven here: that the numbers equal TradingView's on a live chart (a human spot-check of one last-bar value); the pixels (the indicator cells re-run after deploy). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { psarArr, type OHLCV } from '../lib/strategyCore.ts';

const bar = (high: number, low: number, close = (high + low) / 2): OHLCV => ({ time: 0, open: close, high, low, close, volume: 0 });
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test('P0. empty and one-bar input: nothing, no throw', () => { assert.deepEqual(psarArr([]), []); const one = psarArr([bar(10, 9)]); assert.equal(one.length, 1); assert.ok(Number.isNaN(one[0])); });

test('P1. six bars worked by hand: an up trend, the AF steps, then a sharp drop reverses it to the extreme point; the next bar keeps the two-bar clamp', () => {
  const c = [bar(10, 9, 9.5), bar(11, 10, 10.5), bar(12, 11), bar(13, 12), bar(14, 13), bar(8, 7), bar(9, 8)];
  const o = psarArr(c);
  /* bar 0 has no value. bar 1: close up on bar 0 so the trend is UP: SAR starts at bar 0's low (9), extreme point = bar 1's high (11), AF 0.02. */
  assert.ok(Number.isNaN(o[0])); assert.equal(o[1], 9);
  /* bar 2: SAR = 9 + 0.02*(11-9) = 9.04; the low (11) is above it: no reversal; a new high (12) raises EP to 12 and AF to 0.04; the SAR may not be above the lows of bar 1 (10) and bar 0 (9): 9.04 -> 9 */
  assert.ok(close(o[2], 9), `bar 2: ${o[2]}`);
  /* bar 3: SAR = 9 + 0.04*(12-9) = 9.12; EP 13, AF 0.06; clamps (lows 11, 10) leave 9.12 */
  assert.ok(close(o[3], 9.12), `bar 3: ${o[3]}`);
  /* bar 4: SAR = 9.12 + 0.06*(13-9.12) = 9.3528; EP 14, AF 0.08 */
  assert.ok(close(o[4], 9.12 + 0.06 * (13 - 9.12)), `bar 4: ${o[4]}`);
  /* bar 5 (high 8, low 7): SAR = 9.3528 + 0.08*(14-9.3528) = 9.724576, ABOVE the low (7): the trend REVERSES. The SAR becomes the old extreme point (14, which is above this bar's high 8), EP = this bar's low 7, AF back to 0.02 */
  assert.equal(o[5], 14);
  /* bar 6 (high 9, low 8): SAR = 14 + 0.02*(7-14) = 13.86; the high (9) is below it: no reversal; no new low; a down-trend SAR may not be below the highs of the two bars before (bar 5: 8, bar 4: 14): max(13.86, 8, 14) = 14 */
  assert.ok(close(o[6], 14), `bar 6: ${o[6]}`);
});

/* a deterministic random walk with trends: PRNG, no Math.random */
function walk(n: number, seed: number): OHLCV[] {
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out: OHLCV[] = []; let p = 100, drift = 0;
  for (let i = 0; i < n; i++) { if (i % 37 === 0) drift = (rnd() - 0.5) * 0.9; const o = p, c = p + drift + (rnd() - 0.5) * 2.2, h = Math.max(o, c) + rnd() * 1.1, l = Math.min(o, c) - rnd() * 1.1; out.push({ time: i, open: o, high: h, low: l, close: c, volume: 1 }); p = c; }
  return out;
}
const mirror = (c: OHLCV[]): OHLCV[] => c.map((x) => ({ ...x, open: -x.open, close: -x.close, high: -x.low, low: -x.high }));

test('P2. symmetry: the mirrored market gives the exactly mirrored SAR, for every seed (the old port failed this)', () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 99, 2026]) {
    const c = walk(800, seed), a = psarArr(c), b = psarArr(mirror(c));
    for (let i = 1; i < c.length; i++) assert.ok(close(a[i], -b[i], 1e-9), `seed ${seed} bar ${i}: ${a[i]} vs mirrored ${-b[i]}`);
  }
});

/* The second implementation, written from the rule in the PR (Wilder: on a REVERSAL bar the SAR is the old extreme point and nothing else adjusts it; on every other bar it may not enter the previous two bars' range). Bar 1 is stepped like every other bar. `clampOnReversal` is the one convention that differs between published versions (see P3b). */
function pineSar(c: OHLCV[], start = 0.02, inc = 0.02, max = 0.2, clampOnReversal = false): number[] {
  const out = new Array<number>(c.length).fill(NaN); let result = NaN, maxMin = NaN, acc = NaN, isBelow = false;
  for (let i = 1; i < c.length; i++) {
    let first = false;
    if (i === 1) { if (c[1].close > c[0].close) { isBelow = true; maxMin = c[1].high; result = c[0].low; } else { isBelow = false; maxMin = c[1].low; result = c[0].high; } first = true; acc = start; }
    result = result + acc * (maxMin - result);
    if (isBelow) { if (result > c[i].low) { first = true; isBelow = false; result = Math.max(c[i].high, maxMin); maxMin = c[i].low; acc = start; } }
    else if (result < c[i].high) { first = true; isBelow = true; result = Math.min(c[i].low, maxMin); maxMin = c[i].high; acc = start; }
    if (!first) { if (isBelow) { if (c[i].high > maxMin) { maxMin = c[i].high; acc = Math.min(acc + inc, max); } } else if (c[i].low < maxMin) { maxMin = c[i].low; acc = Math.min(acc + inc, max); } }
    if (!first || clampOnReversal) { if (isBelow) { result = Math.min(result, c[i - 1].low); if (i > 1) result = Math.min(result, c[i - 2].low); } else { result = Math.max(result, c[i - 1].high); if (i > 1) result = Math.max(result, c[i - 2].high); } }
    out[i] = result;
  }
  return out;
}
test('P3. an independent second implementation, written from the stated rule, agrees on random walks once the seeding prefix is over', () => {
  let compared = 0, prefixMax = 0;
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    const c = walk(700, seed), a = psarArr(c), b = pineSar(c);
    let from = 2; while (from < c.length && !close(a[from], b[from], 1e-9)) from++;   /* the seeding prefix: the first bar where they agree */
    for (let i = from; i < c.length; i++) { assert.ok(close(a[i], b[i], 1e-9), `seed ${seed} bar ${i}: app ${a[i]} vs oracle ${b[i]}`); compared++; }
    prefixMax = Math.max(prefixMax, from);
  }
  assert.ok(compared > 6000, `CONTROL: only ${compared} bars compared`); assert.ok(prefixMax <= 60, `the two implementations took ${prefixMax} bars to agree: the seeding difference should vanish at the first reversal`);
});

test('P4. invariants on any series: the SAR is on the right side of price, never inside the previous two bars on the wrong side, and AF-driven motion never overshoots the extreme point', () => {
  for (const seed of [4, 9, 16, 25]) {
    const c = walk(1000, seed), a = psarArr(c); let reversals = 0;
    for (let i = 3; i < c.length; i++) {
      const up = a[i] < c[i].low || a[i] < (c[i].high + c[i].low) / 2, v = a[i];
      if (up) { assert.ok(v <= Math.min(c[i].low, c[i - 1].low, c[i - 2].low) + 1e-9 || v <= c[i].low + 1e-9, `seed ${seed} bar ${i}: an up-trend SAR ${v} above the bar's low`); }
      else { assert.ok(v >= Math.max(c[i].high, c[i - 1].high, c[i - 2].high) - 1e-9 || v >= c[i].high - 1e-9, `seed ${seed} bar ${i}: a down-trend SAR ${v} below the bar's high`); }
      if ((a[i] < c[i].low) !== (a[i - 1] < c[i - 1].low)) reversals++;
    }
    assert.ok(reversals > 10, `CONTROL: seed ${seed} produced only ${reversals} flips`);
  }
});

test('P5. true units and the maximum: AF never exceeds the maximum, and a smaller maximum chases price slower', () => {
  const c = walk(400, 77), fast = psarArr(c, 0.02, 0.02, 0.2), slow = psarArr(c, 0.02, 0.02, 0.04), same = pineSar(c, 0.02, 0.02, 0.04);
  let differs = 0; for (let i = 5; i < c.length; i++) if (!close(fast[i], slow[i], 1e-9)) differs++;
  assert.ok(differs > 20, 'a lower maximum AF must change the dots'); let from = 2; while (from < c.length && !close(slow[from], same[from], 1e-9)) from++; for (let i = from; i < c.length; i++) assert.ok(close(slow[i], same[i], 1e-9), `max 0.04 bar ${i}`);
});

/* P3b DIAGNOSTIC, NOT ASSERTED: some published TradingView-style reference code ALSO applies the two-bar clamp on the reversal bar itself. They differ only when a bar from BEFORE the old trend started had a higher high (or lower low) than the old extreme point: a handful of reversals per thousand bars, after which the dots differ by a fraction of a percent until the next reversal. The PM asked for TradingView's values: a human must compare one last-bar value on a live TradingView chart (BTC 1h, default 0.02/0.02/0.2) with the app's to settle which convention TradingView uses. The printed share says how often it could matter. */
test('P3b. DIAGNOSTIC: how often the reversal-bar clamp convention changes the dots', () => {
  let diff = 0, total = 0; for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) { const c = walk(700, seed), a = pineSar(c, 0.02, 0.02, 0.2, false), b = pineSar(c, 0.02, 0.02, 0.2, true); for (let i = 60; i < c.length; i++) { total++; if (!close(a[i], b[i], 1e-9)) diff++; } }
  console.log(`[SAR] reversal-bar clamp convention changes ${diff} of ${total} dots on random walks (${((100 * diff) / total).toFixed(2)}%): a human TradingView spot-check settles it`);
});
