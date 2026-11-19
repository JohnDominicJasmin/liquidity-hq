import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectEmaStack, EMA_STACK, FRESH_BARS, MIN_CANDLES, MIN_UNSTACKED } from '../lib/strategies/emaStack.ts';
import { emaArr } from '../lib/strategyCore.ts';

/* QA's cells for strategy 3 (#2311, rewritten for #2607): EMA 20/50/100/200 stack SIGNALLED ON ITS FORMATION ONLY. The ORACLE below is written from the new header, with its own SMA-seeded EMA (not emaArr) and its own loops:
 *   a bullish stack is EMA20 > EMA50 > EMA100 > EMA200 (bearish the reverse); "holds" on a candle = the stack is in that order AND the close is on the trend side of the 20 (above for bullish, below for bearish);
 *   FORMATION = the FIRST candle of the current unbroken run of "holds"; it signals only if the stack had been OUT of that order for at least 10 candles right before it (a stack that breaks for a candle or two and re-forms is the same stack);
 *   the signal stays current for FRESH_BARS (3) candles after the formation candle while the stack still holds; the pullback signal is GONE (a pullback candle in an established stack is WAIT); needs 230 candles.
 *   E1 fixtures by hand   E2 one-candle wobble does not re-fire   E3 the 9-vs-10 gap boundary and the oracle over regime-switching series (both directions, every window, with controls that both fire and no-fire cases of every kind occur)
 *   E4 the reason keys and labels carry the new rule */

const T0 = 1_700_000_000_000; const TF = 3_600_000;
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const candle = (i: number, close: number, prev: number): C => ({ time: T0 + i * TF, open: prev, close, high: Math.max(prev, close) + 0.3, low: Math.min(prev, close) - 0.3, volume: 100 });
function trend(n: number, start: number, slope: number): C[] { const cs: C[] = []; let p = start; for (let i = 0; i < n; i++) { const c = start + slope * i; cs.push(candle(i, c, p)); p = c; } return cs; }
const ctx = { coin: 'btc', tf: '1h', tfMs: TF };

/* ── the oracle ── */
function sma0Ema(closes: number[], period: number): number[] {   // NaN until `period` closes exist, seeded with their plain average, then k = 2/(period+1)
  const out: number[] = new Array(closes.length).fill(NaN); if (closes.length < period) return out;
  let sum = 0; for (let i = 0; i < period; i++) sum += closes[i]; let e = sum / period; out[period - 1] = e; const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) { e = closes[i] * k + e * (1 - k); out[i] = e; } return out;
}
interface Call { verdict: 'buy' | 'sell' | 'wait'; formationIdx: number; gap: number }
function stackCall(cs: C[]): Call {
  const n = cs.length; const wait: Call = { verdict: 'wait', formationIdx: -1, gap: -1 }; if (n < 230) return wait;
  const cl = cs.map((c) => c.close), a = sma0Ema(cl, 20), b = sma0Ema(cl, 50), c = sma0Ema(cl, 100), d = sma0Ema(cl, 200);
  const side = (i: number): 1 | -1 | 0 => (a[i] > b[i] && b[i] > c[i] && c[i] > d[i] ? 1 : a[i] < b[i] && b[i] < c[i] && c[i] < d[i] ? -1 : 0);
  const s = side(n - 1); if (s === 0) return wait;
  const holds = (i: number) => side(i) === s && (s === 1 ? cl[i] > a[i] : cl[i] < a[i]);
  if (!holds(n - 1)) return wait;
  let first = n - 1; while (first > 0 && holds(first - 1)) first--;
  let gap = 0; for (let q = first - 1; q >= 0 && side(q) !== s; q--) gap++;   // consecutive candles right before the formation that are out of this order
  if (gap < 10) return { verdict: 'wait', formationIdx: first, gap };
  if (first < n - 3) return { verdict: 'wait', formationIdx: first, gap };
  return { verdict: s === 1 ? 'buy' : 'sell', formationIdx: first, gap };
}

/* ── E1 by hand ── */
test('E1a. constants: 230 candles, FRESH_BARS 3, MIN_UNSTACKED 10; under 230 candles is wait', () => {
  assert.equal(MIN_CANDLES, 230); assert.equal(EMA_STACK.minCandles, 230); assert.equal(FRESH_BARS, 3); assert.equal(MIN_UNSTACKED, 10);
  assert.equal(detectEmaStack(trend(229, 100, 1), ctx).verdict, 'wait');
});
test('E1b. FORMATION after a long unstacked stretch: BUY on the candle the bullish stack forms, current for 3 candles then WAIT; the mirror SELLs', () => {
  const flat = Array.from({ length: 240 }, (_, i) => candle(i, 100, 100)); const mk = (sign: 1 | -1) => { const out: C[] = flat.slice(); let p = 100; for (let i = 0; i < 70; i++) { const c = 100 + sign * 2 * (i + 1); out.push(candle(240 + i, c, p)); p = c; } return out; };
  for (const [sign, verdict, dir] of [[1, 'buy', 'long'], [-1, 'sell', 'short']] as const) {
    const all = mk(sign); let first = -1; for (let k = 230; k <= all.length; k++) if (detectEmaStack(all.slice(0, k), ctx).verdict === verdict) { first = k; break; }
    assert.ok(first > 0, `${verdict}: the stack never formed in the fixture`);
    const r = detectEmaStack(all.slice(0, first), ctx); assert.equal(r.signalDir, dir); assert.equal(r.signalTimestamp, all[first - 1].time, 'stamped on the formation candle');
    assert.equal(stackCall(all.slice(0, first)).verdict, verdict, 'oracle agrees'); assert.equal(stackCall(all.slice(0, first)).formationIdx, first - 1);
    for (const k of [1, 2]) { const later = detectEmaStack(all.slice(0, first + k), ctx); assert.equal(later.verdict, verdict, `+${k}`); assert.equal(later.signalTimestamp, r.signalTimestamp, 'same identity: the page pings once'); }
    assert.equal(detectEmaStack(all.slice(0, first + FRESH_BARS), ctx).verdict, 'wait', 'stale after FRESH_BARS');
  }
});
test('E1c. the PULLBACK signal is gone: a candle that dips to the 20 and closes back above it in an established stack is WAIT (bullish and bearish)', () => {
  const N = 260; const up = trend(N, 100, 1); const e = (cs: C[]) => sma0Ema(cs.map((c) => c.close), 20);
  const upP = up.slice(); upP[N - 1] = { ...upP[N - 1], low: e(upP)[N - 1] - 0.05 };
  const dn = trend(N, 500, -1); const dnP = dn.slice(); dnP[N - 1] = { ...dnP[N - 1], high: e(dnP)[N - 1] + 0.05 };
  assert.equal(detectEmaStack(upP, ctx).verdict, 'wait', 'bullish pullback candle'); assert.equal(detectEmaStack(dnP, ctx).verdict, 'wait', 'bearish pullback candle');
  assert.equal(detectEmaStack(up, ctx).verdict, 'wait', 'a quiet established trend'); assert.equal(detectEmaStack(trend(N, 100, 0), ctx).verdict, 'wait', 'flat: no ordered stack');
});
test('E1d. the stack needs ALL four in order: 20 > 50 > 100 with the 100 still under the 200 is not a stack', () => {
  const cs: C[] = []; let p = 500; for (let i = 0; i < 200; i++) { const c = 500 - 1.5 * i; cs.push(candle(i, c, p)); p = c; } for (let i = 0; i < 60; i++) { const c = 200 + 4 * (i + 1); cs.push(candle(200 + i, c, p)); p = c; }
  const cl = cs.map((x) => x.close), n = cs.length, a = emaArr(cl, 20), b = emaArr(cl, 50), c = emaArr(cl, 100), d = emaArr(cl, 200);
  assert.ok(a[n - 1] > b[n - 1] && b[n - 1] > c[n - 1] && c[n - 1] < d[n - 1], 'CONTROL: 20 > 50 > 100 but 100 < 200'); assert.equal(detectEmaStack(cs, ctx).verdict, 'wait');
});

/* ── E2 a wobble does not re-arm it ── */
test('E2. a one-candle dip under the 20 in an established stack (the stack stays in order) and the re-formation next candle is WAIT, not a new signal', () => {
  const N = 252; const cs = trend(N, 100, 1);
  cs[N - 2] = { ...cs[N - 2], close: cs[N - 2].close - 14, low: cs[N - 2].close - 14.3 };   // the wobble: close well under the 20, the stack still in order
  const cl = cs.map((x) => x.close), a = sma0Ema(cl, 20), b = sma0Ema(cl, 50), c = sma0Ema(cl, 100), d = sma0Ema(cl, 200), w = N - 2;
  assert.ok(a[w] > b[w] && b[w] > c[w] && c[w] > d[w] && cl[w] < a[w], 'CONTROL: stack in order, close under the 20 on the wobble candle');
  assert.ok(cl[N - 1] > a[N - 1] && a[N - 1] > b[N - 1], 'CONTROL: the next candle closes back above the 20 (holds again)');
  assert.equal(stackCall(cs).verdict, 'wait', 'oracle: the stack had been in order the candle before, so it is not a new formation');
  assert.equal(detectEmaStack(cs, ctx).verdict, 'wait', 'a re-formation after a one-candle wobble must not fire');
});

/* ── E3 the oracle over regime-switching series ── */
function regime(seed: number, n = 640): C[] {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: C[] = []; let p = 1000, drift = 0, left = 0;
  for (let i = 0; i < n; i++) { if (left <= 0) { left = 25 + Math.floor(rnd() * 90); drift = (rnd() - 0.5) * 0.012 * (rnd() < 0.25 ? 0 : 1); } left--; const c = p * (1 + drift + (rnd() - 0.5) * 0.012); out.push({ time: T0 + i * TF, open: p, close: c, high: Math.max(p, c) * (1 + rnd() * 0.002), low: Math.min(p, c) * (1 - rnd() * 0.002), volume: 100 }); p = c; }
  return out;
}
test('E3. the app equals the oracle on every window of 240 regime-switching series; the gap boundary (9 no, 10 yes) and both directions are exercised', () => {
  const seen = { buy: 0, sell: 0, gap9: 0, gap10: 0, gapUnder10Wait: 0, stale: 0, windows: 0 }; const bad: string[] = [];
  for (let seed = 1; seed <= 240; seed++) {
    const cs = regime(seed * 7919);
    for (let end = 230; end <= cs.length; end++) {
      const w = cs.slice(0, end), o = stackCall(w), app = detectEmaStack(w, ctx); seen.windows++;
      if (app.verdict !== o.verdict && bad.length < 6) bad.push(`seed ${seed} end ${end}: app ${app.verdict} oracle ${o.verdict} (formation ${o.formationIdx}, gap ${o.gap})`);
      if (o.verdict !== 'wait' && app.verdict === o.verdict && app.signalTimestamp !== w[o.formationIdx].time && bad.length < 6) bad.push(`seed ${seed} end ${end}: signal stamped ${app.signalTimestamp}, oracle formation ${w[o.formationIdx].time}`);
      if (o.verdict === 'buy') seen.buy++; if (o.verdict === 'sell') seen.sell++;
      if (o.formationIdx >= end - 3 && o.formationIdx >= 0) { if (o.gap === 9) seen.gap9++; if (o.gap === 10) seen.gap10++; if (o.gap < 10) seen.gapUnder10Wait++; }
      if (o.formationIdx >= 0 && o.formationIdx < end - 3 && o.gap >= 10) seen.stale++;
    }
  }
  assert.deepEqual(bad, [], 'app and oracle disagree');
  assert.ok(seen.buy >= 8 && seen.sell >= 8, `CONTROL: too few signals to mean anything (buy ${seen.buy}, sell ${seen.sell})`);
  assert.ok(seen.gapUnder10Wait >= 8, `CONTROL: no re-formations with a short gap in the sample (${seen.gapUnder10Wait}): the wobble rule is untested`);
  assert.ok(seen.gap10 >= 1, `CONTROL: no formation with a gap of exactly 10 in the sample (${seen.gap10}): the boundary is untested`); assert.ok(seen.gap9 >= 1, `CONTROL: no formation with a gap of exactly 9 (${seen.gap9})`);
  assert.ok(seen.stale >= 8, `CONTROL: no stale-after-3 cases (${seen.stale})`);
});

/* ── E4 reason keys and labels ── */
test('E4. no pullback reason key is ever returned; the description and wait labels carry the new rule', () => {
  for (const pullback of [true, false]) for (const v of ['buy', 'sell'] as const) assert.equal(EMA_STACK.reasonKeyFor ? EMA_STACK.reasonKeyFor({ verdict: v, signalTimestamp: 1, signalDir: v === 'buy' ? 'long' : 'short', params: { pullback } }) : null, null, `pullback=${pullback} ${v}`);
  const labels = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.ok(/10\+ candles/.test(labels.STRAT_EMASTACK_DESC) && !/pullback/i.test(labels.STRAT_EMASTACK_DESC), labels.STRAT_EMASTACK_DESC); assert.ok(!/pullback/i.test(labels.STRAT_EMASTACK_WAIT), labels.STRAT_EMASTACK_WAIT);
});
