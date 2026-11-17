/* #2511 CHANNEL STRATEGY, the real detectChannel run on the QA channel fixtures (qa/fixtures/channelCandles.ts), with the oracle's arithmetic written outside the app.
 *   CS1  no close outside a falling or rising channel = WAIT (and the WAIT overlay carries the watched rails only, no entry/stop/target)
 *   CS2  falling channel + first close above the upper rail = BUY; rising + first close below the lower rail = SELL
 *   CS3  a break WITH the channel direction (falling then down, rising then up) = WAIT
 *   CS4  levels: entry = the breakout close; the stop is on the losing side of entry and equals the last swing inside the channel (the oracle's lastSwingInside); R:R in params is |target - entry| / |entry - stop| rounded to 1 decimal; with no target there is no rr and no target level
 *   CS5  freshness: the call is current for the breakout candle and the one after, and is WAIT three candles later
 *   CS6  NO ARROW / PATH: the overlay carries only levels, zones, lines and marker; no field or label names a path, arrow or forecast
 *   CS7  fewer than 60 candles = WAIT
 *   CS8  the strategy list has 8 strategies and 'channel' is one of them
 * WHAT IT CANNOT PROVE: the chart drawing (browser cells). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelCandles, rr } from '../qa/fixtures/channelCandles.ts';
import { detectChannel, FRESH_BARS, MIN_CANDLES } from '../lib/strategies/channel.ts';
import type { OHLCV } from '../lib/strategyCore.ts';

const ctx = { coin: 'BTC', tf: '4h', tfMs: 4 * 3_600_000 };
const ohlcv = (cs: ReturnType<typeof channelCandles>['candles']): OHLCV[] => cs.map((c) => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));

test('CS1. no close outside the channel = WAIT, and the WAIT overlay draws the watched rails only', () => {
  for (const dir of ['falling', 'rising'] as const) {
    const r = detectChannel(ohlcv(channelCandles({ dir, breakout: 'none' }).candles), ctx);
    assert.equal(r.verdict, 'wait', `${dir} channel with no close outside was not WAIT`);
    if (r.overlay) { assert.deepEqual(r.overlay.levels, [], 'a WAIT carries entry/stop/target levels'); assert.deepEqual(r.overlay.zones, []); assert.equal(r.overlay.marker, null); }
  }
});

test('CS2/CS4. BUY on a falling channel broken up, SELL on a rising one broken down; levels match the oracle', () => {
  for (const [dir, bo, verdict] of [['falling', 'up', 'buy'], ['rising', 'down', 'sell']] as const) {
    const fx = channelCandles({ dir, breakout: bo }), r = detectChannel(ohlcv(fx.candles), ctx);
    assert.equal(r.verdict, verdict, `${dir}/${bo}: expected ${verdict}, got ${r.verdict}`);
    const p = r.params as Record<string, number>, entry = fx.breakoutClose as number, swing = (fx.lastSwingInside as { price: number }).price;
    assert.equal(p.entry, entry, 'entry is not the breakout close');
    if (verdict === 'buy') assert.ok(p.stop < entry, 'a BUY stop must sit below entry'); else assert.ok(p.stop > entry, 'a SELL stop must sit above entry');
    assert.ok(Math.abs(p.stop - swing) / swing < 0.002, `stop ${p.stop} is not the last swing inside the channel (${swing})`);
    assert.equal(p.inv, p.stop, 'the invalidation is not the stop');
    if (p.target !== undefined) { assert.equal(p.rr, Math.round(rr(entry, p.stop, p.target) * 10) / 10, 'rr is not |target-entry|/|entry-stop| rounded to 1 decimal'); if (verdict === 'buy') assert.ok(p.target > entry); else assert.ok(p.target < entry); }
    else assert.equal(p.rr, undefined, 'an rr is shown with no target');
  }
});

test('CS3. a break WITH the channel direction is not a call', () => {
  assert.equal(detectChannel(ohlcv(channelCandles({ dir: 'falling', breakout: 'down' }).candles), ctx).verdict, 'wait', 'falling channel broken DOWN gave a call');
  assert.equal(detectChannel(ohlcv(channelCandles({ dir: 'rising', breakout: 'up' }).candles), ctx).verdict, 'wait', 'rising channel broken UP gave a call');
});

test('CS5. the call is current for the breakout candle and the next one, and gone three candles later', () => {
  assert.equal(FRESH_BARS, 2, 'the freshness window changed: re-derive this pin');
  const fx = channelCandles({ dir: 'falling', breakout: 'up' }); const base = ohlcv(fx.candles); const last = base[base.length - 1];
  const more = (n: number): OHLCV[] => { const out = [...base]; for (let i = 1; i <= n; i++) { const prev = out[out.length - 1]; out.push({ time: last.time + i * 4 * 3_600_000, open: prev.close, high: prev.close * 1.004, low: prev.close * 0.998, close: prev.close * 1.002, volume: 1000 }); } return out; };
  assert.equal(detectChannel(more(0), ctx).verdict, 'buy'); assert.equal(detectChannel(more(1), ctx).verdict, 'buy', 'the next candle must still show the call');
  assert.equal(detectChannel(more(3), ctx).verdict, 'wait', 'a call three candles old is still shown');
});

test('CS6. no arrow or predicted path anywhere in the result', () => {
  const r = detectChannel(ohlcv(channelCandles({ dir: 'falling', breakout: 'up' }).candles), ctx);
  assert.ok(r.overlay, 'a live call has an overlay');
  assert.deepEqual(Object.keys(r.overlay as object).sort(), ['levels', 'lines', 'marker', 'zones'], 'the overlay has a field beyond levels / zones / lines / marker');
  const dump = JSON.stringify(r);
  assert.equal(/arrow|path|forecast|predict|projection|projected/i.test(dump), false, `the result names a path or arrow: ${(dump.match(/arrow|path|forecast|predict|projection|projected/i) ?? [''])[0]}`);
  for (const l of (r.overlay as { lines: Array<{ points: unknown[] }> }).lines) assert.equal(l.points.length, 2, 'a line has more than its two endpoints (a drawn path?)');
});

test('CS7. fewer than the minimum candles = WAIT', () => {
  const cs = ohlcv(channelCandles({ dir: 'falling', breakout: 'up' }).candles).slice(-(MIN_CANDLES - 1));
  assert.equal(detectChannel(cs, ctx).verdict, 'wait');
});

test('CS8. eight strategies, and channel is one of them', async () => {
  const mod = await import('../lib/strategies/index.ts') as Record<string, unknown>;
  const list = (mod.STRATEGIES ?? mod.STRATEGY_LIST ?? mod.ALL_STRATEGIES) as Array<{ id: string }> | undefined;
  assert.ok(Array.isArray(list), `lib/strategies/index.ts exports no strategy list (exports: ${Object.keys(mod).join(', ')})`);
  assert.equal(list.length, 8, `the strategy list has ${list.length} entries, not 8`); assert.ok(list.some((s) => s.id === 'channel'));
});
