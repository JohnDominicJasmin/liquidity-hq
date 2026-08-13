/* The size cap on lib/apiCache.ts's store (#253).
 *
 * The bound itself is one assertion. The other four are the things a naive cap
 * BREAKS, which QA named on the issue before I wrote it:
 *
 *   - `inflight` is keyed identically and cleared in a `finally`; eviction must
 *     not disturb it or a rejected fetcher wedges a key
 *   - `cachedStale` deliberately does not refresh its timestamp on failure, so
 *     recovery is automatic once an upstream recovers. Evicting the stale entry
 *     turns "serving slightly old data" into "every request hits a dead
 *     upstream" - the opposite of what cachedStale is for
 *
 * Written against LRU rather than oldest-inserted, because oldest-inserted
 * passes the size assertion and fails both of the above.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cached, cachedStale, _cacheSize } from '../lib/apiCache.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let n = 0;
const key = (label: string) => `cap:${label}:${++n}`;

test('the store is bounded', async (t) => {
  await t.test('writing far past the cap does not grow it without limit', async () => {
    const before = _cacheSize();
    const prefix = key('flood');
    for (let i = 0; i < 900; i++) {
      await cached(`${prefix}:${i}`, 60_000, async () => i);
    }
    const after = _cacheSize();

    /* 900 distinct keys written. Without a cap the map holds all of them plus
       whatever was already there - that is the leak this closes. */
    assert.ok(after <= 500,
      `store grew to ${after} entries after 900 distinct keys (was ${before}); the cap is not holding`);
  });

  await t.test('a hot key survives a flood of cold ones', async () => {
    const hot = key('hot');
    let hotFetches = 0;
    const get = () => cached(hot, 600_000, async () => { hotFetches++; return 'hot'; });

    await get();
    assert.equal(hotFetches, 1);

    /* Enough cold keys to evict everything, TOUCHING the hot key as we go - the
       access pattern of a real cache, where one entry is read constantly and the
       rest are one-offs. Oldest-inserted eviction drops `hot` here; LRU keeps it. */
    for (let i = 0; i < 700; i++) {
      await cached(`${key('cold')}:${i}`, 60_000, async () => i);
      if (i % 50 === 0) await get();
    }

    await get();
    assert.equal(hotFetches, 1,
      `the hot key was evicted and refetched ${hotFetches} times; eviction is not LRU`);
  });
});

test('the cap does not break what the cache is for', async (t) => {
  await t.test('single-flight still collapses concurrent callers', async () => {
    const k = key('flight');
    let calls = 0;
    const slow = async () => { calls++; await sleep(40); return 'v'; };

    await Promise.all(Array.from({ length: 20 }, () => cached(k, 5_000, slow)));
    assert.equal(calls, 1, `${calls} upstream calls; the cap disturbed inflight`);
  });

  await t.test('a rejected fetcher still does not wedge the key', async () => {
    const k = key('reject');
    let calls = 0;
    const flaky = async () => {
      calls++;
      await sleep(10);
      if (calls === 1) throw new Error('upstream down');
      return 'recovered';
    };

    await assert.rejects(() => cached(k, 5_000, flaky), /upstream down/);
    assert.equal(await cached(k, 5_000, flaky), 'recovered',
      'the failed promise was left in inflight');
  });

  await t.test('cachedStale still serves the last good value when the refresh fails', async () => {
    const k = key('stale');
    let calls = 0;
    const fn = async () => {
      calls++;
      await sleep(10);
      if (calls > 1) throw new Error('upstream down');
      return 'good';
    };

    assert.equal((await cachedStale(k, 50, fn)).data, 'good');
    await sleep(80);

    const second = await cachedStale(k, 50, fn);
    assert.equal(second.data, 'good', 'the stale fallback was lost');
    assert.equal(second.stale, true);
  });

  await t.test('a stale entry survives a flood, because serving it counts as a read', async () => {
    const k = key('stale-hot');
    let calls = 0;
    const fn = async () => {
      calls++;
      await sleep(5);
      if (calls > 1) throw new Error('still down');
      return 'lastGood';
    };

    await cachedStale(k, 30, fn);      // seed
    await sleep(50);                    // let it go stale
    assert.equal((await cachedStale(k, 30, fn)).stale, true);

    /* The upstream is down and this entry is the only thing standing between the
       user and an error. It must not be evicted by unrelated traffic. */
    for (let i = 0; i < 700; i++) {
      await cached(`${key('noise')}:${i}`, 60_000, async () => i);
      if (i % 100 === 0) await cachedStale(k, 30, fn).catch(() => {});
    }

    const after = await cachedStale(k, 30, fn);
    assert.equal(after.data, 'lastGood',
      'the stale entry was evicted, so a dead upstream now reaches the user');
  });
});
