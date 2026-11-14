import test from 'node:test';
import assert from 'node:assert/strict';
import { signalIdentity, pingForSignalChange, readMove, MOVE_LOOKBACK } from '../lib/arenaSoundTriggers.ts';

/* QA's units for #2304 (Arena sounds). Expectations are the PR's stated rules (and the owner's words "big move in the candle"), with a negative case beside each so a function that
 * answers the same for every input cannot pass. */

/* ---------- signalIdentity / pingForSignalChange ---------- */
test('S1. a usable signal has an identity "<dir>:<timestamp>"; loading, errored or empty signals have none', () => {
  assert.equal(signalIdentity({ signalDir: 'long', signalTimestamp: 1700 }), 'long:1700');
  assert.equal(signalIdentity({ signalDir: 'short', signalTimestamp: 1700 }), 'short:1700');
  for (const bad of [null, undefined, {}, { loading: true, signalDir: 'long', signalTimestamp: 1 }, { error: 'x', signalDir: 'long', signalTimestamp: 1 }, { signalDir: 'long' }, { signalTimestamp: 1 }, { signalDir: null, signalTimestamp: 1 }]) assert.equal(signalIdentity(bad as never), null, JSON.stringify(bad));
});
test('S2. the first reading is only remembered: prev undefined never pings', () => {
  assert.equal(pingForSignalChange(undefined, 'long:1'), null); assert.equal(pingForSignalChange(undefined, null), null);
});
test('S3. a change to a long signal is a buy, to a short signal a sell; the same identity pings nothing', () => {
  assert.equal(pingForSignalChange('short:1', 'long:2'), 'buy'); assert.equal(pingForSignalChange('long:1', 'short:2'), 'sell');
  assert.equal(pingForSignalChange(null, 'long:2'), 'buy', 'from "no signal" to a signal is a ping once a baseline exists');
  assert.equal(pingForSignalChange('long:1', 'long:1'), null);
  assert.equal(pingForSignalChange('long:1', null), null, 'a signal going away is not a ping');
});
test('S4. same direction on a NEW candle is a new signal (identity includes the candle)', () => {
  assert.equal(pingForSignalChange('long:1', 'long:2'), 'buy');
});

/* ---------- readMove ---------- */
const TF = 60_000; const T0 = 1_700_000_000_000;
type B = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
/** 20 closed bars with body 10 and volume 100, then a forming bar. */
const mk = (forming: Partial<B>, opts: { closed?: number; closedBody?: number; closedVol?: number } = {}): { bars: B[]; now: number } => {
  const n = opts.closed ?? 20; const bars: B[] = [];
  for (let i = 0; i < n; i++) bars.push({ timestamp: T0 + i * TF, open: 100, close: 100 + (opts.closedBody ?? 10), high: 112, low: 98, volume: opts.closedVol ?? 100 });
  const ts = T0 + n * TF;
  bars.push({ timestamp: ts, open: 100, close: 120, high: 121, low: 99, volume: 200, ...forming });
  return { bars, now: bars[bars.length - 1].timestamp + 1_000 };
};

test('M1. EXACTLY 2x body and 2x volume is a hit; just under on either is not', () => {
  let m = mk({ close: 120, volume: 200 }); let r = readMove(m.bars, TF, m.now)!;
  assert.equal(r.hit, true); assert.equal(r.bodyRatio, 2); assert.equal(r.volumeRatio, 2);
  m = mk({ close: 119.99, volume: 200 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, false, 'body just under');
  m = mk({ close: 120, volume: 199.99 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, false, 'volume just under');
  m = mk({ close: 125, volume: 500 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, true, 'well above both');
});
test('M2. a big body on ordinary volume, and big volume on an ordinary body, are NOT hits (both are required)', () => {
  let m = mk({ close: 140, volume: 100 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, false);
  m = mk({ close: 101, volume: 900 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, false);
});
test('M3. the body ignores wicks: a huge wick with a small body is not a move', () => {
  const m = mk({ open: 100, close: 103, high: 160, low: 60, volume: 500 }); const r = readMove(m.bars, TF, m.now)!;
  assert.equal(r.hit, false); assert.ok(r.bodyRatio < 1);
});
test('M4. a falling candle counts by its absolute body', () => {
  const m = mk({ open: 120, close: 100, high: 121, low: 99, volume: 250 }); assert.equal(readMove(m.bars, TF, m.now)!.hit, true);
});
test('M5. candleStart is the forming candle (so the page can ping once per candle)', () => {
  const m = mk({}); assert.equal(readMove(m.bars, TF, m.now)!.candleStart, m.bars[m.bars.length - 1].timestamp);
});
test('M6. null when there is not enough history (<21 bars), when the last bar is not forming, and when the averages are zero', () => {
  let m = mk({}, { closed: MOVE_LOOKBACK - 1 }); assert.equal(readMove(m.bars, TF, m.now), null, '20 bars total');
  m = mk({}, { closed: MOVE_LOOKBACK }); assert.notEqual(readMove(m.bars, TF, m.now), null, 'exactly 21 bars reads');
  m = mk({}); assert.equal(readMove(m.bars, TF, m.bars[m.bars.length - 1].timestamp + TF + 1), null, 'closed last bar (stalled feed)');
  assert.equal(readMove(m.bars, TF, m.bars[m.bars.length - 1].timestamp - 1), null, 'last bar starts in the future');
  m = mk({}, { closedBody: 0 }); assert.equal(readMove(m.bars, TF, m.now), null, 'zero average body');
  m = mk({}, { closedVol: 0 }); assert.equal(readMove(m.bars, TF, m.now), null, 'zero average volume');
  assert.equal(readMove(mk({}).bars, 0, T0), null, 'no timeframe');
});
test('M7. a NaN in the closed bars or the forming bar reads as null, never a false hit', () => {
  const m = mk({}); m.bars[5] = { ...m.bars[5], close: NaN }; assert.equal(readMove(m.bars, TF, m.now), null);
  const f = mk({ close: NaN }); assert.equal(readMove(f.bars, TF, f.now), null);
});
test('M8. only the LAST 20 closed bars set the average (an old outlier outside the window does not move it)', () => {
  const m = mk({ close: 120, volume: 200 }, { closed: 25 }); m.bars[0] = { ...m.bars[0], close: 1000, volume: 99999 };
  const r = readMove(m.bars, TF, m.now)!; assert.equal(r.bodyRatio, 2); assert.equal(r.volumeRatio, 2);
});
