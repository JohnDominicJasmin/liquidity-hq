import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRangeBounce } from '../lib/strategies/rangeBounce.ts';
import { watchedItems } from '../lib/strategies/chartDrawings.ts';
import { priceText } from '../lib/numberFormat.ts';
import { rangeFixture } from '../qa/fixtures/strategyFixtures.ts';

/* #2599: range bounce draws what it WATCHES on a WAIT: the band's two edges, the SAME band the call is made against (the last 30 candles before the last one). Expectations from the candles, not from the detector:
 * high = the highest high of the 30 candles before the last, low = the lowest low. A band taller than 4 ATR (no range) draws nothing. */
const toApp = (c: ReturnType<typeof rangeFixture>['candles']) => c.map((x) => ({ ...x, volume: 0 }));
const ctx = { coin: 'btc', tf: '4h', tfMs: 14_400_000 } as never;

test('RD1. mid-range WAIT: the overlay draws the band edges computed from the candles, and the Watching line names the same two prices', () => {
  const fx = rangeFixture('mid'); const before = fx.candles.slice(0, -1).slice(-30);
  const high = Math.max(...before.map((c) => c.high)), low = Math.min(...before.map((c) => c.low));
  const r = detectRangeBounce(toApp(fx.candles) as never, ctx);
  assert.equal(r.verdict, 'wait');
  const drawn = (r.overlay?.levels ?? []).map((l) => l.price).sort((a, b) => a - b);
  assert.deepEqual(drawn, [low, high], 'the drawn band is not the last 30 candles before the last one');
  const items = watchedItems({ ...r, lastClose: fx.candles[fx.candles.length - 1].close } as never).map((i) => i.price).sort();
  assert.deepEqual(items, [priceText(low), priceText(high)].sort(), 'the Watching line does not name the drawn edges');
});
test('RD2. the call and the drawing use the SAME band: at the low edge the BUY carries low/high equal to the WAIT drawing one candle earlier', () => {
  const fx = rangeFixture('low'); const buy = detectRangeBounce(toApp(fx.candles) as never, ctx);
  assert.equal(buy.verdict, 'buy');
  const before = fx.candles.slice(0, -1).slice(-30), high = Math.max(...before.map((c) => c.high)), low = Math.min(...before.map((c) => c.low));
  assert.equal((buy.params as Record<string, number>).high, high); assert.equal((buy.params as Record<string, number>).low, low);
});
test('RD3. no range (a band much taller than 4 ATR): nothing is drawn and the Watching line is empty', () => {
  const fx = rangeFixture('mid', undefined, undefined, undefined, undefined, 0.001);
  const r = detectRangeBounce(toApp(fx.candles) as never, ctx);
  assert.equal(r.verdict, 'wait'); assert.deepEqual(r.overlay?.levels ?? [], []); assert.deepEqual(watchedItems({ ...r, lastClose: fx.candles[fx.candles.length - 1].close } as never), []);
});
test('RD4. the band is exactly the last 30 candles before the last one: a spike on the OLDEST candle of the window is in it, one just outside is not', () => {
  const fx = rangeFixture('mid'); const L = fx.candles.length; const w = fx.high - fx.low;
  const inside = fx.candles.map((c, i) => (i === L - 1 - 30 ? { ...c, high: fx.high + 0.02 * w } : c));      // index L-31 = the 30th candle before the last
  const outside = fx.candles.map((c, i) => (i === L - 1 - 31 ? { ...c, high: fx.high + 0.02 * w } : c));    // index L-32 = the 31st: outside the window
  const hi = (cs: typeof inside) => Math.max(...(detectRangeBounce(toApp(cs) as never, ctx).overlay?.levels ?? []).map((l) => l.price));
  assert.equal(hi(inside), fx.high + 0.02 * w, 'the oldest candle of the 30 is missing from the band');
  assert.equal(hi(outside), fx.high, 'a candle outside the 30 changed the band');
});
