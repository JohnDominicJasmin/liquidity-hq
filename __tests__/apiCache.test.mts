/* Single-flight in lib/apiCache.ts (#199).
 *
 * The property under test is not "does it cache" - it did that already. It is
 * "do N concurrent callers produce ONE upstream call". Every one of these
 * assertions FAILS against the previous implementation, with the numbers in the
 * failure messages below; that is the point, and it is why they are written as
 * exact counts rather than `assert.ok(calls < 20)`.
 *
 * No network and no timers beyond a short sleep: the fetcher is a counter, so
 * "upstream calls" is directly observable rather than inferred.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* Relative with the extension: run under `node --test`, which resolves neither
   tsconfig paths nor Next's `@/` alias. */
import { cached, cachedStale } from '../lib/apiCache.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A fetcher that counts its own invocations and is slow enough to overlap. */
function counter<T>(value: T, ms = 40) {
  const state = { calls: 0 };
  return {
    state,
    fn: async () => { state.calls++; await sleep(ms); return value; },
  };
}

/* Keys are unique per test. `store` is module-level and shared across the whole
   file, so a reused key would make one test depend on another's leftovers. */
let n = 0;
const key = (label: string) => `test:${label}:${++n}`;

test('concurrent callers share one upstream request', async (t) => {
  await t.test('cached: 20 cold callers produce exactly 1 call', async () => {
    const k = key('cold');
    const { state, fn } = counter('v');

    const results = await Promise.all(Array.from({ length: 20 }, () => cached(k, 5_000, fn)));

    assert.equal(state.calls, 1,
      `20 concurrent callers made ${state.calls} upstream calls; the old implementation made 20`);
    assert.deepEqual(results, Array(20).fill('v'), 'every caller gets the same value');
  });

  await t.test('cached: the stampede at EXPIRY is the one that matters', async () => {
    const k = key('expiry');
    const { state, fn } = counter('v');

    await cached(k, 60, fn);        // warm it
    assert.equal(state.calls, 1);
    await sleep(90);                 // let it expire

    await Promise.all(Array.from({ length: 20 }, () => cached(k, 60, fn)));

    /* 2 = the warm call plus one refresh shared by all 20. The old
       implementation made 21, which is the failure mode the cache exists to
       prevent, happening once per TTL under exactly the load it was added for. */
    assert.equal(state.calls, 2,
      `expected 2 upstream calls (warm + one shared refresh), got ${state.calls}`);
  });

  await t.test('cachedStale: same guarantee', async () => {
    const k = key('stale');
    const { state, fn } = counter('v');

    const results = await Promise.all(Array.from({ length: 20 }, () => cachedStale(k, 5_000, fn)));

    assert.equal(state.calls, 1, `got ${state.calls} upstream calls`);
    assert.ok(results.every(r => r.data === 'v' && r.stale === false));
  });

  await t.test('a hit still does not call upstream at all', async () => {
    const k = key('hit');
    const { state, fn } = counter('v');
    await cached(k, 5_000, fn);
    await cached(k, 5_000, fn);
    assert.equal(state.calls, 1, 'second call inside the TTL must be served from the store');
  });
});

test('failures are not cached and do not wedge the key', async (t) => {
  await t.test('a rejected fetch is retried by the next caller', async () => {
    const k = key('reject');
    let calls = 0;
    const flaky = async () => {
      calls++;
      await sleep(10);
      if (calls === 1) throw new Error('upstream down');
      return 'recovered';
    };

    await assert.rejects(() => cached(k, 5_000, flaky), /upstream down/);

    /* The critical half: `inflight` is cleared in a `finally`, so the failed
       promise is not left in the map. Without that, every later caller would
       await an already-rejected promise and the key would be permanently
       broken - strictly worse than having no single-flight at all. */
    assert.equal(await cached(k, 5_000, flaky), 'recovered');
    assert.equal(calls, 2);
  });

  await t.test('concurrent callers all see the failure, and it is called once', async () => {
    const k = key('reject-concurrent');
    const state = { calls: 0 };
    const failing = async () => { state.calls++; await sleep(20); throw new Error('boom'); };

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => cached(k, 5_000, failing)),
    );

    assert.equal(state.calls, 1, 'a failing upstream must not be hit 10 times either');
    assert.ok(settled.every(s => s.status === 'rejected'), 'no caller silently gets undefined');
  });

  await t.test('cachedStale serves the last good value when the refresh fails', async () => {
    const k = key('stale-serves');
    let calls = 0;
    const fn = async () => {
      calls++;
      await sleep(10);
      if (calls > 1) throw new Error('upstream down');
      return 'good';
    };

    const first = await cachedStale(k, 50, fn);
    assert.equal(first.data, 'good');
    assert.equal(first.stale, false);

    await sleep(80);
    const second = await cachedStale(k, 50, fn);
    assert.equal(second.data, 'good', 'stale beats a hole on the page');
    assert.equal(second.stale, true);
  });
});
