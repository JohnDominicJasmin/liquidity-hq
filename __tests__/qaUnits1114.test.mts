import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerWasCutOff } from '../lib/xaiAnswer.ts';
import { oiHistChange } from '../lib/oiTrend1h.ts';
import { chartFromCandles, ARENA_CHART_MIN_CANDLES } from '../lib/arenaChartServer.ts';
import { calcEMA } from '../lib/grok.ts';

/* QA's unit cells for the 2026-11-14 batch: #2273 (answerWasCutOff), #2275 (the Bybit 1h OI span), #2280 (chartFromCandles).
 * Each expectation is written from the PR body, NOT from reading the function under test, and each has a negative case so a function that
 * returns the same thing for every input cannot pass. */

/* ---------- #2273: a truncated AI answer is recognised ---------- */
test('#2273 A1. answerWasCutOff is true for the Responses API "incomplete" status', () => {
  assert.equal(answerWasCutOff({ status: 'incomplete' }), true);
});
test('#2273 A2. answerWasCutOff is true for a chat-completions finish_reason "length"', () => {
  assert.equal(answerWasCutOff({ choices: [{ finish_reason: 'length' }] }), true);
});
test('#2273 A3. CONTROLS: completed answers, stop, null and empty objects are not cut off', () => {
  assert.equal(answerWasCutOff({ status: 'completed' }), false);
  assert.equal(answerWasCutOff({ choices: [{ finish_reason: 'stop' }] }), false);
  assert.equal(answerWasCutOff(null), false);
  assert.equal(answerWasCutOff(undefined), false);
  assert.equal(answerWasCutOff({}), false);
  assert.equal(answerWasCutOff({ choices: [] }), false);
  assert.equal(answerWasCutOff('incomplete'), false, 'a bare string is not an answer object');
});

/* ---------- #2275: the Bybit 1h OI figure must span the hour ---------- */
/** What the Bybit branch of lib/useOI1h.ts does with the proxy's newest-first list, written out here from the PR body: reverse it, map the field
 *  names, and ask the shared helper for a 60 minute window with one 5-minute poll of tolerance. */
const bybitRead = (list: Array<{ openInterest: string; timestamp?: string }>) =>
  oiHistChange(list.slice().reverse().map(x => ({ sumOpenInterest: x.openInterest, timestamp: x.timestamp })), { ms: 60 * 60_000, toleranceMs: 5 * 60_000 });
const NOW = 1_800_000_000_000;
const rows = (n: number, stepMs: number, oi = (i: number) => String(1000 + i)) => Array.from({ length: n }, (_, k) => { const i = n - 1 - k; return { openInterest: oi(i), timestamp: String(NOW - k * stepMs) }; }); // newest first

test('#2275 B1. a 13-row newest-first list spanning 60 minutes gives a percentage', () => {
  const r = bybitRead(rows(13, 5 * 60_000));
  assert.ok(r, 'a real hour must read');
  assert.ok(r!.oiPct !== null && Number.isFinite(r!.oiPct as number), 'a finite OI percentage');
  assert.ok((r!.oiPct as number) > 0, 'OI grew from 1000 to 1012, so the change is positive (' + r!.oiPct + ')');
});
test('#2275 B2. 55 and 65 minute spans are inside the tolerance', () => {
  assert.ok(bybitRead(rows(13, 55 * 60_000 / 12)), '55 min reads');
  assert.ok(bybitRead(rows(13, 65 * 60_000 / 12)), '65 min reads');
});
test('#2275 B3. a gapped list spanning 3 hours is NOT read as an hour', () => {
  assert.equal(bybitRead(rows(13, 15 * 60_000)), null);
});
test('#2275 B4. rows with no timestamp are unknown, not a pass', () => {
  assert.equal(bybitRead(rows(13, 5 * 60_000).map(x => ({ openInterest: x.openInterest }))), null);
});
test('#2275 B5. fewer than two rows is unknown', () => {
  assert.equal(bybitRead(rows(1, 5 * 60_000)), null);
  assert.equal(bybitRead([]), null);
});
test('#2275 B6. the Bybit branch of useOI1h.ts really goes through oiHistChange with the 60 minute window (source guard: the hook cannot be mounted here)', () => {
  const src = readFileSync(new URL('../lib/useOI1h.ts', import.meta.url), 'utf8');
  assert.match(src, /oiHistChange\(list\.slice\(\)\.reverse\(\)\.map\(/, 'the Bybit list is reversed and read by the shared helper');
  assert.match(src, /ms: 60 \* 60_000, toleranceMs: 5 \* 60_000/, 'the same 60 minute window and 5 minute tolerance as Binance');
  assert.match(src, /timestamp\?: string/, 'timestamp is typed on the Bybit rows');
});

/* ---------- #2280: the server builds the Arena chart object from candles ---------- */
const candle = (i: number) => { const base = 100 + Math.sin(i / 7) * 5 + i * 0.05; return { open: base, high: base + 1.5, low: base - 1.5, close: base + 0.4, volume: 1000 + i * 10, time: 1_700_000_000_000 + i * 3_600_000 } as never; };
const candles = (n: number) => Array.from({ length: n }, (_, i) => candle(i));

test('#2280 C1. fewer than 60 usable candles gives null; exactly 60 gives a chart', () => {
  assert.equal(ARENA_CHART_MIN_CANDLES, 60);
  assert.equal(chartFromCandles('1h', candles(59)), null);
  assert.ok(chartFromCandles('1h', candles(60)));
  assert.equal(chartFromCandles('1h', []), null);
});
test('#2280 C2. candles with non-finite fields do not count as usable', () => {
  const bad = candles(80).map((c, i) => (i % 2 === 0 ? { ...(c as object), close: NaN } as never : c));
  assert.equal(chartFromCandles('1h', bad), null, '40 usable candles are fewer than 60');
});
test('#2280 C3. the shape: tf kept, recent20 holds 15 candles, hi/lo cover the 80-candle window, ema9 matches calcEMA of the closes', () => {
  const cs = candles(120); const ch = chartFromCandles('4h', cs)!;
  assert.equal(ch.tf, '4h');
  assert.equal(ch.recent20.split(' | ').length, 15, 'the text carries 15 candles');
  const win = cs.slice(-80) as unknown as Array<{ high: number; low: number }>;
  assert.equal(ch.hi, Math.max(...win.map(c => c.high)));
  assert.equal(ch.lo, Math.min(...win.map(c => c.low)));
  const closes = (cs as unknown as Array<{ close: number }>).map(c => c.close);
  assert.equal(ch.ema9, calcEMA(closes, 9).at(-1));
});
test('#2280 C4. deterministic, and it reads the candles it is given: a shifted series gives a different chart', () => {
  const a = chartFromCandles('1h', candles(100)), b = chartFromCandles('1h', candles(100));
  assert.deepEqual(a, b);
  const shifted = candles(100).map(c => ({ ...(c as object), close: (c as unknown as { close: number }).close + 50, high: (c as unknown as { high: number }).high + 50, low: (c as unknown as { low: number }).low + 50, open: (c as unknown as { open: number }).open + 50 }) as never);
  const c = chartFromCandles('1h', shifted)!;
  assert.notEqual(c.ema9, a!.ema9);
  assert.ok(c.lo > a!.hi - 10, 'the shifted window sits above the original one');
});
test('#2280 C5. the flag stays off by default (source guard): /api/grok reads GROK_SERVER_CHART and falls back to the browser chart', () => {
  const src = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8');
  assert.match(src, /GROK_SERVER_CHART/, 'the route is gated by the flag');
  assert.match(src, /process\.env\.GROK_SERVER_CHART\s*===\s*['"]1['"]/, 'only the exact value 1 turns it on');
});
