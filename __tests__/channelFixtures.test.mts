/* CHANNEL FIXTURES (#1263 Channel strategy): the synthetic candles must be a channel the app's own detector accepts, or every later pin built on them proves nothing.
 *   CF1  falling and rising fixtures, with and without a breakout: lib/chartStructureDetect finds a channel (two rails) of the right slope on the inside candles, and no fixture close sits outside its rails before the breakout
 *   CF2  the breakout candle is the only close outside, and lands on the intended side
 *   CF3  the oracle: BUY only for a falling channel broken upward, SELL only for a rising channel broken downward, WAIT otherwise (including a break WITH the channel direction and a second close outside)
 *   CF4  levels and R:R: entry = the breakout close, stop = the last swing inside, target = the nearest zone in direction; no zone = no target and no R:R; R:R arithmetic exact (2.82 example)
 * WHAT IT CANNOT PROVE: the app's output. When the feature lands the browser cells compare the app's numbers to this oracle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelCandles, channelCall, rr } from '../qa/fixtures/channelCandles.ts';
import { detectStructures } from '../lib/chartStructureDetect.ts';

for (const dir of ['falling', 'rising'] as const) for (const bo of ['none', 'up', 'down'] as const) {
  test(`CF1. ${dir} channel, breakout ${bo}: the app's detector finds a ${dir} channel on the candles inside it`, () => {
    const fx = channelCandles({ dir, breakout: bo });
    const inside = fx.candles.slice(0, bo === 'none' ? undefined : -1);
    inside.forEach((k, i) => { assert.ok(k.close <= fx.rails.upper(i) * 1.00001 && k.close >= fx.rails.lower(i) * 0.99999, `close ${i} sits outside its rails`); assert.ok(k.high >= k.low && k.high >= k.close && k.low <= k.close, `candle ${i} is malformed`); });
    const r = detectStructures(inside, { timeframe: '4h' });
    const ch = r.structures.find((s) => s.kind === 'channel');
    assert.ok(ch, `no channel detected (reason ${r.reason}; kinds ${r.structures.map((s) => s.kind)})`);
    const slope = (rl: { from: { price: number }; to: { price: number } }) => rl.to.price - rl.from.price;
    for (const rl of ch.rails) assert.ok(dir === 'falling' ? slope(rl) < 0 : slope(rl) > 0, `a rail slopes the wrong way for a ${dir} channel`);
  });
}

test('CF2. the breakout candle is the only close outside its rails, on the intended side', () => {
  for (const [dir, bo] of [['falling', 'up'], ['rising', 'down'], ['falling', 'down'], ['rising', 'up']] as const) {
    const fx = channelCandles({ dir, breakout: bo }), last = fx.candles.length - 1;
    const outside = fx.candles.map((k, i) => (k.close > fx.rails.upper(i) ? 'above' : k.close < fx.rails.lower(i) ? 'below' : 'in'));
    assert.deepEqual(outside.slice(0, last).filter((x) => x !== 'in'), [], `${dir}/${bo}: a close before the breakout is outside`);
    assert.equal(outside[last], bo === 'up' ? 'above' : 'below'); assert.equal(fx.breakoutClose, fx.candles[last].close);
  }
});

test('CF3. the oracle: BUY / SELL only in the rule direction, WAIT otherwise', () => {
  const zones = [{ low: 110_000, high: 111_000 }, { low: 80_000, high: 81_000 }];
  assert.equal(channelCall(channelCandles({ dir: 'falling', breakout: 'up' }), 'falling', zones).verdict, 'BUY');
  assert.equal(channelCall(channelCandles({ dir: 'rising', breakout: 'down' }), 'rising', zones).verdict, 'SELL');
  assert.equal(channelCall(channelCandles({ dir: 'falling', breakout: 'none' }), 'falling', zones).verdict, 'WAIT', 'no close outside = WAIT');
  assert.equal(channelCall(channelCandles({ dir: 'falling', breakout: 'down' }), 'falling', zones).verdict, 'WAIT', 'a break WITH the falling channel is not a BUY');
  assert.equal(channelCall(channelCandles({ dir: 'rising', breakout: 'up' }), 'rising', zones).verdict, 'WAIT', 'a break WITH the rising channel is not a SELL');
  const fx = channelCandles({ dir: 'falling', breakout: 'up' }); const lastC = fx.candles[fx.candles.length - 1];
  fx.candles.splice(fx.candles.length - 1, 0, { ...lastC, timestamp: lastC.timestamp - 1 });
  assert.equal(channelCall(fx, 'falling', zones).verdict, 'WAIT', 'only the FIRST close outside is the call');
});

test('CF4. levels and R:R: entry = breakout close, stop = last swing inside, target = nearest zone in direction; no zone = none', () => {
  const up = channelCandles({ dir: 'falling', breakout: 'up' }), last = up.candles.length - 1, bc = up.breakoutClose as number;
  const zones = [{ low: bc * 1.05, high: bc * 1.06 }, { low: bc * 1.12, high: bc * 1.13 }, { low: bc * 0.9, high: bc * 0.91 }];
  const c = channelCall(up, 'falling', zones);
  assert.equal(c.entry, up.candles[last].close); assert.equal(c.stop, up.lastSwingInside!.price); assert.ok((c.stop as number) < (c.entry as number), 'a BUY stop sits below entry');
  assert.equal(c.target, zones[0].low, 'the NEAREST zone above, not the far one and not the one below');
  assert.ok(Math.abs((c.rr as number) - ((c.target as number) - (c.entry as number)) / ((c.entry as number) - (c.stop as number))) < 1e-12);
  /* PM 2026-11-17: a level closer than 1x the risk is skipped; the first level at >= 1R is the target; none = no target, no R:R. */
  const risk = bc - (c.stop as number), near = { low: bc + 0.4 * risk, high: bc + 0.5 * risk }, far = { low: bc + 1.5 * risk, high: bc + 1.6 * risk }, edge = { low: bc + 1.0 * risk, high: bc + 1.1 * risk };
  assert.equal(channelCall(up, 'falling', [near, far]).target, far.low, 'a level at 0.4R was taken as the target: it must be skipped for the first level at >= 1R');
  assert.equal(channelCall(up, 'falling', [near]).target, null, 'only a sub-1R level exists: no target'); assert.equal(channelCall(up, 'falling', [near]).rr, null);
  assert.equal(channelCall(up, 'falling', [edge]).target, edge.low, 'a level at exactly 1R is allowed'); assert.ok(Math.abs((channelCall(up, 'falling', [edge]).rr as number) - 1) < 1e-9);
  const none = channelCall(up, 'falling', [{ low: bc * 0.9, high: bc * 0.91 }]);
  assert.equal(none.target, null); assert.equal(none.rr, null);
  const dn = channelCandles({ dir: 'rising', breakout: 'down' }), dc = dn.breakoutClose as number, d = channelCall(dn, 'rising', [{ low: dc * 0.88, high: dc * 0.9 }]);
  assert.ok((d.stop as number) > (d.entry as number), 'a SELL stop sits above entry'); assert.equal(d.target, dc * 0.9, 'a SELL target is the zone TOP, nearest below');
  assert.equal(Math.round(rr(100, 96, 111.28) * 100) / 100, 2.82, 'the owner example: risk 4, reward 11.28 = R:R 2.82');
  assert.ok(Number.isNaN(rr(100, 100, 110)), 'zero risk must not give Infinity');
});
