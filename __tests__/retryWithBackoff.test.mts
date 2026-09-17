import test from 'node:test';
import assert from 'node:assert/strict';
import { retryWithBackoff } from '../lib/retryWithBackoff.ts';

/* #1199. Both existing callers (AuthProvider's entitlements fetch, #1119;
 * SettingsProvider's flushToDb, #1188) had this loop hand-written and
 * byte-identical; this is the extracted shared version. The PR's own
 * "How to test" section calls for this module in isolation - the callers'
 * own behavior is already covered by qa/e2e/entitlement-unknown.spec.ts and
 * friends, which the refactor must not have changed. */

type Res = { failed: boolean; tag?: string };

/* `t.mock.timers.tick()` fires a due setTimeout callback synchronously, but
 * the `await` resuming inside retryWithBackoff after that happens on a
 * later microtask - flushing a couple of ticks gives that continuation a
 * chance to run before the test asserts on it. */
async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

test('retryWithBackoff', async (t) => {
  await t.test('succeeds on the first attempt: one call, no wait, attempts=1', async () => {
    const calls: number[] = [];
    const attempt = async (n: number) => { calls.push(n); return { failed: false, tag: 'ok' } as Res; };
    const out = await retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000] });
    assert.deepEqual(calls, [1]);
    assert.equal(out.attempts, 1);
    assert.equal(out.cancelled, false);
    assert.equal(out.result.tag, 'ok');
  });

  await t.test('fails once, then succeeds: waits backoffMs[0] between, not after', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls: number[] = [];
    const attempt = async (n: number) => {
      calls.push(n);
      return n === 1 ? { failed: true } as Res : { failed: false, tag: 'ok' } as Res;
    };
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000] });
    await flushMicrotasks(); // let attempt 1 run and schedule its backoff
    assert.deepEqual(calls, [1], 'attempt 2 must not fire before the backoff elapses');
    t.mock.timers.tick(999);
    await flushMicrotasks();
    assert.deepEqual(calls, [1], 'one ms early, attempt 2 still has not fired');
    t.mock.timers.tick(1);
    await flushMicrotasks();
    assert.deepEqual(calls, [1, 2]);
    const out = await p;
    assert.equal(out.attempts, 2);
    assert.equal(out.cancelled, false);
    assert.equal(out.result.tag, 'ok');
  });

  await t.test('every attempt fails: returns the LAST attempt\'s result, attempts=maxAttempts, never waits after the last one', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls: number[] = [];
    const attempt = async (n: number) => { calls.push(n); return { failed: true, tag: `try-${n}` } as Res; };
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [10, 20] });
    await flushMicrotasks();
    t.mock.timers.tick(10);
    await flushMicrotasks();
    t.mock.timers.tick(20);
    await flushMicrotasks();
    const out = await p;
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(out.attempts, 3);
    assert.equal(out.cancelled, false);
    assert.equal(out.result.tag, 'try-3', 'the final (failed) attempt\'s own result, not the first');
  });

  await t.test('isCancelled true right after a SUCCESSFUL attempt still reports cancelled - caller must not act on it', async () => {
    let cancelled = false;
    const attempt = async () => { cancelled = true; return { failed: false, tag: 'ok' } as Res; };
    const out = await retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000], isCancelled: () => cancelled });
    assert.equal(out.cancelled, true, 'matches AuthProvider\'s own pre-extraction check: cancelled is tested before failed, every time');
    assert.equal(out.attempts, 1);
  });

  await t.test('isCancelled true during the backoff wait stops the loop before attempt 2 ever runs', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelled = false;
    const calls: number[] = [];
    const attempt = async (n: number) => { calls.push(n); return { failed: true } as Res; };
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000], isCancelled: () => cancelled });
    await flushMicrotasks();
    assert.deepEqual(calls, [1]);
    cancelled = true; // e.g. the component unmounted while waiting out the backoff
    t.mock.timers.tick(1000);
    await flushMicrotasks();
    const out = await p;
    assert.deepEqual(calls, [1], 'attempt 2 never ran once cancelled fired during the wait');
    assert.equal(out.cancelled, true);
    assert.equal(out.attempts, 1);
  });

  await t.test('omitting isCancelled (SettingsProvider\'s case) never reports cancelled', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const attempt = async (n: number) => (n < 3 ? { failed: true } as Res : { failed: false, tag: 'ok' } as Res);
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [10, 20] });
    await flushMicrotasks();
    t.mock.timers.tick(10);
    await flushMicrotasks();
    t.mock.timers.tick(20);
    await flushMicrotasks();
    const out = await p;
    assert.equal(out.cancelled, false);
    assert.equal(out.attempts, 3);
    assert.equal(out.result.tag, 'ok');
  });
});
