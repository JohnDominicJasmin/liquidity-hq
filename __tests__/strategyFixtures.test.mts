/* PHASE-1 STRATEGY FIXTURES + ORACLES (#1263 owner decision 2026-11-17): the synthetic candles must hit the intended event, and the oracle must answer the rule the issue states, or every later comparison with the app proves nothing.
 *   SF1  golden/death cross: the fixture cut AT the cross gives BUY/SELL with entry = last close and stop = the 20-candle extreme; cut one candle EARLIER gives WAIT
 *   SF2  S/R flip: a retest candle that touches the level and closes back beyond it gives BUY (resistance) / SELL (support), stop = min(level, low) / max(level, high), target = the next level; no touch = WAIT
 *   SF3  range bounce: the fixture's flat range has >= 3 touches each side; a wick to the low that closes inside = BUY with target = the opposite edge; mid-range = WAIT; fewer than 3 touches = WAIT
 *   SF4  fair value gap: the return into an unfilled gap that closes beyond its far edge = BUY/SELL, stop = the gap edge; no return = WAIT; a filled gap = WAIT
 *   SF5  session sweep: Asia and London, a wick through the session low/high that closes back inside = BUY/SELL, stop = the wick, target = the opposite side; an ordinary candle = WAIT; before the session ends = WAIT
 *   SF6  R:R arithmetic and "no target = no R:R"
 * WHAT IT CANNOT PROVE: the app (it does not exist yet). The browser/unit comparisons run when each strategy lands. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crossCall, crossFixture, flipCall, flipFixture, flipLevelFromChart, srLevels, nearestR, rangeCall, rangeFixture, fvgCall, fvgFixture, sessionCall, sessionFixture, rrOf, nearest, emaSeries } from '../qa/fixtures/strategyFixtures.ts';
import { detectStructures } from '../lib/chartStructureDetect.ts';

test('SF1. golden / death cross: BUY/SELL exactly at the cross, WAIT one candle earlier', () => {
  for (const [dir, verdict] of [['golden', 'BUY'], ['death', 'SELL']] as const) {
    const at = crossFixture(dir, 'atCross'), before = crossFixture(dir, 'beforeCross'), z = [{ price: at[at.length - 1].close * (dir === 'golden' ? 1.08 : 0.92) }];
    const c = crossCall(at, z); assert.equal(c.verdict, verdict, `${dir}: expected ${verdict} at the cross`);
    const last = at[at.length - 1], w = at.slice(-20); assert.equal(c.entry, last.close);
    assert.equal(c.stop, dir === 'golden' ? Math.min(...w.map((x) => x.low)) : Math.max(...w.map((x) => x.high)), 'stop is not the 20-candle extreme');
    assert.equal(c.target, z[0].price); assert.equal(crossCall(before, z).verdict, 'WAIT', `${dir}: a call one candle before the cross`);
    const cl = at.map((x) => x.close), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200), k = at.length - 1; assert.ok(dir === 'golden' ? e50[k] > e200[k] && e50[k - 1] <= e200[k - 1] : e50[k] < e200[k] && e50[k - 1] >= e200[k - 1], 'the fixture is not cut at a real cross');
  }
});

test('SF2. S/R flip: the retest that touches and closes back beyond = the call; no touch = WAIT', () => {
  for (const side of ['resistance', 'support'] as const) {
    const fx = flipFixture(side, true), ctl = flipFixture(side, false), last = fx.candles[fx.candles.length - 1], verdict = side === 'resistance' ? 'BUY' : 'SELL';
    /* THE LEVEL IS THE CHART'S OWN (swing highs / lows forming a cluster), not injected: derived from the candles before the break */
    const fromChart = flipLevelFromChart(fx.candles, fx.candles.length - 4, side); assert.ok(fromChart != null && Math.abs(fromChart - fx.level) / fx.level < 0.002, `${side}: the chart's own S/R does not find the level (${fromChart} vs ${fx.level})`);
    const lv = srLevels(fx.candles.slice(0, fx.candles.length - 4), fx.candles[fx.candles.length - 5].close).filter((l) => l.type === side); assert.ok(lv.length > 0 && Math.max(...lv.map((l) => l.touches)) >= 3, `${side}: the level has fewer than 3 touches`);
    const stopP = side === 'resistance' ? Math.min(fx.level, last.low) : Math.max(fx.level, last.high), risk = Math.abs(last.close - stopP), sgn = side === 'resistance' ? 1 : -1;
    const nearZ = { price: last.close + sgn * 0.5 * risk }, next = last.close + sgn * 1.5 * risk, c = flipCall(fx.candles, fromChart as number, side, [nearZ, { price: next }, { price: last.close + sgn * 3 * risk }]);
    assert.equal(flipCall(fx.candles, fromChart as number, side, [nearZ]).target, null, `${side}: a level at 0.5R was taken as the target (PM: >= 1R only)`);
    assert.equal(c.verdict, verdict, `${side}: no ${verdict} on the retest`); assert.equal(c.entry, last.close);
    assert.equal(c.stop, stopP, 'stop is not just beyond the level / the retest wick');
    assert.equal(c.target, next, 'target is not the first level in the direction at >= 1R');
    assert.equal(flipCall(ctl.candles, ctl.level, side, []).verdict, 'WAIT', `${side}: a call without a touching retest`);
  }
});

test('SF3. range bounce: the flat range, the bounce at either edge, mid-range and thin ranges = WAIT', () => {
  const lo = rangeFixture('low'), hi = rangeFixture('high'), mid = rangeFixture('mid');
  assert.ok(lo.touchesLow >= 3 && lo.touchesHigh >= 3, `the fixture range has ${lo.touchesLow}/${lo.touchesHigh} touches`);
  const det = detectStructures(lo.candles.slice(0, -1).map((x) => ({ timestamp: x.time, open: x.open, high: x.high, low: x.low, close: x.close })), { timeframe: '4h' }); assert.ok(det.structures.some((s) => s.kind === 'range'), `the app detector does not see a flat range (kinds ${det.structures.map((s) => s.kind)}; ${det.reason})`);
  const b = rangeCall(lo.candles, lo.low, lo.high, lo.touchesLow, lo.touchesHigh), s = rangeCall(hi.candles, hi.low, hi.high, hi.touchesLow, hi.touchesHigh);
  assert.equal(b.verdict, 'BUY'); assert.equal(b.target, lo.high, 'a BUY target is the opposite edge'); assert.ok((b.stop as number) <= lo.low, 'a BUY stop is not beyond the low edge'); assert.equal(b.entry, lo.candles[lo.candles.length - 1].close);
  assert.equal(s.verdict, 'SELL'); assert.equal(s.target, hi.low); assert.ok((s.stop as number) >= hi.high);
  assert.equal(rangeCall(mid.candles, mid.low, mid.high, mid.touchesLow, mid.touchesHigh).verdict, 'WAIT', 'a call mid-range');
  assert.equal(rangeCall(lo.candles, lo.low, lo.high, 2, lo.touchesHigh).verdict, 'WAIT', 'a call with only 2 touches on a side');
});

test('SF4. fair value gap: the return into an unfilled gap = the call; no return or a filled gap = WAIT', () => {
  for (const dir of ['bull', 'bear'] as const) {
    const fx = fvgFixture(dir, true), ctl = fvgFixture(dir, false), verdict = dir === 'bull' ? 'BUY' : 'SELL', last = fx[fx.length - 1];
    const c = fvgCall(fx, []); assert.equal(c.verdict, verdict, `${dir}: no ${verdict} on the return into the gap`); assert.equal(c.entry, last.close);
    const gap = dir === 'bull' ? fx[fx.length - 5].high : fx[fx.length - 5].low; assert.equal(c.stop, gap, 'stop is not the gap edge');
    assert.ok(dir === 'bull' ? (c.stop as number) < (c.entry as number) : (c.stop as number) > (c.entry as number), 'stop is on the wrong side of entry');
    assert.equal(fvgCall(ctl, []).verdict, 'WAIT', `${dir}: a call with no return into the gap`);
    const filled = [...fx.slice(0, -1), { ...fx[fx.length - 2], time: fx[fx.length - 2].time + 1, close: dir === 'bull' ? gap - 50 : gap + 50, low: dir === 'bull' ? gap - 80 : fx[fx.length - 2].low, high: dir === 'bull' ? fx[fx.length - 2].high : gap + 80 }, last];
    assert.equal(fvgCall(filled, []).verdict, 'WAIT', `${dir}: a call on a gap already closed through`);
  }
});

test('SF5. Asia / London sweep: wick through the session extreme and close back inside = the call', () => {
  for (const session of ['asia', 'london'] as const) {
    const w = session === 'asia' ? { startH: 0, endH: 8 } : { startH: 7, endH: 12 };
    const lo = sessionFixture(session, 'low'), hi = sessionFixture(session, 'high'), none = sessionFixture(session, 'none');
    const b = sessionCall(lo.candles, w), s = sessionCall(hi.candles, w), lastLo = lo.candles[lo.candles.length - 1], lastHi = hi.candles[hi.candles.length - 1];
    assert.equal(b.verdict, 'BUY', `${session}: no BUY on a sweep of the low`); assert.equal(b.entry, lastLo.close); assert.equal(b.stop, lastLo.low, 'stop is not the sweep wick'); assert.equal(b.target, lo.range.high, 'target is not the opposite side of the range');
    assert.equal(s.verdict, 'SELL'); assert.equal(s.stop, lastHi.high); assert.equal(s.target, hi.range.low);
    assert.equal(sessionCall(none.candles, w).verdict, 'WAIT', `${session}: a call on an ordinary candle`);
    assert.equal(sessionCall(lo.candles.slice(0, -1), w).verdict, 'WAIT', `${session}: a call before the session ended`);
  }
});

test('SF6. R:R arithmetic; no target means no R:R; nearest level picks the right side', () => {
  assert.ok(Math.abs((rrOf(100, 96, 111.28) as number) - 2.82) < 1e-9); assert.equal(rrOf(100, 96, null), null); assert.equal(rrOf(100, 100, 120), null);
  assert.equal(nearest([{ price: 120 }, { price: 108 }, { price: 90 }], 100, 'BUY'), 108); assert.equal(nearest([{ price: 120 }, { price: 108 }, { price: 90 }, { price: 95 }], 100, 'SELL'), 95); assert.equal(nearest([{ price: 90 }], 100, 'BUY'), null);
});

test('SF7. the >=1R rule on the "nearest S/R" targets (cross, flip, FVG fallback); rule targets (range edge, session side) are unchanged', () => {
  const at = crossFixture('golden', 'atCross'), last = at[at.length - 1], stop = Math.min(...at.slice(-20).map((x) => x.low)), risk = last.close - stop;
  assert.equal(crossCall(at, [{ price: last.close + 0.5 * risk }]).target, null, 'cross: a 0.5R level became the target'); assert.equal(crossCall(at, [{ price: last.close + 0.5 * risk }]).rr, null);
  assert.equal(crossCall(at, [{ price: last.close + 0.5 * risk }, { price: last.close + 2 * risk }]).target, last.close + 2 * risk, 'cross: the first level at >= 1R was not chosen');
  assert.equal(nearestR([{ price: 110 }, { price: 130 }], 100, 96, 'BUY'), 110); assert.equal(nearestR([{ price: 101 }, { price: 130 }], 100, 96, 'BUY'), 130); assert.equal(nearestR([{ price: 101 }], 100, 96, 'BUY'), null);
  const fx = fvgFixture('bull', true), l = fx[fx.length - 1], bot = fx[fx.length - 5].high, rk = l.close - bot;
  const swing = Math.max(...fx.slice(Math.max(0, fx.length - 5 - 22), fx.length - 6).map((x) => x.high));
  const withNearSR = fvgCall(fx, [{ price: l.close + 0.5 * rk }]); assert.ok(withNearSR.target == null || withNearSR.target === swing || withNearSR.target >= l.close + rk - 1e-6, 'fvg: a sub-1R S/R level became the target');
  const lo = rangeFixture('low'), r = rangeCall(lo.candles, lo.low, lo.high, lo.touchesLow, lo.touchesHigh); assert.equal(r.target, lo.high, 'a rule target (the range opposite edge) must not be filtered by 1R');
  const ss = sessionFixture('asia', 'low'), s = sessionCall(ss.candles, { startH: 0, endH: 8 }); assert.equal(s.target, ss.range.high, 'a rule target (the session opposite side) must not be filtered by 1R');
});

test('SF8. the oracle copy of the chart S/R equals lib/srLevels.ts where that file exists in this tree', async () => {
  let real: { computeSRLevels: (b: Array<{ high: number; low: number; close: number }>, p: number) => unknown } | null = null;
  try { real = await import('../lib/srLevels.ts'); } catch { /* this tree predates the shared S/R file */ }
  if (!real) return;
  const fx = flipFixture('resistance', true).candles.slice(0, -4); const cur = fx[fx.length - 1].close;
  assert.deepEqual(srLevels(fx, cur), real.computeSRLevels(fx, cur), 'the oracle S/R copy drifted from lib/srLevels.ts');
});
