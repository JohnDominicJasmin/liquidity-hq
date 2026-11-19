/* QA: PR #2705, vwap_reclaim on a tokenized stock draws the LAST CASH SESSION's VWAP while the US market is closed (QA drawings audit #1263: AAPL 1m / 5m / 15m and TSLA 1m / 5m / 15m / 30m drew nothing, only the reason line; PM rule: a selected strategy draws what it watches).
 *
 * THE WRITTEN RULE (PR body + PM): when the last candle opened outside the US cash session (09:30-16:00 New York, Mon-Fri), a session strategy on a stock still answers WAIT with `marketClosed`, and vwap_reclaim now carries one reference line: the volume-weighted average of the typical
 * price (high + low + close) / 3 over the most recent unbroken run of candles that opened inside the cash session, running from that session's first candle. Nothing when that run holds fewer than two candles or no volume. Other session strategies and every other coin kind are unchanged.
 *   W1  the line equals a hand-rolled running VWAP at every point (varied volumes, so a plain mean of typical prices would be wrong), role 'ref', label key STRAT_OV_VWAP, verdict WAIT with marketClosed true; the inner detect is not called
 *   W2  only the LAST session: the previous day's cash candles (separated by the overnight) are not in the line, the first point is today's first cash candle
 *   W3  an unbroken run: a hole of more than an hour inside the session starts the run after the hole
 *   W4  a run of one candle, a run with no volume, and no cash candle at all draw nothing (WAIT with marketClosed only)
 *   W5  ny_open_breakout and session_sweep get no VWAP line from the gate; a crypto coin and an open market go straight to the strategy's own answer, untouched
 *   W6  weekend: the last Friday session is the run (Saturday and Sunday candles are closed)
 * WHAT THIS CANNOT PROVE: how the line looks on the real chart at 1m-30m (the browser cells after promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withMarketGate } from '../lib/strategies/marketGate.ts';
import { WAIT, type StrategyDef, type StrategyResult } from '../lib/strategies/types.ts';
import type { OHLCV } from '../lib/strategyCore.ts';

const MIN = 60_000;
const THU_OPEN = Date.UTC(2026, 10, 19, 14, 30);          // Thu 19 Nov 2026 09:30 New York (EST, UTC-5)
const WED_OPEN = Date.UTC(2026, 10, 18, 14, 30);
const FRI_OPEN = Date.UTC(2026, 10, 20, 14, 30);
const SESSION_MIN = 390;
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const bar = (time: number, base: number, vol?: number): OHLCV => { const o = base + rnd(), c = base + rnd(), h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); return { time, open: o, high: h, low: l, close: c, volume: vol ?? 100 + Math.floor(rnd() * 900) }; };
const run = (start: number, n: number, step: number, base: number, vol?: () => number) => Array.from({ length: n }, (_, i) => bar(start + i * step, base + i * 0.05, vol?.()));
const handVwap = (c: OHLCV[]) => { let pv = 0, v = 0; return c.map((k) => { pv += ((k.high + k.low + k.close) / 3) * k.volume; v += k.volume; return pv / v; }); };

let innerCalls = 0;
const inner = (id: string): StrategyDef => ({ id, detect: (): StrategyResult => { innerCalls++; return { ...WAIT, params: { inner: true } }; } } as unknown as StrategyDef);
const gated = (id: string) => withMarketGate(inner(id));
const ctx = (coin: string) => ({ coin, tf: '5m', tfMs: 5 * MIN }) as never;

const overnight = (from: number, n = 12) => Array.from({ length: n }, (_, i) => bar(from + i * 5 * MIN, 150));
const today = run(THU_OPEN, 30, 5 * MIN, 150);
const afterClose = overnight(THU_OPEN + SESSION_MIN * MIN);                       // 16:00 NY onward: closed
const yesterday = run(WED_OPEN, 78, 5 * MIN, 140);

test('W1. the line is the running VWAP of the last cash session; the gate answers WAIT marketClosed and never runs the strategy', () => {
  innerCalls = 0;
  const candles = [...today, ...afterClose]; const r = gated('vwap_reclaim').detect(candles, ctx('aapl'));
  assert.equal(r.verdict, 'wait'); assert.equal(r.params.marketClosed, true); assert.equal(innerCalls, 0, 'the strategy ran on a closed market');
  const ov = r.overlay!; assert.ok(ov, 'no overlay on a closed market'); assert.equal(ov.lines.length, 1); assert.deepEqual(ov.levels, []); assert.deepEqual(ov.zones, []);
  const line = ov.lines[0]; assert.equal(line.role, 'ref'); assert.equal(line.labelKey, 'STRAT_OV_VWAP');
  const want = handVwap(today); assert.equal(line.points.length, want.length);
  line.points.forEach((p, i) => { assert.equal(p.ts, today[i].time, `point ${i} time`); assert.ok(Math.abs(p.price - want[i]) < 1e-9, `point ${i}: ${p.price} vs ${want[i]}`); });
  const plain = today.map((k) => (k.high + k.low + k.close) / 3).reduce((a, b) => a + b, 0) / today.length;
  assert.ok(Math.abs(line.points.at(-1)!.price - plain) > 1e-6, 'control: the volumes must make a plain mean differ from the VWAP, or this cannot tell them apart');
});

test('W2. only the last session: yesterday\'s cash candles are not in the line', () => {
  const candles = [...yesterday, ...overnight(WED_OPEN + SESSION_MIN * MIN, 210), ...today, ...afterClose]; const line = gated('vwap_reclaim').detect(candles, ctx('aapl')).overlay!.lines[0];
  assert.equal(line.points.length, today.length); assert.equal(line.points[0].ts, THU_OPEN);
  assert.ok(Math.abs(line.points.at(-1)!.price - handVwap(today).at(-1)!) < 1e-9);
});

test('W3. an unbroken run: a hole of more than an hour inside the session starts the run after it', () => {
  const a = run(THU_OPEN, 10, 5 * MIN, 150), b = run(THU_OPEN + 4 * 60 * MIN, 12, 5 * MIN, 151);      // 4 hours apart, both inside the session
  const line = gated('vwap_reclaim').detect([...a, ...b, ...afterClose], ctx('aapl')).overlay!.lines[0];
  assert.equal(line.points.length, b.length); assert.equal(line.points[0].ts, b[0].time);
});

test('W4. one candle, no volume, no cash candle at all: nothing is drawn but the WAIT stays marketClosed', () => {
  const one = [bar(THU_OPEN + 60 * MIN, 150), ...afterClose]; const noVol = [...run(THU_OPEN, 10, 5 * MIN, 150, () => 0), ...afterClose]; const none = overnight(THU_OPEN + SESSION_MIN * MIN, 20);
  for (const [name, candles] of [['one candle', one], ['no volume', noVol], ['no cash candle', none]] as const) {
    const r = gated('vwap_reclaim').detect(candles, ctx('aapl')); assert.equal(r.params.marketClosed, true, name); assert.equal(r.overlay, undefined, `${name} drew a line`);
  }
});

test('W5. other session strategies get no VWAP line; a crypto coin and an open market are the strategy\'s own answer', () => {
  const candles = [...today, ...afterClose];
  for (const id of ['ny_open_breakout', 'session_sweep']) { const r = gated(id).detect(candles, ctx('aapl')); assert.equal(r.params.marketClosed, true, id); assert.equal(r.overlay, undefined, `${id} got a VWAP line from the gate`); }
  innerCalls = 0; assert.deepEqual(gated('vwap_reclaim').detect(candles, ctx('btc')).params, { inner: true }); assert.equal(innerCalls, 1, 'a crypto coin must reach the strategy');
  innerCalls = 0; const open = gated('vwap_reclaim').detect(today, ctx('aapl')); assert.equal(innerCalls, 1, 'an open market must reach the strategy'); assert.deepEqual(open.params, { inner: true }); assert.equal(open.overlay, undefined);
});

test('W6. weekend: the last Friday session is the run', () => {
  const fri = run(FRI_OPEN, 40, 5 * MIN, 152), sat = Array.from({ length: 20 }, (_, i) => bar(Date.UTC(2026, 10, 21, 15, 0) + i * 5 * MIN, 152)), sun = Array.from({ length: 10 }, (_, i) => bar(Date.UTC(2026, 10, 22, 15, 0) + i * 5 * MIN, 152));
  const line = gated('vwap_reclaim').detect([...today, ...fri, ...sat, ...sun], ctx('aapl')).overlay!.lines[0];
  assert.equal(line.points.length, fri.length, 'Saturday and Sunday candles are closed: the run is Friday\'s'); assert.equal(line.points[0].ts, FRI_OPEN);
});
