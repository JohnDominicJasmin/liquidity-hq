import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSessionSweep } from '../lib/strategies/sessionSweep.ts';
import { sessionFixture, sessionCall, type C } from '../qa/fixtures/strategyFixtures.ts';

/* #2608 THE SESSION SWEEP SIGNALS ONCE PER SESSION AND DIRECTION. Rule from the PR text and header: the session range is the lowest low / highest high of the candles that open inside Asia (00-08 UTC) or London (07-12 UTC);
 * a candle opening 0-4 h (by UTC hour number) after the session ends that wicks below the low and closes back at or above it is a BUY (mirror: SELL); IF AN EARLIER CANDLE AFTER THE SESSION ENDED, in the same window,
 * already swept that side and closed back inside, the later candle is NOT a signal; the opposite direction is independent; a sweep in the NEXT session is a new signal; an earlier candle that closed BEYOND the extreme
 * (a break, not a sweep) does not use the sweep up. The ORACLE `onceCall` below is QA's own (it extends QA's session oracle with that rule).
 *   O1 hand cases (1h and 15m)   O2 the app equals the oracle on every window of seeded random series at 1h and 15m, with controls that the once rule actually suppressed signals */
const H = 3_600_000;
const ctx = (tfMs: number) => ({ coin: 'btc', tf: tfMs === H ? '1h' : '15m', tfMs }) as never;
const toApp = (c: C[]) => c.map((x) => ({ ...x, volume: 0 }));
type V = 'BUY' | 'SELL' | 'WAIT';
const appV = (c: C[], tfMs: number): V => { const r = detectSessionSweep(toApp(c), ctx(tfMs)); return r.verdict === 'buy' ? 'BUY' : r.verdict === 'sell' ? 'SELL' : 'WAIT'; };
const SESS = [{ startH: 0, endH: 8 }, { startH: 7, endH: 12 }];

/** QA's oracle: the first session (Asia, then London) whose window the last candle is in and that has a sweep decides; `once` = apply the new rule. */
function onceCall(c: C[], once: boolean): V {
  const x = c[c.length - 1], d = new Date(x.time), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), hr = d.getUTCHours();
  for (const s of SESS) {
    if (hr < s.endH || hr > s.endH + 4) continue;
    const inS = c.filter((y) => y.time >= day + s.startH * H && y.time < day + s.endH * H); if (!inS.length) continue;
    const lo = Math.min(...inS.map((y) => y.low)), hi = Math.max(...inS.map((y) => y.high));
    const earlier = c.filter((y) => y.time >= day + s.endH * H && y.time < x.time);
    const lowDone = earlier.some((y) => y.low < lo && y.close >= lo), highDone = earlier.some((y) => y.high > hi && y.close <= hi);
    if (x.low < lo && x.close >= lo && !(once && lowDone)) return 'BUY';
    if (x.high > hi && x.close <= hi && !(once && highDone)) return 'SELL';
  }
  return 'WAIT';
}
const at = (t: number, lo: number, hi: number, close: number): C => ({ time: t, open: (lo + hi) / 2, high: hi, low: lo, close });

test('O1a. a sweep followed by a re-sweep of the same low in the window: the first candle signals, the second does not (asia and london, buy and sell)', () => {
  for (const session of ['asia', 'london'] as const) for (const sweep of ['low', 'high'] as const) {
    const fx = sessionFixture(session, sweep), n = fx.candles.length, last = fx.candles[n - 1], r = fx.range;
    assert.equal(appV(fx.candles, H), sweep === 'low' ? 'BUY' : 'SELL', `${session} ${sweep}: the first sweep signals`);
    const again = sweep === 'low' ? at(last.time + H, r.low - 200, r.low + 300, r.low + 100) : at(last.time + H, r.high - 300, r.high + 200, r.high - 100);
    const all = [...fx.candles, again]; assert.equal(onceCall(all, false), sweep === 'low' ? 'BUY' : 'SELL', 'CONTROL: without the once rule the re-sweep WOULD signal'); assert.equal(onceCall(all, true), 'WAIT');
    assert.equal(appV(all, H), 'WAIT', `${session} ${sweep}: the re-sweep must not signal`);
    const third = sweep === 'low' ? at(last.time + 2 * H, r.low - 100, r.low + 300, r.low + 50) : at(last.time + 2 * H, r.high - 300, r.high + 100, r.high - 50);
    assert.equal(appV([...all, third], H), 'WAIT', `${session} ${sweep}: a third sweep neither`);
  }
});
test('O1b. the opposite direction is independent: after a low sweep, a high sweep in the same window still signals SELL', () => {
  const fx = sessionFixture('asia', 'low'), last = fx.candles[fx.candles.length - 1], r = fx.range;
  const hi = at(last.time + H, r.high - 300, r.high + 200, r.high - 100); assert.equal(appV([...fx.candles, hi], H), 'SELL');
  assert.equal(appV([...fx.candles, at(last.time + H, r.low - 100, r.low + 300, r.low + 50), hi], H), 'SELL', 'a low re-sweep in between does not block the high');
});
test('O1c. a sweep in the NEXT session is a new signal: asia swept at 08:00, london swept at 12:00', () => {
  const fx = sessionFixture('asia', 'low'), day = Date.UTC(2026, 10, 17); const out = fx.candles.slice();
  for (let h = 9; h < 12; h++) out.push(at(day + h * H, 99_700 + h, 100_300 + h, 100_000 + h));   // quiet candles through the London session
  const london = out.filter((y) => y.time >= day + 7 * H && y.time < day + 12 * H), lLo = Math.min(...london.map((y) => y.low));
  out.push(at(day + 12 * H, lLo - 250, lLo + 200, lLo + 80));
  assert.equal(appV(out, H), 'BUY', 'a London sweep after an Asia sweep is a new signal'); assert.equal(onceCall(out, true), 'BUY');
});
test('O1d. an earlier candle that CLOSED BEYOND the extreme (a break) is not a sweep: the later wick-and-return still signals', () => {
  const fx = sessionFixture('asia', 'none'), day = Date.UTC(2026, 10, 17), r = fx.range; const out = fx.candles.slice();
  out.push(at(day + 8 * H, r.low - 400, r.low + 100, r.low - 250));       // 08:00 closes below the low: a break, no signal
  assert.equal(appV(out, H), 'WAIT', 'CONTROL: the break candle itself is not a signal');
  out.push(at(day + 9 * H, r.low - 150, r.low + 300, r.low + 90));        // 09:00 wicks below and closes back inside
  assert.equal(onceCall(out, true), 'BUY'); assert.equal(appV(out, H), 'BUY', 'the break did not use the sweep up');
});
test('O1e. the same on a 15m chart: the first sweep candle signals, the next 15m candle re-sweeping does not', () => {
  const Q = 900_000, day = Date.UTC(2026, 10, 17); const out: C[] = [];
  for (let t = day - 24 * H; t < day + 8 * H; t += Q) out.push(at(t, 99_800 + Math.sin(t / 1e6) * 50, 100_200 + Math.sin(t / 1e6) * 50, 100_000));
  const inS = out.filter((y) => y.time >= day && y.time < day + 8 * H), lo = Math.min(...inS.map((y) => y.low));
  out.push(at(day + 8 * H, lo - 200, lo + 150, lo + 60)); assert.equal(appV(out, Q), 'BUY');
  out.push(at(day + 8 * H + Q, lo - 120, lo + 150, lo + 40)); assert.equal(onceCall(out, false), 'BUY', 'CONTROL'); assert.equal(appV(out, Q), 'WAIT');
});

function series(seed: number, tfMs: number, days: number): C[] {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: C[] = []; let p = 100_000; const t0 = Date.UTC(2026, 9, 1);
  for (let t = t0; t < t0 + days * 24 * H; t += tfMs) { const step = Math.sqrt(tfMs / H); const cl = p * (1 + (rnd() - 0.5) * 0.004 * step), hi = Math.max(p, cl) * (1 + rnd() * 0.0015 * step), lo = Math.min(p, cl) * (1 - rnd() * 0.0015 * step); out.push({ time: t, open: p, high: hi, low: lo, close: cl }); p = cl; }
  return out;
}
test('O2. the app equals the oracle on every window of seeded random series (1h and 15m), and the once rule really suppressed signals in the sample', () => {
  const seen = { buy: 0, sell: 0, suppressed: 0, windows: 0 }; const bad: string[] = [];
  for (const tfMs of [H, 900_000]) for (let seed = 1; seed <= 24; seed++) {
    const cs = series(seed * 104729, tfMs, 12);
    for (let end = 12; end <= cs.length; end++) {
      const w = cs.slice(Math.max(0, end - 300), end), o = onceCall(w, true), app = appV(w, tfMs); seen.windows++;
      if (app !== o && bad.length < 6) bad.push(`${tfMs === H ? '1h' : '15m'} seed ${seed} end ${new Date(cs[end - 1].time).toISOString()}: app ${app} oracle ${o}`);
      if (o === 'BUY') seen.buy++; if (o === 'SELL') seen.sell++; if (o === 'WAIT' && onceCall(w, false) !== 'WAIT') seen.suppressed++;
    }
  }
  assert.deepEqual(bad, [], 'app and oracle disagree');
  assert.ok(seen.buy >= 20 && seen.sell >= 20, `CONTROL: too few signals (buy ${seen.buy}, sell ${seen.sell})`); assert.ok(seen.suppressed >= 20, `CONTROL: the once rule suppressed only ${seen.suppressed} candles in the sample`);
  /* the unchanged oracle (QA's shared session oracle, no once rule) must still equal the app on every window with NO earlier sweep, so nothing else moved */
  let checked = 0; for (const tfMs of [H]) for (let seed = 1; seed <= 12; seed++) { const cs = series(seed * 104729, tfMs, 12); for (let end = 12; end <= cs.length; end++) { const w = cs.slice(Math.max(0, end - 300), end); if (onceCall(w, true) !== onceCall(w, false)) continue; const sc = sessionCall(w, { startH: 0, endH: 8 }); const lc = sessionCall(w, { startH: 7, endH: 12 }); const base = sc.verdict !== 'WAIT' ? sc.verdict : lc.verdict; assert.equal(appV(w, tfMs), base, `no earlier sweep: app vs shared oracle at ${new Date(cs[end - 1].time).toISOString()}`); checked++; } }
  assert.ok(checked > 1000, `CONTROL: only ${checked} comparisons`);
});
