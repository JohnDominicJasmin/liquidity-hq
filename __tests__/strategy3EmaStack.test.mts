import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmaStack, EMA_STACK, FRESH_BARS, MIN_CANDLES } from '../lib/strategies/emaStack.ts';
import { emaArr } from '../lib/strategyCore.ts';

/* QA's unit cells for strategy 3 (#2311): EMA 20/50/100/200 stack, traded on the pullback. Rules from the PR text: a bullish stack is EMA20 > EMA50 > EMA100 > EMA200 (bearish the reverse); BUY on a pullback =
 * a candle whose LOW reaches the 20 (or 50) and CLOSES back above the 20, with the stack in order; SELL the mirror; a candle that goes THROUGH the 100 has broken the zone, not pulled back into it; the
 * fresh formation (the candle the stack first formed on, close on the right side of the 20) is the secondary signal; either is current only while within the last 3 closed candles; needs 230 candles. */

const T0 = 1_700_000_000_000; const TF = 3_600_000;
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const candle = (i: number, close: number, prev: number): C => ({ time: T0 + i * TF, open: prev, close, high: Math.max(prev, close) + 0.3, low: Math.min(prev, close) - 0.3, volume: 100 });
/** A steady trend: `n` candles from `start`, `slope` per candle. */
function trend(n: number, start: number, slope: number): C[] { const cs: C[] = []; let p = start; for (let i = 0; i < n; i++) { const c = start + slope * i; cs.push(candle(i, c, p)); p = c; } return cs; }
const ctx = { coin: 'btc', tf: '1h', tfMs: TF };
const emas = (cs: C[]) => { const cl = cs.map(c => c.close); return { e20: emaArr(cl, 20), e50: emaArr(cl, 50), e100: emaArr(cl, 100), e200: emaArr(cl, 200) }; };
/** Replace the last candle with a pullback candle: low at `low(emas)`, close kept. Recomputes with the new candle (EMA depends on the close only, so the close stays). */
function withLast(cs: C[], p: (e: ReturnType<typeof emas>, last: C) => Partial<C>): C[] { const out = cs.slice(); const n = out.length; out[n - 1] = { ...out[n - 1], ...p(emas(out), out[n - 1]) }; return out; }
const N = 260;

test('3-a. BUY on the pullback: low reaches the 20 and the candle closes back above it, bullish stack in order', () => {
  const cs = withLast(trend(N, 100, 1), e => ({ low: e.e20[N - 1] - 0.05 }));
  const r = detectEmaStack(cs, ctx);
  assert.equal(r.verdict, 'buy'); assert.equal(r.signalDir, 'long'); assert.equal(r.signalTimestamp, cs[N - 1].time);
  assert.equal(r.params.pullback, true); assert.equal(r.params.tag, 20, 'reached the 20 only');
});
test('3-b. a deeper pullback that reaches the 50 (still above the 100) is tagged 50', () => {
  const cs = withLast(trend(N, 100, 1), e => ({ low: e.e50[N - 1] - 0.05 }));
  const r = detectEmaStack(cs, ctx); assert.equal(r.verdict, 'buy'); assert.equal(r.params.pullback, true); assert.equal(r.params.tag, 50);
});
test('3-c. SELL on the mirror: a bearish stack, the high reaches the 20 and the candle closes back below it', () => {
  const cs = withLast(trend(N, 500, -1), e => ({ high: e.e20[N - 1] + 0.05 }));
  const r = detectEmaStack(cs, ctx);
  assert.equal(r.verdict, 'sell'); assert.equal(r.signalDir, 'short'); assert.equal(r.params.pullback, true); assert.equal(r.params.tag, 20);
  const deep = detectEmaStack(withLast(trend(N, 500, -1), e => ({ high: e.e50[N - 1] + 0.05 })), ctx); assert.equal(deep.params.tag, 50);
});
test('3-d. THROUGH the 100 is a break, not a pullback: a low under the 100 gives no pullback signal (wait in an established stack)', () => {
  const cs = withLast(trend(N, 100, 1), e => ({ low: e.e100[N - 1] - 1 }));
  assert.equal(detectEmaStack(cs, ctx).verdict, 'wait');
  const bear = withLast(trend(N, 500, -1), e => ({ high: e.e100[N - 1] + 1 }));
  assert.equal(detectEmaStack(bear, ctx).verdict, 'wait', 'the bearish mirror: through the 100 is not a pullback');
});
test('3-e. a touch that closes BELOW the 20 (no bounce) is not a buy; a quiet trend with no touch is wait; no stack is wait; under 230 candles is wait', () => {
  const dropped = trend(N, 100, 1); dropped[N - 1] = { ...dropped[N - 1], close: dropped[N - 1].close - 14, low: dropped[N - 1].close - 14.3 };   // a sharp drop: the low is far under the 20 and the close stays under it
  const ed = emas(dropped); assert.ok(dropped[N - 1].close < ed.e20[N - 1] && ed.e20[N - 1] > ed.e50[N - 1] && ed.e50[N - 1] > ed.e100[N - 1], 'CONTROL: the stack is still in order, the close is under the 20');
  assert.equal(detectEmaStack(dropped, ctx).verdict, 'wait', 'closed under the 20: no bounce, no buy');
  assert.equal(detectEmaStack(trend(N, 100, 1), ctx).verdict, 'wait', 'established stack, no touch, formation long past');
  assert.equal(detectEmaStack(trend(N, 100, 0), ctx).verdict, 'wait', 'flat: no ordered stack');
  assert.equal(MIN_CANDLES, 230); assert.equal(detectEmaStack(withLast(trend(229, 100, 1), e => ({ low: e.e20[228] - 0.05 })), ctx).verdict, 'wait', '229 candles');
  assert.equal(EMA_STACK.minCandles, 230);
});
test('3-f. NO REPEAT: a pullback signal is current for FRESH_BARS candles (same identity) and then reads wait', () => {
  assert.equal(FRESH_BARS, 3);
  const touched = withLast(trend(N, 100, 1), e => ({ low: e.e20[N - 1] - 0.05 }));
  const later = (k: number): C[] => { const cs = touched.slice(); let p = cs[N - 1].close; for (let j = 1; j <= k; j++) { const c = p + 1; cs.push(candle(N - 1 + j, c, p)); p = c; } return cs; };
  const at0 = detectEmaStack(touched, ctx); const at1 = detectEmaStack(later(1), ctx); const at2 = detectEmaStack(later(2), ctx); const at3 = detectEmaStack(later(3), ctx);
  assert.equal(at0.verdict, 'buy'); assert.equal(at1.verdict, 'buy'); assert.equal(at2.verdict, 'buy');
  assert.equal(at1.signalTimestamp, at0.signalTimestamp); assert.equal(at2.signalTimestamp, at0.signalTimestamp, 'the page pings once per touch');
  assert.equal(at3.verdict, 'wait', 'three candles on, the touch is stale');
});
test('3-g. FRESH FORMATION (secondary): the candle the stack first formed on signals once, with pullback=false, and goes stale after FRESH_BARS', () => {
  const flat = Array.from({ length: 240 }, (_, i) => candle(i, 100, 100)); const up: C[] = []; let p = 100;
  for (let i = 0; i < 70; i++) { const c = 100 + 2 * (i + 1); up.push(candle(240 + i, c, p)); p = c; }
  const all = [...flat, ...up];
  let first = -1; for (let k = 230; k <= all.length; k++) if (detectEmaStack(all.slice(0, k), ctx).verdict === 'buy') { first = k; break; }
  assert.ok(first > 0, 'the stack never formed in the fixture');
  const r = detectEmaStack(all.slice(0, first), ctx);
  assert.equal(r.params.pullback, false, 'a formation, not a pullback'); assert.equal(r.signalDir, 'long');
  assert.equal(detectEmaStack(all.slice(0, first + FRESH_BARS), ctx).verdict, 'wait', 'a formation is stale after FRESH_BARS candles');
});
test('3-h. the reason sentence: a pullback uses the PULLBACK key (buy/sell), a formation uses the default key', () => {
  const pull = (v: 'buy' | 'sell') => EMA_STACK.reasonKeyFor!({ verdict: v, signalTimestamp: 1, signalDir: v === 'buy' ? 'long' : 'short', params: { pullback: true } });
  assert.equal(pull('buy'), 'STRAT_EMASTACK_BUY_PULLBACK'); assert.equal(pull('sell'), 'STRAT_EMASTACK_SELL_PULLBACK');
  assert.equal(EMA_STACK.reasonKeyFor!({ verdict: 'buy', signalTimestamp: 1, signalDir: 'long', params: { pullback: false } }), null);
});

test('3-i. the stack needs ALL four in order: a recovery where 20 > 50 > 100 but the 100 is still under the 200 is not a stack, so a pullback there is wait', () => {
  const cs: C[] = []; let p = 500;
  for (let i = 0; i < 200; i++) { const c = 500 - 1.5 * i; cs.push(candle(i, c, p)); p = c; }
  for (let i = 0; i < 60; i++) { const c = 200 + 4 * (i + 1); cs.push(candle(200 + i, c, p)); p = c; }
  const e = emas(cs); const n = cs.length;
  assert.ok(e.e20[n - 1] > e.e50[n - 1] && e.e50[n - 1] > e.e100[n - 1] && e.e100[n - 1] < e.e200[n - 1], 'CONTROL: 20 > 50 > 100 but 100 < 200');
  cs[n - 1] = { ...cs[n - 1], low: e.e20[n - 1] - 0.05 };
  assert.equal(detectEmaStack(cs, ctx).verdict, 'wait');
});
