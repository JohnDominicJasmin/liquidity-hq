import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeAction, RESUME_BACKFILL_CANDLES, RESUME_QUIET_MS } from '../lib/chartResume.ts';
import { socketNeedsReconnect } from '../lib/socketResume.ts';
import { STREAM_STALL_MS, isStreamStalled } from '../lib/streamWatch.ts';

/* #2553 (owner bug: chart EMPTY after 1-2 h idle, until a refresh). QA's pins for the two pure decision functions. The thresholds are written as the NUMBERS the owner-facing behaviour was specified with (450 candles, 30 s,
 * 2 candles), not read back from the constants, so a silent change of a constant goes red here; the constants are pinned once in R0.
 *   R1..R7  resumeAction, one case per branch, in the order the function takes them, each with the NEIGHBOUR case that must go the other way (the boundary)
 *   S1..S4  socketNeedsReconnect
 *   W1      the stall window is 45 s now (was 60 s): pinned so nobody moves it back by accident */

const MIN = 60_000, NOW = 1_800_000_000_000;
const base = { lastBarTs: NOW - MIN, periodMs: MIN, now: NOW, socketOpen: true, lastMsgAt: NOW - 1000 };

test('R0. the specified thresholds', () => { assert.equal(RESUME_BACKFILL_CANDLES, 450); assert.equal(RESUME_QUIET_MS, 30_000); });
test('R1. no candles on the chart -> reload (null, NaN)', () => {
  assert.equal(resumeAction({ ...base, lastBarTs: null }).do, 'reload');
  assert.equal(resumeAction({ ...base, lastBarTs: Number.NaN }).do, 'reload');
});
test('R2. a gap wider than 450 candles -> reload; exactly 450 is still a reconnect-able gap (never reload)', () => {
  const over = resumeAction({ ...base, lastBarTs: NOW - 451 * MIN }); assert.equal(over.do, 'reload'); assert.match((over as { reason: string }).reason, /451/);
  assert.notEqual(resumeAction({ ...base, lastBarTs: NOW - 450 * MIN }).do, 'reload', '450 candles old must not reload');
  assert.equal(resumeAction({ ...base, lastBarTs: NOW - 450 * MIN }).do, 'reconnect', '450 old with a healthy socket is still behind by >=2: reconnect');
});
test('R3. socket not open -> reconnect, even when the newest candle is current', () => {
  assert.equal(resumeAction({ ...base, socketOpen: false }).do, 'reconnect');
});
test('R4. socket quiet for more than 30 s -> reconnect; 30 s exactly and a null lastMsgAt', () => {
  assert.equal(resumeAction({ ...base, lastMsgAt: NOW - 31_000 }).do, 'reconnect');
  assert.equal(resumeAction({ ...base, lastMsgAt: NOW - 30_000 }).do, 'none', 'exactly 30 s is not yet quiet');
  assert.equal(resumeAction({ ...base, lastMsgAt: null }).do, 'reconnect');
});
test('R5. newest candle 2 or more periods old -> reconnect; 1 old (the forming one) -> none', () => {
  assert.equal(resumeAction({ ...base, lastBarTs: NOW - 2 * MIN }).do, 'reconnect');
  assert.equal(resumeAction({ ...base, lastBarTs: NOW - 1 * MIN }).do, 'none');
  assert.equal(resumeAction({ ...base, lastBarTs: NOW - 59_000 }).do, 'none');
});
test('R6. a fresh chart with a live socket -> none', () => { assert.deepEqual(resumeAction({ ...base }), { do: 'none' }); });
test('R7. unknown period: a missing or zero period never throws, and falls back to the socket state', () => {
  assert.equal(resumeAction({ ...base, periodMs: null }).do, 'none');
  assert.equal(resumeAction({ ...base, periodMs: 0 }).do, 'none');
  assert.equal(resumeAction({ ...base, periodMs: null, socketOpen: false }).do, 'reconnect');
  assert.equal(resumeAction({ ...base, lastBarTs: null, periodMs: null }).do, 'reload', 'no candles still reloads when the period is unknown');
});
test('R8. CONTROL: all three actions are reachable (the cases above are not all "none")', () => {
  const seen = new Set([resumeAction({ ...base, lastBarTs: null }).do, resumeAction({ ...base, socketOpen: false }).do, resumeAction({ ...base }).do]);
  assert.deepEqual([...seen].sort(), ['none', 'reconnect', 'reload']);
});

test('S1. not OPEN -> reconnect (CONNECTING 0, CLOSING 2, CLOSED 3, null, undefined)', () => {
  for (const s of [0, 2, 3, null, undefined]) assert.equal(socketNeedsReconnect(s, NOW - 100, NOW), true, `readyState ${String(s)}`);
});
test('S2. OPEN but never heard from (lastMsgAt null / NaN) -> reconnect', () => {
  assert.equal(socketNeedsReconnect(1, null, NOW), true); assert.equal(socketNeedsReconnect(1, Number.NaN, NOW), true);
});
test('S3. OPEN and quiet more than 30 s -> reconnect; exactly 30 s is not', () => {
  assert.equal(socketNeedsReconnect(1, NOW - 30_001, NOW), true); assert.equal(socketNeedsReconnect(1, NOW - 30_000, NOW), false);
});
test('S4. OPEN and fresh -> no reconnect; a custom quiet window is honoured', () => {
  assert.equal(socketNeedsReconnect(1, NOW - 500, NOW), false);
  assert.equal(socketNeedsReconnect(1, NOW - 5_000, NOW, 2_000), true);
});
test('W1. the stall window is 45 s; a stream 44 s quiet is not stalled, 46 s is', () => {
  assert.equal(STREAM_STALL_MS, 45_000);
  assert.equal(isStreamStalled(NOW - 44_000, NOW), false); assert.equal(isStreamStalled(NOW - 46_000, NOW), true);
});
