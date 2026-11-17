/* PHASE-2 STRATEGY FIXTURES + ORACLES (Funding + OI squeeze, CVD absorption): the synthetic candles must hit the intended event and the oracle must answer the approved rule, or every later comparison with the app proves nothing.
 *   SQ1  crowded long (longs heavy, OI +3%+, a liquidation cluster within 1.5% below): the first close below the last 3-bar swing low = SELL, entry = close, stop = the last swing HIGH, target = the cluster beyond entry when >= 1R, else the first S/R at >= 1R, else none; inside = WAIT; already through = WAIT
 *   SQ2  crowded short mirrors (BUY on the first close above the last swing high, stop = the last swing low)
 *   SQ3  every condition is required: no heavy funding, OI under +3%, no cluster within 1.5% on the crowded side, = WAIT
 *   SQ4  fresh = one of the last 2 candles: a trigger 1 candle back still calls, 2 back does not
 *   AB1  CVD absorption: a one-sided taker window (<= -1.5 sigma vs the previous 100 windows) with price held and a close above the previous high = BUY, stop = the window low; the mirror = SELL; normal flow = WAIT; a break of the hold (price falling away) = WAIT; trigger inside the previous range = WAIT
 *   AB2  no taker data (Bybit-only coin) = WAIT "needs taker data"
 *   AB3  the fixture's window really is >= 1.5 sigma (so AB1 cannot pass by accident)
 * WHAT IT CANNOT PROVE: the app (the strategies are not built yet): these are the numbers it must reproduce. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { squeezeCall, squeezeFixture, absorptionCall, absorptionFixture, swings, atr } from '../qa/fixtures/strategyFixtures2.ts';

test('SQ1/SQ2. squeeze: the first close through the last swing against the crowd; stop = the crowded-side swing; target = cluster at >= 1R else S/R at >= 1R', () => {
  for (const crowd of ['long', 'short'] as const) {
    const fx = squeezeFixture(crowd, 'through'), last = fx.candles[fx.candles.length - 1], verdict = crowd === 'long' ? 'SELL' : 'BUY', cls = crowd === 'long' ? 'longs_heavy' as const : 'shorts_heavy' as const, sgn = crowd === 'long' ? -1 : 1;
    const sw = swings(fx.candles.slice(0, -1), 20), stop = crowd === 'long' ? sw.highs[sw.highs.length - 1].p : sw.lows[sw.lows.length - 1].p, risk = Math.abs(last.close - stop);
    const cluster = last.close + sgn * Math.max(0.012 * last.close, 1.2 * risk) * 0.0 + sgn * last.close * 0.01;   // within 1.5% on the crowded side only matters for the CROWDED side: the crowd side is opposite to the trade direction
    const nearCrowd = crowd === 'long' ? last.close - last.close * 0.01 : last.close + last.close * 0.01;     // a cluster 1% on the crowded side
    const beyond = last.close + sgn * 2 * risk, tooNear = last.close + sgn * 0.5 * risk, live = { fundingClass: cls, oiChange6Pct: 3.5, clusters: [nearCrowd, beyond, tooNear] };
    const c = squeezeCall(fx.candles, live, []); void cluster;
    assert.equal(c.verdict, verdict, `${crowd} crowd: expected ${verdict}`); assert.equal(c.entry, last.close); assert.equal(c.stop, stop, 'stop is not the crowded-side swing extreme');
    assert.equal(c.target, beyond, 'target is not the liquidation cluster beyond entry at >= 1R (the 0.5R cluster must be skipped)');
    const noCluster = squeezeCall(fx.candles, { ...live, clusters: [nearCrowd, tooNear] }, [{ price: last.close + sgn * 3 * risk }]); assert.equal(noCluster.target, last.close + sgn * 3 * risk, 'no cluster at >= 1R: the first S/R at >= 1R');
    assert.equal(squeezeCall(fx.candles, { ...live, clusters: [nearCrowd] }, []).target, null, 'no cluster, no S/R at >= 1R: no target'); assert.equal(squeezeCall(fx.candles, { ...live, clusters: [nearCrowd] }, []).rr, null);
    assert.equal(squeezeCall(squeezeFixture(crowd, 'inside').candles, live, []).verdict, 'WAIT', `${crowd}: a call with no close through the swing`);
    assert.equal(squeezeCall(squeezeFixture(crowd, 'already').candles, live, []).verdict, verdict, `${crowd}: the trigger was ONE candle back (the previous candle was the first close through): still fresh (last 2 candles), the call stands`);
  }
});

test('SQ3. every squeeze condition is required', () => {
  const fx = squeezeFixture('long', 'through'), px = fx.candles[fx.candles.length - 1].close, ok = { fundingClass: 'longs_heavy' as const, oiChange6Pct: 3.2, clusters: [px * 0.99] };
  assert.equal(squeezeCall(fx.candles, ok, []).verdict, 'SELL');
  assert.equal(squeezeCall(fx.candles, { ...ok, fundingClass: 'none' }, []).verdict, 'WAIT', 'no heavy funding'); assert.equal(squeezeCall(fx.candles, { ...ok, fundingClass: 'shorts_heavy' }, []).verdict, 'WAIT', 'a short crowd on a downside break');
  assert.equal(squeezeCall(fx.candles, { ...ok, oiChange6Pct: 2.9 }, []).verdict, 'WAIT', 'OI under +3%'); assert.equal(squeezeCall(fx.candles, { ...ok, clusters: [px * 0.97] }, []).verdict, 'WAIT', 'the cluster is 3% away, not within 1.5%');
  assert.equal(squeezeCall(fx.candles, { ...ok, clusters: [px * 1.01] }, []).verdict, 'WAIT', 'the cluster is on the wrong side (above price for a long crowd)');
});

test('SQ4. fresh = one of the last 2 candles', () => {
  const fx = squeezeFixture('long', 'through'), px = fx.candles[fx.candles.length - 1].close, live = { fundingClass: 'longs_heavy' as const, oiChange6Pct: 4, clusters: [px * 0.99] };
  const more = (n: number) => { const out = [...fx.candles]; for (let i = 1; i <= n; i++) { const p = out[out.length - 1]; out.push({ time: p.time + 3_600_000, open: p.close, high: p.close + 40, low: p.close - 60, close: p.close - 20 }); } return out; };
  assert.equal(squeezeCall(more(1), live, []).verdict, 'SELL', 'a trigger one candle back must still call'); assert.equal(squeezeCall(more(2), live, []).verdict, 'WAIT', 'a trigger two candles back must not');
});

test('AB1/AB3. absorption: one-sided taker flow held by price + the first close beyond the previous extreme', () => {
  const sd = (c: ReturnType<typeof absorptionFixture>) => { const end = c.length - 2, sum = (e: number) => c.slice(e - 7, e + 1).reduce((a, x) => a + x.takerBuy - x.takerSell, 0); const prev: number[] = []; for (let e = end - 100; e < end; e++) prev.push(sum(e)); const m = prev.reduce((a, v) => a + v, 0) / 100, s = Math.sqrt(prev.reduce((a, v) => a + (v - m) ** 2, 0) / 100); return (sum(end) - m) / s; };
  const buy = absorptionFixture('sell', 'up'), sell = absorptionFixture('buy', 'down');
  assert.ok(sd(buy) <= -1.5, `AB3: the selling window is only ${sd(buy).toFixed(2)} sigma`); assert.ok(sd(sell) >= 1.5, `AB3: the buying window is only ${sd(sell).toFixed(2)} sigma`); assert.ok(Math.abs(sd(absorptionFixture('normal', 'up'))) < 1.5, 'AB3: the control window is itself extreme');
  const zones = [{ price: 0 }];
  const b = absorptionCall(buy, true, zones), s = absorptionCall(sell, true, zones), lastB = buy[buy.length - 1], winB = buy.slice(-9, -1), lastS = sell[sell.length - 1], winS = sell.slice(-9, -1);
  assert.equal(b.verdict, 'BUY'); assert.equal(b.entry, lastB.close); assert.equal(b.stop, Math.min(...winB.map((x) => x.low)), 'stop is not the window low');
  assert.equal(s.verdict, 'SELL'); assert.equal(s.entry, lastS.close); assert.equal(s.stop, Math.max(...winS.map((x) => x.high)), 'stop is not the window high');
  assert.equal(absorptionCall(absorptionFixture('normal', 'up'), true, zones).verdict, 'WAIT', 'normal flow'); assert.equal(absorptionCall(absorptionFixture('sell', 'none'), true, zones).verdict, 'WAIT', 'no close above the previous high');
  assert.equal(absorptionCall(absorptionFixture('sell', 'up', false), true, zones).verdict, 'WAIT', 'price did not hold: it fell away during the selling');
  assert.equal(absorptionCall(absorptionFixture('sell', 'down'), true, zones).verdict, 'WAIT', 'selling window and a close BELOW the previous low is not a BUY');
  /* net-change test: lows held, but the window's net fall is more than 0.3 ATR: not "held by price" */
  const netFx = absorptionFixture('sell', 'up', 'net'), wn = netFx.slice(-9, -1), prior = netFx.slice(-29, -9), an = atr(netFx.slice(0, -1));
  assert.ok(Math.min(...wn.map((q) => q.low)) >= Math.min(...prior.map((q) => q.low)) - 0.2 * an, 'control: the net-fall fixture must pass the low-held test, or it proves nothing about the net-change test'); assert.ok(wn[wn.length - 1].close - wn[0].open < -0.3 * an, 'control: the fixture window does not fall by more than 0.3 ATR');
  assert.equal(absorptionCall(netFx, true, zones).verdict, 'WAIT', 'a window that fell more than 0.3 ATR was called held');
  const near = lastB.close + 0.5 * (lastB.close - (b.stop as number)), far = lastB.close + 2 * (lastB.close - (b.stop as number));
  assert.equal(absorptionCall(buy, true, [{ price: near }]).target, null, 'a 0.5R S/R became the target'); assert.equal(absorptionCall(buy, true, [{ price: near }, { price: far }]).target, far, 'the first S/R at >= 1R');
  assert.ok(atr(buy) > 0);
});

test('AB4. the trigger may come up to 3 candles after the window ends (the first qualifying close), and must still be fresh', () => {
  const zones = [{ price: 0 }];
  for (const gap of [1, 2]) assert.equal(absorptionCall(absorptionFixture('sell', 'up', true, gap), true, zones).verdict, 'BUY', `a trigger ${gap + 1} candle(s) after the window's last candle was refused`);
  const sellGap = absorptionCall(absorptionFixture('buy', 'down', true, 2), true, zones); assert.equal(sellGap.verdict, 'SELL');
  /* the first qualifying close ONE candle back is still fresh and is the call (entry = that candle's close, not the last one's) */
  const fy = absorptionFixture('sell', 'up', true, 1), qy = fy[fy.length - 2]; fy[fy.length - 2] = { ...qy, close: fy[fy.length - 3].high + 60, high: fy[fy.length - 3].high + 100 };
  const cy = absorptionCall(fy, true, zones); assert.equal(cy.verdict, 'BUY'); assert.equal(cy.entry, fy[fy.length - 2].close, 'the entry must be the FIRST qualifying close (one candle back), not the later one');
});

test('AB5. fresh = one of the last 2 candles: a trigger 1 candle back still calls, 2 back does not', () => {
  const zones = [{ price: 0 }], base = absorptionFixture('sell', 'up');
  const more = (n: number) => { const out = [...base]; for (let i = 1; i <= n; i++) { const p = out[out.length - 1]; out.push({ time: p.time + 3_600_000, open: p.close, high: p.close + 20, low: p.close - 40, close: p.close - 10, takerBuy: 900, takerSell: 600 }); } return out; };
  assert.equal(absorptionCall(more(1), true, zones).verdict, 'BUY', 'a trigger one candle back must still call'); assert.equal(absorptionCall(more(2), true, zones).verdict, 'WAIT', 'a trigger two candles back must not call');
});

test('AB2. a coin with no taker split is WAIT "needs taker data"', () => {
  const r = absorptionCall(absorptionFixture('sell', 'up'), false, []); assert.equal(r.verdict, 'WAIT'); assert.equal(r.reason, 'needs taker data');
});
