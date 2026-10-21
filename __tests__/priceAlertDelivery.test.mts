/* #1667 (#1669): a triggered price alert is switched off only when its message actually landed.
 *
 * Before #1669 the alert cron sent the Telegram message and then switched the alert off whatever happened: a send that failed (bot blocked,
 * chat not found, Telegram down) or was paused by the /ops kill switch still consumed it, and the user lost the alert silently.
 *
 * THE ORACLE is #1667's own rule, not the code: consumed only when delivered to at least one chat; a paused send never consumes; a failed
 * send keeps the alert, with a retry count and a backoff. The backoff numbers (5 min, doubling, at most 6 h) are the design stated in
 * lib/priceAlertDelivery.ts's header.
 *
 * WHAT IT CANNOT PROVE: the cron route wiring (which alert is sent, which is switched off): that is the route test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterSend, dueForRetry, holdExpired, retryDelayMs, HOLD_MAX_MS, RETRY_BASE_MS, RETRY_CAP_MS } from '../lib/priceAlertDelivery.ts';

const MIN = 60_000, H = 3_600_000, T0 = Date.UTC(2026, 9, 22, 1, 0, 0);
const BODY = '🎯 BTC Price Alert Triggered';

test('D1. delivered to at least one chat: the alert is consumed and nothing is held', () => {
  assert.deepEqual(afterSend({ sent: 1, failed: 0, paused: false }, undefined, BODY, T0), { consume: true, pending: null });
  assert.deepEqual(afterSend({ sent: 1, failed: 2, paused: false }, undefined, BODY, T0), { consume: true, pending: null }, 'one landed of three is delivered');
  const held = { body: BODY, attempts: 3, nextAt: T0, firstAt: T0 - H };
  assert.deepEqual(afterSend({ sent: 1, failed: 0, paused: false }, held, BODY, T0), { consume: true, pending: null }, 'a successful retry clears what was held');
});

test('D2. paused by the kill switch: nothing is consumed, nothing is counted, and a message already owed stays owed exactly as it was', () => {
  assert.deepEqual(afterSend({ sent: 0, failed: 0, paused: true }, undefined, BODY, T0), { consume: false, pending: null });
  const held = { body: 'owed', attempts: 2, nextAt: T0 - MIN, firstAt: T0 - H };
  assert.deepEqual(afterSend({ sent: 0, failed: 0, paused: true }, held, BODY, T0), { consume: false, pending: held });
});

test('D3. failed everywhere: the alert is kept, the attempt is counted, and the message is held for a retry after the backoff', () => {
  assert.deepEqual(afterSend({ sent: 0, failed: 1, paused: false }, undefined, BODY, T0), { consume: false, pending: { body: BODY, attempts: 1, nextAt: T0 + 5 * MIN, firstAt: T0 } });
  const second = afterSend({ sent: 0, failed: 1, paused: false }, { body: BODY, attempts: 1, nextAt: T0, firstAt: T0 - 5 * MIN }, BODY, T0);
  assert.deepEqual(second, { consume: false, pending: { body: BODY, attempts: 2, nextAt: T0 + 10 * MIN, firstAt: T0 - 5 * MIN } });
});

test('D4. the backoff: 5, 10, 20, 40 minutes ... never more than 6 h', () => {
  assert.equal(RETRY_BASE_MS, 5 * MIN); assert.equal(RETRY_CAP_MS, 6 * H);
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN]);
  assert.equal(retryDelayMs(7), 320 * MIN, '5 min x 2^6 = 320 min, still under the cap');
  assert.equal(retryDelayMs(8), 6 * H, '5 min x 2^7 = 640 min is past the 6 h cap');
  assert.equal(retryDelayMs(50), 6 * H, 'a long-failing alert is still retried, at the cap, not overflowed');
  assert.equal(retryDelayMs(0), 5 * MIN);
});

test('D5. a held message is due from its nextAt on, not a millisecond before (no early resend, so no duplicate inside the backoff)', () => {
  const p = { body: BODY, attempts: 1, nextAt: T0 + 5 * MIN, firstAt: T0 };
  assert.equal(dueForRetry(p, T0 + 5 * MIN - 1), false);
  assert.equal(dueForRetry(p, T0 + 5 * MIN), true);
});

test('D6. a hold is chased for at most a day from its FIRST failed attempt, however many retries came between', () => {
  assert.equal(HOLD_MAX_MS, 24 * H);
  const p = { body: BODY, attempts: 9, nextAt: T0 + 30 * H, firstAt: T0 };
  assert.equal(holdExpired(p, T0 + 24 * H), false, 'exactly a day is still inside');
  assert.equal(holdExpired(p, T0 + 24 * H + 1), true);
});
