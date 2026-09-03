/* lib/pool.ts - the bounded worker pool shared by the symbol fan-outs (#665).
 *
 * The branch under test is the one that has never fired in practice: the
 * rate-limit stop. Both hand-rolled copies this file replaced
 * (snapshot/route.ts, rsi/route.ts) have carried that same untested branch
 * since they were written, because exercising it needs an upstream willing to
 * ban you.
 *
 * It does not. `runPool` takes `work` and `isFatal` as parameters, so a fake
 * `work` that throws HttpStatusError(429) on a chosen item proves the whole
 * contract with no network, no timers beyond a short sleep, and no upstream:
 * counts are directly observable rather than inferred.
 *
 * Written because QA's review of #667 pointed out that shipping the SHARED
 * version with the same untested branch carries the gap forward into every
 * future caller rather than one route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* Relative with the extension: run under `node --test`, which resolves neither
   tsconfig paths nor Next's `@/` alias. */
import { runPool, HttpStatusError, isRateLimitStatus, DEFAULT_CONCURRENCY } from '../lib/pool.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('never runs more than `limit` items at once', async () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  let inFlight = 0, peak = 0;

  await runPool(items, 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(5);
    inFlight--;
  });

  assert.equal(peak, 4, `peak concurrency ${peak}, expected exactly 4`);
});

test('the old shape is what this replaces - all 30 at once', async () => {
  /* Not a test of runPool. It pins the behaviour #665 was about, so the
     assertion above is visibly a change rather than an arbitrary number. */
  const items = Array.from({ length: 30 }, (_, i) => i);
  let inFlight = 0, peak = 0;

  await Promise.allSettled(items.map(async () => {
    inFlight++; peak = Math.max(peak, inFlight); await sleep(5); inFlight--;
  }));

  assert.equal(peak, 30, 'the unbounded shape should open every item at once');
});

test('a fatal error stops the run and reports it', async () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const attempted: number[] = [];

  const stopped = await runPool(items, 4, async (i) => {
    attempted.push(i);
    await sleep(2);
    if (i === 5) throw new HttpStatusError(429, 'rate limited');
  }, isRateLimitStatus);

  assert.equal(stopped, true, 'a fatal error must be reported to the caller');
  assert.ok(
    attempted.length < items.length,
    `stopped after ${attempted.length}/${items.length} - the pool drained the list instead of stopping`,
  );
});

test('an ordinary error does NOT stop the run', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const attempted: number[] = [];

  const stopped = await runPool(items, 4, async (i) => {
    attempted.push(i);
    if (i % 3 === 0) throw new Error('one bad symbol');
  }, isRateLimitStatus);

  assert.equal(stopped, false);
  assert.equal(
    attempted.length, 20,
    'one failing item must not lose the rest - the allSettled tolerance this replaced',
  );
});

test('items already in flight finish when a fatal fires', async () => {
  /* The stop is cooperative: a worker checks the flag between items, it does
     not abort work already started. Anything that has begun must complete, or
     a partial write could be left half-applied. */
  const items = Array.from({ length: 12 }, (_, i) => i);
  let started = 0, finished = 0;

  await runPool(items, 4, async (i) => {
    started++;
    await sleep(10);
    if (i === 0) throw new HttpStatusError(418, 'banned');
    finished++;
  }, isRateLimitStatus);

  assert.equal(
    finished, started - 1,
    `${started} started, ${finished} finished - every non-throwing item that began must complete`,
  );
});

test('with no isFatal, nothing is fatal', async () => {
  const items = [1, 2, 3];
  const stopped = await runPool(items, 2, async () => {
    throw new HttpStatusError(429, 'rate limited');
  });
  assert.equal(stopped, false, 'the default predicate must treat every failure as ordinary');
});

test('isRateLimitStatus recognises the three stop codes and nothing else', () => {
  for (const s of [418, 429, 403]) {
    assert.equal(isRateLimitStatus(new HttpStatusError(s, `${s}`)), true, `${s} should stop the pool`);
  }
  /* 404 and 500 are about the one symbol asked for; spending the remaining
     requests is correct for those and wrong for the three above. */
  for (const s of [400, 404, 418 - 1, 500, 502]) {
    assert.equal(isRateLimitStatus(new HttpStatusError(s, `${s}`)), false, `${s} should not stop the pool`);
  }
  assert.equal(isRateLimitStatus(new Error('429 in the message')), false,
    'a plain Error must not stop the pool just because its text looks like a status');
});

test('an empty list runs nothing and does not hang', async () => {
  let calls = 0;
  const stopped = await runPool([], DEFAULT_CONCURRENCY, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(stopped, false);
});

test('a limit larger than the list does not spawn idle workers past the end', async () => {
  const items = [1, 2, 3];
  let calls = 0;
  await runPool(items, 50, async () => { calls++; });
  assert.equal(calls, 3, 'each item must run exactly once regardless of the limit');
});
