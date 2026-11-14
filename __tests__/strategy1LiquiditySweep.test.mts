import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLiquiditySweepMss, LIQUIDITY_SWEEP_MSS, FRESH_BARS } from '../lib/strategies/liquiditySweepMss.ts';

/* QA's unit cells for strategy 1 (#2307): liquidity sweep + market structure shift. The expectations are the rules in the PR text: a swing is a candle whose high (low) is strictly beyond 3 candles each side;
 * a SWEEP pokes beyond the latest swing and CLOSES back inside; the SHIFT is a later close through the latest opposite swing that stood before the sweep; the signal is the shift candle, current only
 * while it is one of the last 2 closed candles. Fixtures are built candle by candle so every number is visible. */

const T0 = 1_700_000_000_000; const TF = 900_000;
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
/** A quiet candle inside the 99-103 band. */
const q = (i: number, o = 101, c = 101.5): C => ({ time: T0 + i * TF, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 100 });
const set = (cs: C[], i: number, p: Partial<C>) => { cs[i] = { ...cs[i], ...p }; };
/** 34 closed candles: a swing LOW (95) at 12, a swing HIGH (110) at 20, then quiet. */
function base(n = 34): C[] {
  const cs = Array.from({ length: n }, (_, i) => q(i));
  set(cs, 12, { low: 95, open: 101, close: 100, high: 102 });
  set(cs, 20, { high: 110, open: 102, close: 103, low: 101 });
  return cs;
}
const ctx = { coin: 'btc', tf: '15m', tfMs: TF };

test('1-a. SELL: a swing high is swept (wick above, close back below) and a later candle closes BELOW the swing low that stood before the sweep', () => {
  const cs = base();
  set(cs, 31, { high: 112, open: 104, close: 105, low: 103 });       // sweep of 110, closes back below it
  set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });         // closes below the swing low 95: the shift
  const r = detectLiquiditySweepMss(cs, ctx);
  assert.equal(r.verdict, 'sell'); assert.equal(r.signalDir, 'short');
  assert.equal(r.signalTimestamp, cs[32].time, 'the signal is the shift candle');
  assert.equal(r.params.swept, 110); assert.equal(r.params.mss, 95); assert.equal(r.params.inv, 112, 'invalidation = the highest high from the sweep to the shift');
});

test('1-b. BUY: a swing low is swept and a later candle closes ABOVE the swing high', () => {
  const cs = base();
  set(cs, 31, { low: 93, open: 100, close: 99.5, high: 101 });       // sweep of 95, closes back above it
  set(cs, 32, { open: 102, close: 111, high: 112, low: 101 });       // closes above the swing high 110
  const r = detectLiquiditySweepMss(cs, ctx);
  assert.equal(r.verdict, 'buy'); assert.equal(r.signalDir, 'long'); assert.equal(r.signalTimestamp, cs[32].time);
  assert.equal(r.params.swept, 95); assert.equal(r.params.mss, 110); assert.equal(r.params.inv, 93, 'invalidation = the lowest low from the sweep to the shift');
});

test('1-c. CONTROLS (wait): no sweep; a sweep that CLOSES beyond the level; a sweep with no shift; too few candles', () => {
  assert.equal(detectLiquiditySweepMss(base(), ctx).verdict, 'wait', 'quiet market');
  let cs = base(); set(cs, 31, { high: 112, open: 104, close: 111, low: 103 }); set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'wait', 'the poke closed beyond 110: a breakout, not a sweep');
  cs = base(); set(cs, 31, { high: 112, open: 104, close: 105, low: 103 });
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'wait', 'a sweep with no close below the swing low');
  assert.equal(detectLiquiditySweepMss(base(29), ctx).verdict, 'wait', 'under minCandles');
  assert.equal(LIQUIDITY_SWEEP_MSS.minCandles, 30);
});

test('1-d. NO REPEAT: the signal belongs to its shift candle; two candles later it is stale and reads wait; one candle later it is still the SAME identity', () => {
  const cs = base(36);
  set(cs, 31, { high: 112, open: 104, close: 105, low: 103 }); set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });
  const last = detectLiquiditySweepMss(cs.slice(0, 33), ctx);      // the shift candle is the newest closed candle
  const second = detectLiquiditySweepMss(cs.slice(0, 34), ctx);    // one candle later: still one of the last 2
  const stale = detectLiquiditySweepMss(cs.slice(0, 35), ctx);     // two candles later
  assert.equal(last.verdict, 'sell'); assert.equal(second.verdict, 'sell');
  assert.equal(second.signalTimestamp, last.signalTimestamp, 'same identity while fresh: the page pings once');
  assert.equal(FRESH_BARS, 2); assert.equal(stale.verdict, 'wait', 'stale once the shift is older than FRESH_BARS closed candles');
});

test('1-e. liquidation clusters only annotate: a cluster near the swept level sets liq=true, never creates or cancels a signal', () => {
  const cs = base(); set(cs, 31, { high: 112, open: 104, close: 105, low: 103 }); set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });
  assert.equal(detectLiquiditySweepMss(cs, { ...ctx, liqLevels: [110.2] }).params.liq, true);
  assert.equal(detectLiquiditySweepMss(cs, { ...ctx, liqLevels: [150] }).params.liq, false);
  assert.equal(detectLiquiditySweepMss(cs, { ...ctx, liqLevels: [110.2] }).verdict, 'sell');
  assert.equal(detectLiquiditySweepMss(base(), { ...ctx, liqLevels: [110, 95] }).verdict, 'wait', 'a cluster alone never makes a signal');
});

test('1-f. a swing counts only once its later candles have closed (3 each side): a high on the last bars is not a swing yet', () => {
  const cs = base(); set(cs, 31, { high: 112, open: 104, close: 105, low: 103 }); set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });
  set(cs, 20, { high: 102 });            // remove the swing high: nothing to sweep
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'wait');
});

test('1-g. BUY needs the close ABOVE the swing HIGH (110): a close between the swing low and the swing high is not a shift', () => {
  const cs = base(); set(cs, 31, { low: 93, open: 100, close: 99.5, high: 101 }); set(cs, 32, { open: 100, close: 105, high: 106, low: 99 });
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'wait');
});
test('1-h. a swing needs 3 candles each side: a high that a taller high 3 candles earlier overshadows is NOT the swing, so a poke between them is not a sweep', () => {
  const cs = base(); set(cs, 17, { high: 111, open: 102, close: 103, low: 101 });   // taller high 3 candles before the 110
  set(cs, 31, { high: 110.5, open: 104, close: 105, low: 103 }); set(cs, 32, { open: 103, close: 94, high: 104, low: 93 });
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'wait', '110.5 does not exceed the swing high 111');
  set(cs, 31, { high: 111.5 });                                                       // now it does
  assert.equal(detectLiquiditySweepMss(cs, ctx).verdict, 'sell');
});
