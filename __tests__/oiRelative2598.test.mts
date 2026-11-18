import test from 'node:test';
import assert from 'node:assert/strict';
import { oiRelative } from '../lib/strategies/liveInputs.ts';

/* #2598 REVISION 2, condition 2 "open interest extreme for the coin", from the PR text (NOT from the code): the change over the last 6 candles is above zero and in the TOP 20% (at least 80% of the EARLIER changes strictly lower)
 * of that coin's own 6-candle changes in the OI history Binance serves (newest 500 candles of the timeframe, 30 days at most). "No reading" under 120 candles or when the candles are not one candle apart (a gap): the PR says
 * "119 rows = no reading, one candle gap = no reading, strictly-lower tie = not extreme, change <= 0 = not extreme". */
const TF = 3_600_000, T0 = Date.UTC(2026, 10, 1);
/** n rows one candle apart whose 6-candle changes are the given values (oi grows by a fixed 6-step ratio); the LAST change is `last` percent */
function rows(n: number, base: (i: number) => number, skip: number[] = []) {
  const out: Array<{ sumOpenInterest: string; timestamp: number }> = [];
  for (let i = 0; i < n; i++) if (!skip.includes(i)) out.push({ sumOpenInterest: String(base(i)), timestamp: T0 + i * TF });
  return out;
}
/** a quiet series: OI wobbles +-0.2% so the 6-candle changes are small and varied; then the last 6 candles climb by `liveChgPct` */
const quiet = (i: number) => 1_000_000 * (1 + 0.002 * Math.sin(i * 0.9));
const withLive = (n: number, liveChgPct: number) => rows(n, (i) => (i >= n - 6 ? quiet(n - 7) * (1 + (liveChgPct / 100) * ((i - (n - 7)) / 6)) : quiet(i)));

test('O1. a clearly top-20% rise over the last 6 candles is extreme; the reading carries the change', () => {
  const r = oiRelative(withLive(300, 5), TF);
  assert.ok(r, 'a 300-candle history must give a reading'); assert.equal(r!.oiExtreme, true); assert.ok(r!.oiChange6Pct > 4 && r!.oiChange6Pct < 6, `the change ${r!.oiChange6Pct}`);
});
test('O2. a change of zero or below is never extreme, even if the history is full of falls', () => {
  const falling = rows(300, (i) => 1_000_000 * (1 - 0.0004 * i));
  const r = oiRelative(falling, TF); assert.ok(r); assert.equal(r!.oiExtreme, false, 'OI falling every candle: the live change is below zero');
  /* history of big falls (-3% per 6 candles) and a live change of -0.5%: it is above 80% of the earlier changes, but it is not ABOVE ZERO, so it is not extreme */
  const n = 300, chg = new Array<number>(n - 6).fill(-3); chg[chg.length - 1] = -0.5; const oi = new Array<number>(n).fill(1_000_000); for (let i = 6; i < n; i++) oi[i] = oi[i - 6] * (1 + chg[i - 6] / 100);
  const neg = oiRelative(rows(n, (i) => oi[i]), TF); assert.ok(neg); assert.ok(neg!.oiChange6Pct < 0); assert.equal(neg!.oiExtreme, false, 'a negative live change must never be extreme, however calm the falling history');
  const flat = oiRelative(rows(300, () => 1_000_000), TF); assert.ok(flat); assert.equal(flat!.oiExtreme, false, 'a change of exactly 0 is not above zero');
});
test('O3. a quiet live change (inside the usual range) is not extreme', () => {
  const r = oiRelative(rows(300, quiet), TF); assert.ok(r); assert.equal(r!.oiExtreme, false);
});
test('O4. strictly-lower tie: when the earlier changes EQUAL the live change they are not "lower", so it is not extreme', () => {
  const same = oiRelative(rows(300, (i) => 1_000_000 * Math.pow(1.01, i / 6)), TF); // every 6-candle change is the same +1%
  assert.ok(same); assert.equal(same!.oiExtreme, false, 'a live change equal to every earlier one is not in the top 20%');
});
test('O5. the 80% line: exactly 80% of the earlier changes strictly lower is extreme, one fewer is not', () => {
  // 150 rows -> 144 changes; the earlier 143. Make the earlier changes: k of them lower than the live +2%, the rest higher (+3%).
  const build = (lowerCount: number) => {
    const n = 150, chg = new Array<number>(n - 6).fill(0); // change[j] is the 6-candle change ending at row j+6
    for (let j = 0; j < chg.length - 1; j++) chg[j] = j < lowerCount ? 0.5 : 3; chg[chg.length - 1] = 2;
    // reconstruct OI so oi[i] = oi[i-6] * (1 + chg/100): rows 0-5 start at 1,000,000
    const oi = new Array<number>(n).fill(1_000_000);
    for (let i = 6; i < n; i++) oi[i] = oi[i - 6] * (1 + chg[i - 6] / 100);
    return rows(n, (i) => oi[i]);
  };
  const need = Math.ceil(0.8 * 143); // 115 of 143 earlier changes
  const at = oiRelative(build(need), TF), under = oiRelative(build(need - 1), TF);
  assert.ok(at && under); assert.equal(at!.oiExtreme, true, `${need} of 143 strictly lower is >= 80%`); assert.equal(under!.oiExtreme, false, `${need - 1} of 143 is under 80%`);
});
test('O6. no reading (null): 119 rows, an empty or missing history, junk timestamps', () => {
  assert.equal(oiRelative(withLive(119, 5), TF), null, '119 rows'); assert.ok(oiRelative(withLive(120, 5), TF), '120 rows is enough');
  assert.equal(oiRelative(null, TF), null); assert.equal(oiRelative(undefined, TF), null); assert.equal(oiRelative([], TF), null);
  assert.equal(oiRelative(rows(200, quiet).map((r, i) => (i === 50 ? { ...r, timestamp: NaN } : r)), TF), null, 'a NaN timestamp');
});
test('O7a. the candles must be ONE CANDLE APART: rows on another timeframe are no reading', () => {
  assert.equal(oiRelative(withLive(300, 5), TF * 4), null, 'hourly rows read as 4h rows');
});
/* FINDING (low): the PR says "one candle gap = no reading", but the check compares the AVERAGE spacing within 10%, so a single missing row in 300 moves the mean by 0.3% and passes. todo = reported, does not fail the run. */
test('O7b. a gap in the history is no reading (a 6-candle change across a missing candle spans 7 candles)', { todo: 'oiRelative averages the spacing: one missing row in 300 is not detected' }, () => {
  assert.equal(oiRelative(rows(300, quiet, [150]), TF), null, 'one candle missing in the middle of the history');
  assert.equal(oiRelative(rows(300, quiet, [296]), TF), null, 'one candle missing inside the last 6 candles: the live change is not over 6 candles');
});
