import test from 'node:test';
import assert from 'node:assert/strict';
import { crossFixture, crossCall, flipFixture, flipCall, flipLevelFromChart, srLevels, rangeFixture, rangeCall, fvgFixture, fvgCall, sessionFixture, sessionCall, rrOf, type C, type Call } from '../qa/fixtures/strategyFixtures.ts';
import { detectEmaCross } from '../lib/strategies/emaCross.ts';
import { detectSrFlip } from '../lib/strategies/srFlip.ts';
import { detectRangeBounce } from '../lib/strategies/rangeBounce.ts';
import { detectFairValueGap } from '../lib/strategies/fairValueGap.ts';
import { detectSessionSweep } from '../lib/strategies/sessionSweep.ts';
import type { StrategyResult } from '../lib/strategies/types.ts';

/* #1263 boxes 17-21 (Golden/Death cross, S/R flip, Range bounce, Fair value gap, Asia/London session sweep): the APP'S detector compared with QA's ORACLE (qa/fixtures/strategyFixtures.ts) on the oracle's own synthetic candles.
 * WHAT THIS PINS: for each strategy, on the fixture the oracle calls BUY/SELL, the app's verdict, entry, stop, target and R:R equal the oracle's numbers (which did not come from the app); on each control fixture (one candle early, no touch,
 * mid-range, no return, ordinary candle) both say WAIT. The S/R levels the oracle uses for "nearest S/R" targets are the chart's own (oracle copy of lib/srLevels.ts, pinned equal to it by strategyFixtures.test.mts SF8).
 * WHAT IT CANNOT PROVE: the Pro/Free gating, the chart overlay, or any browser behaviour; phase-2 strategies (they need live funding / OI / taker inputs). */

const ctx = (tf: string, tfMs: number) => ({ coin: 'btc', tf, tfMs }) as never;
const toApp = (c: C[]) => c.map((x) => ({ ...x, volume: 0 }));
type Num = number | null | undefined;
const appCall = (r: StrategyResult): Call => {
  if (r.verdict === 'wait') return { verdict: 'WAIT' };
  const p = r.params as Record<string, number>;
  return { verdict: r.verdict === 'buy' ? 'BUY' : 'SELL', entry: p.entry, stop: p.stop, target: p.target ?? null, rr: p.rr ?? null };
};
const same = (label: string, app: Call, oracle: Call) => {
  assert.equal(app.verdict, oracle.verdict, `${label}: verdict app=${app.verdict} oracle=${oracle.verdict}`);
  if (oracle.verdict === 'WAIT') return;
  const eq = (a: Num, b: Num, what: string) => { if (a == null || b == null) assert.equal(a ?? null, b ?? null, `${label}: ${what} app=${a} oracle=${b}`); else assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${label}: ${what} app=${a} oracle=${b}`); };
  eq(app.entry, oracle.entry, 'entry'); eq(app.stop, oracle.stop, 'stop'); eq(app.target, oracle.target, 'target');
  const orr = oracle.target == null ? null : Math.round((rrOf(oracle.entry as number, oracle.stop as number, oracle.target) as number) * 10) / 10;
  eq(app.rr, orr, 'R:R (1 dp)');
};
const zonesOf = (c: C[], price: number) => srLevels(c, price).map((l) => ({ price: l.price }));

test('AO1. golden / death cross: the app equals the oracle at the cross and says WAIT one candle earlier', () => {
  for (const dir of ['golden', 'death'] as const) {
    const at = crossFixture(dir, 'atCross'), before = crossFixture(dir, 'beforeCross');
    const z = zonesOf(at, at[at.length - 1].close);
    same(`${dir} at cross`, appCall(detectEmaCross(toApp(at), ctx('4h', 14_400_000))), crossCall(at, z));
    same(`${dir} one candle before`, appCall(detectEmaCross(toApp(before), ctx('4h', 14_400_000))), crossCall(before, zonesOf(before, before[before.length - 1].close)));
    assert.equal(appCall(detectEmaCross(toApp(at), ctx('4h', 14_400_000))).verdict, dir === 'golden' ? 'BUY' : 'SELL');
    assert.equal(appCall(detectEmaCross(toApp(before), ctx('4h', 14_400_000))).verdict, 'WAIT');
  }
});

test('AO2. S/R flip: the retest that touches and closes back beyond is the call (levels = the chart\'s own); no touch is WAIT', () => {
  for (const side of ['resistance', 'support'] as const) {
    const fx = flipFixture(side, true), ctl = flipFixture(side, false), n = fx.candles.length;
    const fromChart = flipLevelFromChart(fx.candles, n - 5, side) as number;   // the level the chart drew just before the break (the break is the 5th candle from the end)
    const lv = zonesOf(fx.candles.slice(0, n - 1), fx.candles[n - 2].close);
    const others = lv.filter((z) => z.price !== fromChart);
    const app = appCall(detectSrFlip(toApp(fx.candles), ctx('4h', 14_400_000)));
    same(`${side} retest`, app, flipCall(fx.candles, fromChart, side, others));
    assert.equal(app.verdict, side === 'resistance' ? 'BUY' : 'SELL');
    assert.equal(appCall(detectSrFlip(toApp(ctl.candles), ctx('4h', 14_400_000))).verdict, 'WAIT', `${side}: a call with no touching retest`);
    /* #2603 control 1: the retest only 3 candles after the break (2 between) is too early: WAIT in the oracle and the app */
    const early = [...fx.candles.slice(0, n - 2), fx.candles[n - 1]];
    assert.equal(flipCall(early, fromChart, side, others).verdict, 'WAIT', `${side}: oracle on an early retest`); assert.equal(appCall(detectSrFlip(toApp(early), ctx('4h', 14_400_000))).verdict, 'WAIT', `${side}: an early retest (2 candles between)`);
    /* control 2: ONE flip per level and direction: a second touching candle after the first retest is not a call */
    const second = [...fx.candles, { ...fx.candles[n - 1], time: fx.candles[n - 1].time + 14_400_000 }];
    assert.equal(flipCall(second, fromChart, side, others).verdict, 'WAIT', `${side}: oracle on a second touch`); assert.equal(appCall(detectSrFlip(toApp(second), ctx('4h', 14_400_000))).verdict, 'WAIT', `${side}: a second touch after the flip`);
    /* control 3: a break must close at least 0.1 ATR beyond: a close a hair beyond is no break (the next candles then break it, and the retest is too early) */
    const hair = fx.candles.map((x, i) => (i === n - 5 ? { ...x, close: fromChart + (side === 'resistance' ? 2 : -2) } : x));
    assert.equal(flipCall(hair, fromChart, side, others).verdict, 'WAIT', `${side}: oracle with a hair-beyond break`); assert.equal(appCall(detectSrFlip(toApp(hair), ctx('4h', 14_400_000))).verdict, 'WAIT', `${side}: a break that closes a hair beyond the level`);
  }
});

test('AO3. range bounce: BUY at the low edge, SELL at the high edge, WAIT mid-range', () => {
  for (const end of ['low', 'high', 'mid'] as const) {
    const fx = rangeFixture(end);
    const app = appCall(detectRangeBounce(toApp(fx.candles), ctx('4h', 14_400_000)));
    same(`range ${end}`, app, rangeCall(fx.candles));
    assert.equal(app.verdict, end === 'low' ? 'BUY' : end === 'high' ? 'SELL' : 'WAIT');
  }
  /* #2603 control: a band taller than 4 ATR is no range (smooth candles with tiny wicks): WAIT in the oracle and the app, even at the edge */
  const tall = rangeFixture('low', undefined, undefined, undefined, undefined, 0.001);
  assert.equal(rangeCall(tall.candles).verdict, 'WAIT', 'oracle: a band over 4 ATR'); assert.equal(appCall(detectRangeBounce(toApp(tall.candles), ctx('4h', 14_400_000))).verdict, 'WAIT', 'a band taller than 4 ATR is no range');
  /* control: fewer than 60 candles */
  const short = rangeFixture('low', undefined, undefined, 50);
  assert.equal(rangeCall(short.candles).verdict, 'WAIT'); assert.equal(appCall(detectRangeBounce(toApp(short.candles), ctx('4h', 14_400_000))).verdict, 'WAIT', 'under 60 candles');
});

test('AO4. fair value gap: the first return into an unfilled gap is the call; no return is WAIT', () => {
  for (const dir of ['bull', 'bear'] as const) {
    const fx = fvgFixture(dir, true), ctl = fvgFixture(dir, false);
    const z = zonesOf(fx, fx[fx.length - 1].close);
    const app = appCall(detectFairValueGap(toApp(fx), ctx('4h', 14_400_000)));
    same(`fvg ${dir}`, app, fvgCall(fx, z));
    assert.equal(app.verdict, dir === 'bull' ? 'BUY' : 'SELL');
    assert.equal(appCall(detectFairValueGap(toApp(ctl), ctx('4h', 14_400_000))).verdict, 'WAIT', `${dir}: a call with no return`);
    /* #2603 size filters: a gap under 0.5 ATR tall (60 against an ATR of about 500), and a return that closes only a hair into the gap (risk 40 under 0.5 ATR) are both WAIT, in the oracle and the app */
    const tiny = fvgFixture(dir, true, undefined, 60), shallow = fvgFixture(dir, true, undefined, 900, 0.1), big = fvgFixture(dir, true, undefined, 900, 0.9);
    for (const [name, fxc] of [['a gap under 0.5 ATR', tiny], ['a risk under 0.5 ATR', shallow]] as const) { assert.equal(fvgCall(fxc, zonesOf(fxc, fxc[fxc.length - 1].close)).verdict, 'WAIT', `${dir}: oracle on ${name}`); assert.equal(appCall(detectFairValueGap(toApp(fxc), ctx('4h', 14_400_000))).verdict, 'WAIT', `${dir}: ${name}`); }
    /* the gap filter ALONE: a 60-tall gap whose return closes well beyond the gap (risk about 760, far over 0.5 ATR): only the gap size says WAIT */
    { const t = fvgFixture(dir, true, undefined, 60), L = t.length, bull = dir === 'bull', top = bull ? t[L - 3].low : t[L - 5].low, bot = bull ? t[L - 5].high : t[L - 3].high, prev = t[L - 2];
      const big2 = [...t.slice(0, L - 1), bull ? { ...prev, time: prev.time + 14_400_000, open: prev.close, low: top, high: top + 800, close: top + 700 } : { ...prev, time: prev.time + 14_400_000, open: prev.close, high: bot, low: bot - 800, close: bot - 700 }];
      assert.equal(fvgCall(big2, zonesOf(big2, big2[big2.length - 1].close)).verdict, 'WAIT', `${dir}: oracle on a tiny gap with a big risk`); assert.equal(appCall(detectFairValueGap(toApp(big2), ctx('4h', 14_400_000))).verdict, 'WAIT', `${dir}: a gap under 0.5 ATR is no gap even when the risk is large`); }
    same(`fvg ${dir} deeper return`, appCall(detectFairValueGap(toApp(big), ctx('4h', 14_400_000))), fvgCall(big, zonesOf(big, big[big.length - 1].close)));
    /* control: the gap is closed through (the candle before the return closes through the gap's far edge) = WAIT in the oracle and the app */
    const gap = dir === 'bull' ? fx[fx.length - 5].high : fx[fx.length - 5].low, prev = fx[fx.length - 2];
    const filled = [...fx.slice(0, -1), { ...prev, time: prev.time + 1, close: dir === 'bull' ? gap - 50 : gap + 50, low: dir === 'bull' ? gap - 80 : prev.low, high: dir === 'bull' ? prev.high : gap + 80 }, fx[fx.length - 1]];
    assert.equal(fvgCall(filled, z).verdict, 'WAIT'); assert.equal(appCall(detectFairValueGap(toApp(filled), ctx('4h', 14_400_000))).verdict, 'WAIT', `${dir}: a call on a gap already closed through`);
  }
});

test('AO5. Asia / London session sweep: a wick through the session extreme that closes back inside is the call; an ordinary candle and a candle before the session ends are WAIT', () => {
  for (const session of ['asia', 'london'] as const) {
    const w = session === 'asia' ? { startH: 0, endH: 8 } : { startH: 7, endH: 12 };
    for (const sweep of ['low', 'high', 'none'] as const) {
      const fx = sessionFixture(session, sweep);
      const app = appCall(detectSessionSweep(toApp(fx.candles), ctx('1h', 3_600_000)));
      same(`${session} ${sweep}`, app, sessionCall(fx.candles, w));
      assert.equal(app.verdict, sweep === 'low' ? 'BUY' : sweep === 'high' ? 'SELL' : 'WAIT');
    }
    const lo = sessionFixture(session, 'low');
    assert.equal(appCall(detectSessionSweep(toApp(lo.candles.slice(0, -1)), ctx('1h', 3_600_000))).verdict, 'WAIT', `${session}: a call before the session ended`);
    assert.equal(appCall(detectSessionSweep(toApp(lo.candles), ctx('4h', 14_400_000))).verdict, 'WAIT', `${session}: a call on a 4h chart (needs 5m-1h)`);
  }
});
