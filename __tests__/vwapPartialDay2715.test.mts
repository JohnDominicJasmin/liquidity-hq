/* QA: PR #2715, vwap_reclaim draws the partial UTC-day VWAP while it waits for its sixth candle (QA drawings audit #1263, re-run on qa 4996ed7: BTC / ETH / SOL at 30m and 1h run 02:49-05:00Z showed only past arrows and the reason).
 *
 * THE WRITTEN RULE (PR body + PM: "a selected strategy draws what it watches"): vwap_reclaim watches the SESSION VWAP: the volume-weighted average of the typical price (high + low + close) / 3 from 00:00 UTC of the last candle's day. With 1 to 5 candles in that
 * day the strategy still answers WAIT (the 6-candle rule is unchanged) but the WAIT carries the VWAP line from the day open, one point per candle. No usable volume: a plain WAIT, no overlay. Six candles or more: the verdict logic and the line are as before.
 *   V1  1 to 5 session candles: verdict WAIT, one line, one point per candle, equal to a hand-rolled running VWAP (varied volumes, so a plain mean would be wrong), role ref, label STRAT_OV_VWAP, no levels / zones / marker
 *   V2  the line starts at 00:00 UTC of the day: the previous day's candles (before midnight) are not in it
 *   V3  no usable volume in the session (zeros): plain WAIT, no overlay; a zero-volume first candle followed by volume starts the line at the first usable point
 *   V4  six candles or more: a reclaim after three closes below is still a BUY with its marker and invalidation level and the full line; no cross is still WAIT with the full line (unchanged behaviour)
 *   V6  the six-candle rule is unchanged: a reclaim on the 5th candle is a WAIT with the partial line, the same reclaim one candle later is a BUY
 *   V5  fewer than 10 candles in all, or a coarser timeframe than 1h, is still a plain WAIT (no overlay)
 * WHAT THIS CANNOT PROVE: the line on the chart at 30m / 1h early in the UTC day (the drawings re-run, run when the day is that young). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVwapReclaim } from '../lib/strategies/vwapReclaim.ts';
import type { OHLCV } from '../lib/strategyCore.ts';

const H = 3_600_000, DAY0 = Date.UTC(2026, 10, 20, 0, 0);         // 20 Nov 2026 00:00 UTC
const ctx = (tfMs = H) => ({ coin: 'btc', tf: tfMs === H ? '1h' : '4h', tfMs }) as never;
const bar = (time: number, o: number, c: number, vol: number): OHLCV => ({ time, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c, volume: vol });
const hand = (cs: OHLCV[]) => { let pv = 0, v = 0; return cs.map((k) => { const x = k.volume > 0 ? k.volume : 0; pv += ((k.high + k.low + k.close) / 3) * x; v += x; return v > 0 ? pv / v : NaN; }); };
/* the day before: 12 hourly candles ending at 23:00 UTC, prices around 100 */
const prev = Array.from({ length: 12 }, (_, i) => bar(DAY0 - (12 - i) * H, 100, 100 + (i % 3), 50 + i));
const today = (n: number, base = 105) => Array.from({ length: n }, (_, i) => bar(DAY0 + i * H, base + i, base + i + (i % 2 ? 1 : -0.5), 100 + i * 37));

test('V1. 1 to 5 session candles: WAIT with one VWAP line, one point per candle, equal to a hand-rolled VWAP', () => {
  for (let k = 1; k <= 5; k++) {
    const cs = [...prev, ...today(k)]; const r = detectVwapReclaim(cs, ctx());
    assert.equal(r.verdict, 'wait', `k=${k}`); const ov = r.overlay!; assert.ok(ov, `k=${k}: no overlay`);
    assert.equal(ov.lines.length, 1); assert.deepEqual(ov.levels, []); assert.deepEqual(ov.zones, []); assert.equal(ov.marker, null);
    const line = ov.lines[0]; assert.equal(line.role, 'ref'); assert.equal(line.labelKey, 'STRAT_OV_VWAP'); assert.equal(line.points.length, k, `k=${k}: one point per session candle`);
    const want = hand(today(k)); line.points.forEach((p, i) => { assert.equal(p.ts, DAY0 + i * H); assert.ok(Math.abs(p.price - want[i]) < 1e-9, `k=${k} point ${i}: ${p.price} vs ${want[i]}`); });
  }
  const t5 = today(5); const plain = t5.map((c) => (c.high + c.low + c.close) / 3).reduce((a, b) => a + b, 0) / 5; const last = detectVwapReclaim([...prev, ...t5], ctx()).overlay!.lines[0].points.at(-1)!.price;
  assert.ok(Math.abs(last - plain) > 1e-6, 'control: the volumes must make a plain mean differ from the VWAP');
});

test('V2. the line starts at 00:00 UTC: the previous day is not in it', () => {
  const line = detectVwapReclaim([...prev, ...today(3)], ctx()).overlay!.lines[0];
  assert.equal(line.points[0].ts, DAY0); assert.ok(line.points.every((p) => p.ts >= DAY0), 'a point before midnight is in the line');
  const only = hand(today(3)); assert.ok(Math.abs(line.points.at(-1)!.price - only.at(-1)!) < 1e-9, 'the previous day leaked into the average');
});

test('V3. no usable volume: plain WAIT, no overlay; a zero-volume first candle starts the line at the first usable point', () => {
  const zero = [...prev, ...today(4).map((c) => ({ ...c, volume: 0 }))]; const r = detectVwapReclaim(zero, ctx()); assert.equal(r.verdict, 'wait'); assert.equal(r.overlay, undefined, 'a line was drawn with no volume');
  const t = today(4); t[0] = { ...t[0], volume: 0 }; const line = detectVwapReclaim([...prev, ...t], ctx()).overlay!.lines[0];
  assert.equal(line.points.length, 3, 'the zero-volume candle has no VWAP yet'); assert.equal(line.points[0].ts, DAY0 + H);
  const want = hand(t).filter(Number.isFinite); line.points.forEach((p, i) => assert.ok(Math.abs(p.price - want[i]) < 1e-9));
});

test('V4. six candles or more: a reclaim is still a BUY with marker and invalidation, no cross is still WAIT with the full line', () => {
  /* three closes below the running VWAP, then a close above it, six candles into the day */
  const mk = (closes: number[]) => closes.map((c, i) => bar(DAY0 + i * H, c, c, 100));
  const buyDay = mk([110, 108, 106, 104, 120, 121]); const buy = detectVwapReclaim([...prev, ...buyDay], ctx());
  const w = hand(buyDay); assert.ok(buyDay[4].close > w[4] && [1, 2, 3].every((i) => buyDay[i].close < w[i]), 'fixture must be a reclaim (hand-checked below/above)');
  assert.equal(buy.verdict, 'buy'); assert.ok(buy.overlay!.marker, 'the BUY lost its marker'); assert.equal(buy.overlay!.levels.length, 1); assert.equal(buy.overlay!.lines[0].points.length, buyDay.length);
  const flat = mk([100, 101, 100, 101, 100, 101]); const wait = detectVwapReclaim([...prev, ...flat], ctx()); assert.equal(wait.verdict, 'wait'); assert.equal(wait.overlay!.lines[0].points.length, 6); assert.equal(wait.overlay!.marker, null);
});

test('V5. fewer than 10 candles in all, or a coarser timeframe than 1h, is still a plain WAIT', () => {
  const few = detectVwapReclaim(today(5), ctx()); assert.equal(few.verdict, 'wait'); assert.equal(few.overlay, undefined, 'under 10 candles in all must stay a plain WAIT');
  const coarse = detectVwapReclaim([...prev, ...today(5)], ctx(4 * H)); assert.equal(coarse.verdict, 'wait'); assert.equal(coarse.overlay, undefined, 'a 4h timeframe must stay a plain WAIT');
});

test('V6. the six-candle rule is unchanged: a reclaim on the FIFTH candle is still a WAIT (with the partial line), reported one candle later', () => {
  const mk = (closes: number[]) => closes.map((c, i) => bar(DAY0 + i * H, c, c, 100));
  const five = mk([110, 108, 106, 104, 120]); const w5 = hand(five); assert.ok(five[4].close > w5[4] && [1, 2, 3].every((i) => five[i].close < w5[i]), 'fixture: a hand-checked reclaim on the 5th candle');
  const r5 = detectVwapReclaim([...prev, ...five], ctx()); assert.equal(r5.verdict, 'wait', 'a 5-candle session must not answer BUY'); assert.equal(r5.overlay!.lines[0].points.length, 5); assert.equal(r5.overlay!.marker, null);
  const r6 = detectVwapReclaim([...prev, ...mk([110, 108, 106, 104, 120, 121])], ctx()); assert.equal(r6.verdict, 'buy', 'one candle later the same reclaim is reported');
});
