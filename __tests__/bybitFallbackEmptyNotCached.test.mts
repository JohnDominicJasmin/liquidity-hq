/* #1249/#1250: the klines route's Bybit fallback must not memoize an empty
 * result.list as a success - cached() only skips a REJECTION, so a
 * resolved-but-empty body gets pinned for the full TTL otherwise.
 *
 * LIMITATION, stated rather than hidden: the check under test lives inline in
 * app/api/market/klines/route.ts's GET handler, not in an extracted lib/
 * function. That file imports `next/server` and `@/lib/...` aliases neither
 * of which `node --test` (this project's runner - see package.json) can
 * resolve, so the route itself cannot be imported here (confirmed: it throws
 * ERR_MODULE_NOT_FOUND on `next/server`). lib/klinesFailover.ts's own header
 * documents exactly this constraint - "extracted so QA can test it without a
 * live upstream" (#1223) - the empty-list check in #1250 was not extracted,
 * so this test exercises a faithful copy of that check (identical condition,
 * identical error) against the REAL `cached()` from lib/apiCache.ts, rather
 * than the literal route code. It proves the INVARIANT `cached()` relies on;
 * it would not catch a typo in route.ts's own copy of the condition. Flagged
 * to Dev on #1250 as a candidate for the same extraction treatment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cached } from '../lib/apiCache.ts';

/** Exact mirror of the check added in app/api/market/klines/route.ts's
 *  fallbackFetch: an empty or missing result.list throws instead of
 *  resolving, so cached() never memoizes it. */
function bybitFallbackFetch(stub: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
  return async () => {
    const r = await stub();
    if (!r.ok) {
      const err = new Error('bybit fallback klines failed');
      (err as Error & { status?: number }).status = 502;
      throw err;
    }
    const body = await r.json() as { result?: { list?: unknown[] } };
    if (!Array.isArray(body?.result?.list) || body.result.list.length === 0) {
      const err = new Error('bybit fallback klines returned no candles');
      (err as Error & { status?: number }).status = 502;
      throw err;
    }
    return body;
  };
}

let n = 0;
const key = () => `test:bybit-fallback:${++n}`;

test('an empty result.list rejects and is not cached', async () => {
  const k = key();
  let calls = 0;
  const fetcher = bybitFallbackFetch(async () => {
    calls++;
    return { ok: true, json: async () => ({ result: { list: [] } }) };
  });

  await assert.rejects(() => cached(k, 5_000, fetcher), /no candles/);
  assert.equal(calls, 1);
});

test('the empty response above is retried, not served stale, by the very next caller', async () => {
  const k = key();
  let calls = 0;
  const realPayload = { result: { list: [['1', '2', '3', '4', '5', '6']] } };
  const fetcher = bybitFallbackFetch(async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ result: { list: [] } }) };
    return { ok: true, json: async () => realPayload };
  });

  await assert.rejects(() => cached(k, 5_000, fetcher), /no candles/);
  const second = await cached(k, 5_000, fetcher);
  assert.deepEqual(second, realPayload);
  assert.equal(calls, 2, 'the empty first response must not have been memoized - the whole point of #1250');
});

test('a missing result.list (not just an empty array) also rejects', async () => {
  const k = key();
  const fetcher = bybitFallbackFetch(async () => ({ ok: true, json: async () => ({ retCode: 10001 }) }));
  await assert.rejects(() => cached(k, 5_000, fetcher), /no candles/);
});

test('CONTROL: a non-empty result.list is cached normally, not retried every time', async () => {
  const k = key();
  let calls = 0;
  const realPayload = { result: { list: [['1', '2', '3', '4', '5', '6']] } };
  const fetcher = bybitFallbackFetch(async () => { calls++; return { ok: true, json: async () => realPayload }; });

  const first = await cached(k, 5_000, fetcher);
  const second = await cached(k, 5_000, fetcher);
  assert.deepEqual(first, realPayload);
  assert.deepEqual(second, realPayload);
  assert.equal(calls, 1, 'a real answer must be served from cache on the second call, not refetched');
});
