import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../lib/rateLimit.ts';

/* lib/rateLimit.ts's rateLimit() - exported, pure (module-level Map aside),
 * no test existed before this (flagged in TEST_GAPS.md §1's 2026-09-12
 * audit as the one "testable today, no seam needed" item). Date.now() is
 * mocked (node:test's built-in Date mock) so window-reset timing doesn't
 * need real sleeps. Every test uses its own unique key - the module-level
 * `buckets` Map has no reset export and persists for the whole file, so a
 * shared key across tests would leak state between them. */

test('rateLimit', async (t) => {
  await t.test('requests up to and including the limit are all allowed', () => {
    const key = 'at-limit-' + Math.random();
    assert.equal(rateLimit(key, 3, 1000), true, '1st request');
    assert.equal(rateLimit(key, 3, 1000), true, '2nd request');
    assert.equal(rateLimit(key, 3, 1000), true, '3rd request - exactly at the limit, still allowed');
  });

  await t.test('the request one over the limit is rejected', () => {
    const key = 'one-over-' + Math.random();
    assert.equal(rateLimit(key, 3, 1000), true, '1st');
    assert.equal(rateLimit(key, 3, 1000), true, '2nd');
    assert.equal(rateLimit(key, 3, 1000), true, '3rd - at the limit');
    assert.equal(rateLimit(key, 3, 1000), false, '4th - one over, must be rejected');
    assert.equal(rateLimit(key, 3, 1000), false, '5th - still rejected, not a one-shot block');
  });

  await t.test('the first request after the window resets is allowed again', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const key = 'window-reset-' + Math.random();
    assert.equal(rateLimit(key, 2, 1000), true, '1st, starts the window');
    assert.equal(rateLimit(key, 2, 1000), true, '2nd, at the limit');
    assert.equal(rateLimit(key, 2, 1000), false, '3rd, still inside the window - rejected');

    t.mock.timers.tick(1001); // past the 1000ms window
    assert.equal(rateLimit(key, 2, 1000), true, 'first request after reset - fresh window, allowed');
    assert.equal(rateLimit(key, 2, 1000), true, 'second request in the new window - at the (new) limit');
    assert.equal(rateLimit(key, 2, 1000), false, 'third in the new window - rejected again');
  });

  await t.test('independent keys do not share a bucket or interfere with each other', () => {
    const keyA = 'independent-a-' + Math.random();
    const keyB = 'independent-b-' + Math.random();
    assert.equal(rateLimit(keyA, 1, 1000), true, 'A: 1st, allowed');
    assert.equal(rateLimit(keyA, 1, 1000), false, 'A: 2nd, exceeds A\'s own limit of 1');
    // B has never been called - it must have its own fresh bucket, not
    // inherit A's exhausted count.
    assert.equal(rateLimit(keyB, 1, 1000), true, 'B: 1st, unaffected by A being exhausted');
  });

  await t.test('an empty-string key is tracked like any other single key - not specially guarded', () => {
    // Documents real, current behaviour rather than asserting a policy: if
    // two callers both resolve to the same fallback key (e.g. getClientIp's
    // own 'unknown' fallback for a request Cloudflare didn't tag), they
    // share one bucket. That is a real characteristic of this function, not
    // a defect being tested for - callers that care must ensure their key
    // is actually unique per caller before calling this.
    const key = '';
    assert.equal(rateLimit(key, 2, 1000), true, '1st');
    assert.equal(rateLimit(key, 2, 1000), true, '2nd, at the limit');
    assert.equal(rateLimit(key, 2, 1000), false, '3rd, rejected - the empty key IS being tracked, not bypassed');
  });
});
