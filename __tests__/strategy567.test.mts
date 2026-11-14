import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBollingerSqueeze, BOLLINGER_SQUEEZE, MIN_CANDLES as BB_MIN, FRESH_BARS as BB_FRESH, SQUEEZE_BARS } from '../lib/strategies/bollingerSqueeze.ts';
import { detectVwapReclaim, VWAP_RECLAIM, BELOW_BARS, FRESH_BARS as VW_FRESH, MIN_SESSION_BARS } from '../lib/strategies/vwapReclaim.ts';
import { detectRsiDivergenceTrigger, RSI_DIVERGENCE, MIN_CANDLES as DV_MIN, FRESH_BARS as DV_FRESH, MAX_AGE } from '../lib/strategies/rsiDivergence.ts';

/* QA's unit cells for strategies 5, 6 and 7 (#2314 Bollinger squeeze, #2315 VWAP reclaim, #2316 RSI divergence). The expectations are the rules in each PR's text; fixtures are built candle by candle. */
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const ctxFor = (tfMs: number, tf = '1h') => ({ coin: 'btc', tf, tfMs });

/* ---------------- 5: Bollinger squeeze breakout ---------------- */
const H1 = 3_600_000; const B0 = 1_700_000_000_000;
const bar = (i: number, close: number, spread = 0.2, vol = 100, t0 = B0, tf = H1): C => ({ time: t0 + i * tf, open: close, close, high: close + spread, low: close - spread, volume: vol });
/** 110 noisy candles (wide bands), `tight` near-constant candles (squeeze), then the closes in `after`. */
function bb(tight: number, after: number[]): C[] {
  const cs: C[] = []; for (let i = 0; i < 110; i++) cs.push(bar(i, 100 + (i % 2 === 0 ? 3 : -3) * (1 + (i % 7) / 7)));
  for (let i = 0; i < tight; i++) cs.push(bar(110 + i, 100 + (i % 2) * 0.02));
  after.forEach((c, k) => cs.push(bar(110 + tight + k, c)));
  return cs;
}
const TIGHT = 34;      // squeeze candles from index 130 on (the 20-candle window has left the noise)

test('5-a. BUY: after a squeeze (bandwidth in the bottom 20% of its last 100), a close ABOVE the upper band that the previous candle did not make', () => {
  assert.equal(BB_MIN, 130);
  const cs = bb(TIGHT, [101]); const r = detectBollingerSqueeze(cs, ctxFor(H1));
  assert.equal(r.verdict, 'buy'); assert.equal(r.signalDir, 'long'); assert.equal(r.signalTimestamp, cs[cs.length - 1].time);
  assert.ok((r.params.countSqueeze as number) >= SQUEEZE_BARS, `squeezed bars before it: ${r.params.countSqueeze}`); assert.equal(typeof r.params.inv, 'number', 'invalidation = the middle band');
});
test('5-b. SELL: the mirror: a close BELOW the lower band after a squeeze', () => {
  const r = detectBollingerSqueeze(bb(TIGHT, [99]), ctxFor(H1)); assert.equal(r.verdict, 'sell'); assert.equal(r.signalDir, 'short');
});
test('5-c. CONTROLS (wait): no squeeze (the market stays noisy), a squeeze that is too short, a close inside the bands, under the minimum candles', () => {
  const noisy: C[] = []; for (let i = 0; i < 150; i++) noisy.push(bar(i, 100 + (i % 2 === 0 ? 3 : -3) * (1 + (i % 7) / 7)));
  noisy.push(bar(150, 112)); assert.equal(detectBollingerSqueeze(noisy, ctxFor(H1)).verdict, 'wait', 'a breakout with no squeeze before it');
  assert.equal(detectBollingerSqueeze(bb(12, [101]), ctxFor(H1)).verdict, 'wait', 'the bands have not tightened yet: the breakout candle has no squeeze behind it');
  assert.equal(detectBollingerSqueeze(bb(TIGHT, [100.01]), ctxFor(H1)).verdict, 'wait', 'a close inside the bands');
  assert.equal(detectBollingerSqueeze(bb(TIGHT, [101]).slice(-100), ctxFor(H1)).verdict, 'wait', 'under 130 candles');
  assert.equal(BOLLINGER_SQUEEZE.minCandles, 130);
});
test('5-d. NO REPEAT: the break candle is the signal for FRESH_BARS candles (one identity), a continuation candle is not a new breakout, then stale', () => {
  assert.equal(BB_FRESH, 2);
  const at0 = detectBollingerSqueeze(bb(TIGHT, [101]), ctxFor(H1)); const at1 = detectBollingerSqueeze(bb(TIGHT, [101, 102]), ctxFor(H1)); const at2 = detectBollingerSqueeze(bb(TIGHT, [101, 102, 103]), ctxFor(H1));
  assert.equal(at0.verdict, 'buy'); assert.equal(at1.verdict, 'buy'); assert.equal(at1.signalTimestamp, at0.signalTimestamp, 'the continuation does not re-ping');
  assert.equal(at2.verdict, 'wait', 'two candles on the break is stale');
});

/* ---------------- 6: VWAP reclaim ---------------- */
const D0 = Date.UTC(2026, 10, 10);   // 10 Nov 2026 00:00 UTC
const vb = (i: number, close: number, tfMs = H1, t0 = D0, vol = 100): C => ({ time: t0 + i * tfMs, open: close, close, high: close + 0.2, low: close - 0.2, volume: vol });
/** The session's candles from 00:00 UTC, preceded by four candles of the PREVIOUS day (the detector wants 10 candles in all; yesterday's never count toward today's VWAP). */
const sess = (closes: number[], tfMs = H1, t0 = D0, prefix = 4): C[] => [...Array.from({ length: prefix }, (_, j) => prefix - j).map(k => vb(-k, 500, tfMs, t0)), ...closes.map((c, i) => vb(i, c, tfMs, t0))];
const DOWN_THEN_UP = [100, 100, 98, 97, 96, 95, 105];           // 4 closes under the running VWAP, then a close above it
const UP_THEN_DOWN = [100, 100, 102, 103, 104, 105, 95];

test('6-a. BUY (reclaim): a close above the session VWAP after at least 3 consecutive closes below it; SELL (loss): the mirror', () => {
  assert.equal(BELOW_BARS, 3); assert.equal(MIN_SESSION_BARS, 6);
  const b = detectVwapReclaim(sess(DOWN_THEN_UP), ctxFor(H1)); assert.equal(b.verdict, 'buy'); assert.equal(b.signalDir, 'long'); assert.ok((b.params.countBars as number) >= 3);
  assert.equal(b.signalTimestamp, D0 + 6 * H1, 'the signal is the reclaiming candle');
  const s = detectVwapReclaim(sess(UP_THEN_DOWN), ctxFor(H1)); assert.equal(s.verdict, 'sell'); assert.equal(s.signalDir, 'short');
});
test('6-b. CONTROLS (wait): only 2 closes below first; the close stays below; a session under 6 candles; the day resets at 00:00 UTC; 4h and coarser; equal to VWAP is no side', () => {
  assert.equal(detectVwapReclaim(sess([100, 100, 100, 98, 97, 105, 105]), ctxFor(H1)).verdict, 'wait', 'a run of only 2 below');
  assert.equal(detectVwapReclaim(sess([100, 100, 98, 97, 96, 95, 94]), ctxFor(H1)).verdict, 'wait', 'never reclaims');
  assert.equal(detectVwapReclaim(sess([100, 98, 97, 96, 105], H1, D0, 6), ctxFor(H1)).verdict, 'wait', 'a 5-candle session (MIN_SESSION_BARS is 6) even though the file has 11 candles');
  const prevDay = sess([100, 98, 97, 96, 95, 94, 93, 92, 91, 90], H1, D0 - 10 * H1);            // yesterday's candles run into the new day: only the bars from 00:00 form the session
  const mixed = [...prevDay, vb(0, 105), vb(1, 106)]; assert.equal(detectVwapReclaim(mixed, ctxFor(H1)).verdict, 'wait', 'a new day: 2 bars only');
  assert.equal(detectVwapReclaim(sess([100, 98, 97, 96, 95, 105], 4 * H1, D0, 6), ctxFor(4 * H1, '4h')).verdict, 'wait', '4h: a 6-bar day would otherwise reclaim');
  assert.equal(detectVwapReclaim(sess([100, 98, 97, 96, 95, 105], H1, D0, 6), ctxFor(H1)).verdict, 'buy', 'CONTROL: the same closes on 1h reclaim');
  assert.equal(VWAP_RECLAIM.minCandles, 10);
});
test('6-c. NO REPEAT: signal fresh for FRESH_BARS candles (same identity), stale after', () => {
  assert.equal(VW_FRESH, 2);
  const at0 = detectVwapReclaim(sess(DOWN_THEN_UP), ctxFor(H1)); const at1 = detectVwapReclaim(sess([...DOWN_THEN_UP, 106]), ctxFor(H1)); const at2 = detectVwapReclaim(sess([...DOWN_THEN_UP, 106, 107]), ctxFor(H1));
  assert.equal(at0.verdict, 'buy'); assert.equal(at1.verdict, 'buy'); assert.equal(at1.signalTimestamp, at0.signalTimestamp); assert.equal(at2.verdict, 'wait');
});
test('6-d. the VWAP is volume-weighted: one enormous early bar drags it far above every later close, so the final 105 is NOT a reclaim; with equal volumes it is', () => {
  const cs = sess(DOWN_THEN_UP);
  assert.equal(detectVwapReclaim(cs, ctxFor(H1)).verdict, 'buy', 'CONTROL: equal volumes reclaim');
  const heavy = cs.slice(); const k = 4 + 1;                                  // the second candle of today's session (four previous-day candles come first)
  heavy[k] = { ...heavy[k], close: 140, open: 140, high: 140.2, low: 139.8, volume: 100_000 };
  assert.equal(detectVwapReclaim(heavy, ctxFor(H1)).verdict, 'wait');
});

/* ---------------- 7: RSI divergence with a trigger ---------------- */
const dbar = (i: number, close: number): C => ({ time: B0 + i * H1, open: close, close, high: close + 0.2, low: close - 0.2, volume: 100 });
function bullishPath(extra: number[] = []): C[] {
  const closes: number[] = [];
  for (let i = 0; i < 30; i++) closes.push(100 + (i % 2 === 0 ? 0.5 : -0.5));            // calm, RSI near 50
  closes.push(98, 96, 94, 92, 90, 89, 88);                                                  // steep fall to a first low (index 36): RSI very low
  closes.push(89, 92, 94, 96, 98);                                                          // bounce (37-41)
  for (let k = 0; k < 17; k++) closes.push(97.5 - 0.55 * k);                                // slow drift to a LOWER low (index 58 = 88.7... below 88 - see below)
  closes.push(86.5);                                                                        // index 59: the second low, a lower low than 88 but approached slowly: RSI higher
  closes.push(88, 90, 93, 96);                                                              // bounce and a close back above the swing candle's high (trigger)
  return [...closes, ...extra].map((c, i) => dbar(i, c));
}

test('7-a. BUY: price makes a lower low while RSI makes a higher low, and a later candle closes back above the swing candle\'s high', () => {
  assert.equal(DV_MIN, 60);
  const cs = bullishPath(); const r = detectRsiDivergenceTrigger(cs, ctxFor(H1));
  assert.equal(r.verdict, 'buy', `got ${r.verdict} for ${cs.length} candles`); assert.equal(r.signalDir, 'long');
  assert.equal(typeof r.params.swing, 'number'); assert.equal(r.params.inv, r.params.swing, 'invalidation = the swing low');
});
test('7-b. CONTROLS (wait): the same path without the trigger candle; a swing older than MAX_AGE; fewer than 60 candles; a flat market', () => {
  const full = bullishPath();
  assert.equal(detectRsiDivergenceTrigger(full.slice(0, full.length - 2), ctxFor(H1)).verdict, 'wait', 'before the closing-back-above trigger');
  assert.equal(MAX_AGE, 20);
  assert.equal(detectRsiDivergenceTrigger(bullishPath(Array.from({ length: 25 }, (_, i) => 96 + 0.1 * i)), ctxFor(H1)).verdict, 'wait', 'the divergence is more than MAX_AGE candles old');
  assert.equal(detectRsiDivergenceTrigger(full.slice(0, 50), ctxFor(H1)).verdict, 'wait', 'under 60 candles');
  assert.equal(detectRsiDivergenceTrigger(Array.from({ length: 80 }, (_, i) => dbar(i, 100)), ctxFor(H1)).verdict, 'wait', 'flat');
  assert.equal(RSI_DIVERGENCE.minCandles, 60);
});
test('7-b2. a divergence with NO trigger (no candle closes back above the swing candle high) is not a signal', () => {
  const noTrigger = bullishPath().slice(0, 60).concat([86.6, 86.6, 86.6, 86.6].map((c, k) => dbar(60 + k, c)));
  assert.equal(detectRsiDivergenceTrigger(noTrigger, ctxFor(H1)).verdict, 'wait');
});
test('7-c0. a new low BELOW the swing after it is confirmed kills the divergence while the signal would still be fresh', () => {
  const path = bullishPath().slice(0, 63).concat([dbar(63, 85)]);
  assert.equal(detectRsiDivergenceTrigger(path, ctxFor(H1)).verdict, 'wait');
  assert.equal(detectRsiDivergenceTrigger(bullishPath().slice(0, 63).concat([dbar(63, 95)]), ctxFor(H1)).verdict, 'buy', 'CONTROL: a normal candle there keeps it');
});
test('7-c. a NEW LOWER LOW after the swing kills the divergence (it failed)', () => {
  const cs = bullishPath([95, 92, 86]);   // price returns under the swing low: the divergence failed
  assert.equal(detectRsiDivergenceTrigger(cs, ctxFor(H1)).verdict, 'wait');
});
test('7-d. NO REPEAT: fresh for FRESH_BARS candles with one identity, then stale', () => {
  assert.equal(DV_FRESH, 2);
  const path = bullishPath();                                   // 64 candles: the swing low is index 59, confirmed at 62, triggered at 60
  const at0 = detectRsiDivergenceTrigger(path.slice(0, 63), ctxFor(H1)); const at1 = detectRsiDivergenceTrigger(path, ctxFor(H1)); const at2 = detectRsiDivergenceTrigger(bullishPath([97]), ctxFor(H1));
  assert.equal(at0.verdict, 'buy'); assert.equal(at1.verdict, 'buy'); assert.equal(at1.signalTimestamp, at0.signalTimestamp, 'one identity: the page pings once'); assert.equal(at2.verdict, 'wait', 'two candles on is stale');
});

/* ---- 7 (bearish side): the mirror image of the bullish fixture: a steep rise to a first HIGH, a slow drift to a HIGHER high with a lower RSI, then a close back below the swing candle's low ---- */
const bearishPath = (): C[] => bullishPath().map((c, i) => dbar(i, 200 - c.close));

test('7-e. SELL: price makes a higher high while RSI makes a lower high, and a later candle closes back below the swing candle\'s low', () => {
  const cs = bearishPath(); const r = detectRsiDivergenceTrigger(cs, ctxFor(H1));
  assert.equal(r.verdict, 'sell', `got ${r.verdict} for ${cs.length} candles`); assert.equal(r.signalDir, 'short');
  assert.equal(typeof r.params.swing, 'number'); assert.equal(r.params.inv, r.params.swing, 'invalidation = the swing high');
  assert.ok((r.params.trigger as number) < (r.params.swing as number), 'the trigger level is the swing candle low, under the swing high');
});
test('7-f. bearish controls: no trigger candle, a swing older than MAX_AGE, a NEW HIGH above the swing after it is confirmed, and one identity for 2 candles then stale', () => {
  const full = bearishPath();
  const noTrigger = full.slice(0, 60).concat([113.4, 113.4, 113.4, 113.4].map((c, k) => dbar(60 + k, c)));       // never closes under the swing candle low (113.3)
  assert.equal(detectRsiDivergenceTrigger(noTrigger, ctxFor(H1)).verdict, 'wait', 'a bearish divergence with no trigger is not a signal');
  assert.equal(detectRsiDivergenceTrigger(full.slice(0, 63).concat([dbar(63, 115)]), ctxFor(H1)).verdict, 'wait', 'a new high above the swing kills it');
  assert.equal(detectRsiDivergenceTrigger(full.slice(0, 63).concat([dbar(63, 105)]), ctxFor(H1)).verdict, 'sell', 'CONTROL: a normal candle there keeps it');
  const at0 = detectRsiDivergenceTrigger(full.slice(0, 63), ctxFor(H1)); const at1 = detectRsiDivergenceTrigger(full, ctxFor(H1)); const at2 = detectRsiDivergenceTrigger(bearishPath().concat([dbar(64, 103)]), ctxFor(H1));
  assert.equal(at0.verdict, 'sell'); assert.equal(at1.verdict, 'sell'); assert.equal(at1.signalTimestamp, at0.signalTimestamp); assert.equal(at2.verdict, 'wait');
  assert.equal(detectRsiDivergenceTrigger(Array.from({ length: 80 }, (_, i) => dbar(i, 100)), ctxFor(H1)).verdict, 'wait', 'flat');
});
