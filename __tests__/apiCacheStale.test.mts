import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedStale } from '../lib/apiCache.ts';

/* cachedStale exists so /api/ath keeps answering when CoinGecko rate-limits the
   server's IP. The interesting behaviour is all in the failure path, which is
   exactly the path that never runs in normal development. */
test('cachedStale', async (t) => {
  let n = 0;
  const uniqueKey = () => `k${++n}`;

  await t.test('first call fetches and is not stale', async () => {
    const r = await cachedStale(uniqueKey(), 60_000, async () => 'fresh');
    assert.equal(r.data, 'fresh');
    assert.equal(r.stale, false);
    assert.equal(r.ageMs, 0);
  });

  await t.test('second call inside the TTL does not re-fetch', async () => {
    const k = uniqueKey();
    let calls = 0;
    const f = async () => { calls++; return 'v'; };
    await cachedStale(k, 60_000, f);
    const r = await cachedStale(k, 60_000, f);
    assert.equal(calls, 1, 'fetcher should not run again inside the TTL');
    assert.equal(r.stale, false);
  });

  await t.test('serves the last good value when the fetcher throws', async () => {
    const k = uniqueKey();
    await cachedStale(k, 0, async () => 'good');
    // ttl 0 forces a re-fetch, and this one fails - the CoinGecko 429 case.
    const r = await cachedStale(k, 0, async () => { throw new Error('CoinGecko 429'); });
    assert.equal(r.data, 'good', 'must fall back rather than propagate');
    assert.equal(r.stale, true);
  });

  await t.test('throws when it fails with nothing cached', async () => {
    /* Cold start plus a failing upstream is a real failure - there is no
       previous answer to serve, so the route has to return an error rather
       than invent one. */
    await assert.rejects(
      () => cachedStale(uniqueKey(), 60_000, async () => { throw new Error('boom'); }),
      /boom/,
    );
  });

  await t.test('does not settle into serving stale forever', async () => {
    /* A failure must not refresh the timestamp. If it did, one outage would
       pin the stale value for a full TTL and recovery would be delayed long
       after the upstream came back. */
    const k = uniqueKey();
    await cachedStale(k, 0, async () => 'v1');
    await cachedStale(k, 0, async () => { throw new Error('down'); });
    const r = await cachedStale(k, 0, async () => 'v2');
    assert.equal(r.data, 'v2', 'should retry and pick up the recovery immediately');
    assert.equal(r.stale, false);
  });

  await t.test('a successful fetch after a failure replaces the stale value', async () => {
    const k = uniqueKey();
    await cachedStale(k, 0, async () => 'old');
    await cachedStale(k, 0, async () => { throw new Error('down'); });
    await cachedStale(k, 0, async () => 'new');
    const r = await cachedStale(k, 60_000, async () => { throw new Error('should not run'); });
    assert.equal(r.data, 'new');
    assert.equal(r.stale, false);
  });
});
