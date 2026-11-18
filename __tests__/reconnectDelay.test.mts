import test from 'node:test';
import assert from 'node:assert/strict';
import { reconnectDelayMs, OFFLINE_BACKOFF_FLOOR_MS, OFFLINE_BACKOFF_CAP_MS } from '../lib/reconnectDelay.ts';

/* #2570 (QA finding: 1,554 sockets in a 90-minute offline run). The SPECIFIED rule, written as numbers, not read back from the constants:
 *   online AND visible: the loop's own delay (normalMs) unchanged, or 1,1,2,4,8,16,30 s when none is given
 *   offline OR hidden:  min(30 s, 1 s x 2^attempt), never under 5 s  =>  attempts 0..7 = 5,5,5,8,16,30,30,30 s, and normalMs is IGNORED
 * R1 online+visible own delay; R2 online+visible default ladder; R3 offline ladder; R4 hidden-but-online ladder; R5 offline ignores normalMs;
 * R6 bad attempts (NaN, negative, fractions, Infinity) never throw and read as attempt 0 / floor; R7 the constants are the specified 5 s and 30 s;
 * R8 CONTROL: the offline delay is never shorter than the online one for the same attempt (a backoff that is faster than the normal loop is a bug). */
const on = { online: true, visible: true }, off = { online: false, visible: true }, hid = { online: true, visible: false };
const seq = (o: { online: boolean; visible: boolean; normalMs?: number }, n: number) => Array.from({ length: n }, (_, i) => reconnectDelayMs(i, o));

test('R1. online and visible: the loop\'s own delay is unchanged', () => { assert.equal(reconnectDelayMs(3, { ...on, normalMs: 2_500 }), 2_500); assert.equal(reconnectDelayMs(0, { ...on, normalMs: 0 }), 0); });
test('R2. online and visible with no own delay: 1,1,2,4,8,16,30,30 s', () => { assert.deepEqual(seq(on, 8), [1_000, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]); });
test('R3. offline: 5,5,5,8,16,30,30,30 s', () => { assert.deepEqual(seq(off, 8), [5_000, 5_000, 5_000, 8_000, 16_000, 30_000, 30_000, 30_000]); });
test('R4. hidden but online: the same ladder as offline', () => { assert.deepEqual(seq(hid, 8), [5_000, 5_000, 5_000, 8_000, 16_000, 30_000, 30_000, 30_000]); assert.deepEqual(seq({ online: false, visible: false }, 6), seq(off, 6)); });
test('R5. offline ignores the loop\'s own short delay', () => { assert.equal(reconnectDelayMs(0, { ...off, normalMs: 1_000 }), 5_000); assert.equal(reconnectDelayMs(1, { ...hid, normalMs: 0 }), 5_000); });
test('R6. a bad attempt number never throws and never goes under the floor', () => {
  for (const a of [Number.NaN, -3, 0.4, Number.POSITIVE_INFINITY, -Infinity]) { const d = reconnectDelayMs(a, off); assert.ok(Number.isFinite(d) && d >= 5_000 && d <= 30_000, `attempt ${a} gave ${d}`); }
  assert.equal(reconnectDelayMs(Number.NaN, on), 1_000);
});
test('R7. the floor is 5 s and the cap is 30 s', () => { assert.equal(OFFLINE_BACKOFF_FLOOR_MS, 5_000); assert.equal(OFFLINE_BACKOFF_CAP_MS, 30_000); });
test('R8. CONTROL: offline is never faster than online for the same attempt (default ladders)', () => { for (let i = 0; i < 10; i++) assert.ok(reconnectDelayMs(i, off) >= reconnectDelayMs(i, on), `attempt ${i}`); });
