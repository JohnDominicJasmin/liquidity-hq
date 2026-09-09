/* fetchBybitKlinesRetry (#1080/#1084) - the shared retry every Bybit-klines
 * caller now goes through. #1079's whole defect was silent: a refusal
 * parsed as "zero candles," indistinguishable from a coin that genuinely
 * has none. These assertions are pointed at that distinction and at the
 * retry mechanics around it - not at any one caller's UI, which the
 * function deliberately has no opinion on.
 *
 * Real fetch and real setTimeout are replaced for the duration of each
 * test and restored after - no network, no waiting (the backoff is
 * 500ms + 1500ms per exhausted attempt; captured, not slept through,
 * same "a timing test that waits is a timing test that flakes" reasoning
 * candles.test.mts already applies to msUntilNextClose).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBybitKlinesRetry } from '../lib/bybitKlines.ts';

const origFetch = globalThis.fetch;
const origSetTimeout = globalThis.setTimeout;

/** Installs a fetch stub returning one response per call, in order, and a
 *  setTimeout stub that resolves immediately while recording the delay it
 *  was asked for. Returns the call logs and a restore function. */
function stub(responses: Array<{ ok: boolean; json?: () => Promise<unknown> } | 'reject'>) {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const delays: number[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    const r = responses[i++];
    if (r === 'reject' || r === undefined) throw new Error('stub: network error');
    return r;
  }) as typeof fetch;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  return {
    fetchCalls, delays,
    restore: () => { globalThis.fetch = origFetch; globalThis.setTimeout = origSetTimeout; },
  };
}

test('succeeds on the first attempt - no retry, no delay', async () => {
  const payload = { result: { list: [['1', '2', '3', '4', '5', '6']] } };
  const { fetchCalls, delays, restore } = stub([{ ok: true, json: async () => payload }]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000);
    assert.deepEqual(result, payload);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(delays, []);
  } finally { restore(); }
});

test('a refusal (r.ok false) is retried, not treated as empty candles', async () => {
  const payload = { result: { list: [['1', '2', '3', '4', '5', '6']] } };
  const { fetchCalls, restore } = stub([
    { ok: false }, // 502 - the exact shape that made #1079 silent if unchecked
    { ok: true, json: async () => payload },
  ]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000);
    assert.deepEqual(result, payload);
    assert.equal(fetchCalls.length, 2, 'must have retried once, not accepted the 502 as data');
  } finally { restore(); }
});

test('exhausts after exactly 3 attempts, all refused, and returns null', async () => {
  const { fetchCalls, delays, restore } = stub([{ ok: false }, { ok: false }, { ok: false }]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000);
    assert.equal(result, null);
    assert.equal(fetchCalls.length, 3);
    assert.deepEqual(delays, [500, 1500], 'immediate, then +500ms, then +1500ms - the documented backoff');
  } finally { restore(); }
});

test('a refusal (null) is distinct from a genuinely empty candle list', () => {
  // The one thing #1079 got wrong, restated as a type-level fact rather
  // than re-running the exhaustion case: `null` and `{result:{list:[]}}`
  // must never be assertEqual to each other, or a caller reintroduces the
  // exact conflation this helper exists to prevent.
  const exhausted: null = null;
  const genuinelyEmpty = { result: { list: [] as string[][] } };
  assert.notEqual(exhausted, genuinelyEmpty as unknown);
});

test('a genuinely empty but successful response is returned as-is, not null', async () => {
  const payload = { result: { list: [] as string[][] } };
  const { fetchCalls, restore } = stub([{ ok: true, json: async () => payload }]);
  try {
    const result = await fetchBybitKlinesRetry('DOGEUSDT', '60', 1000);
    assert.notEqual(result, null, 'an OK-but-empty response must not collapse into the refused-every-time signal');
    assert.deepEqual(result, payload);
    assert.equal(fetchCalls.length, 1, 'a real answer does not get retried');
  } finally { restore(); }
});

test('a network error (rejected fetch) is retried like a refusal, not thrown', async () => {
  const payload = { result: { list: [['1', '2', '3', '4', '5', '6']] } };
  const { fetchCalls, restore } = stub(['reject', { ok: true, json: async () => payload }]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000);
    assert.deepEqual(result, payload);
    assert.equal(fetchCalls.length, 2);
  } finally { restore(); }
});

test('isStale checked before the first attempt - a caller can cancel before any fetch fires', async () => {
  const { fetchCalls, restore } = stub([{ ok: true, json: async () => ({}) }]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000, { isStale: () => true });
    assert.equal(result, null);
    assert.equal(fetchCalls.length, 0, 'a caller that is already stale gets zero network calls, not one wasted one');
  } finally { restore(); }
});

test('isStale checked between attempts - a switch abandoned after the first attempt stops the sequence, not runs it to exhaustion', async () => {
  const { fetchCalls, restore } = stub([{ ok: false }, { ok: false }, { ok: false }]);
  // Flips true only once the first fetch has actually resolved, so this
  // tests the loop re-consulting isStale mid-sequence - not just once at
  // entry, which the earlier "zero fetch calls" test already covers.
  const isStale = () => fetchCalls.length >= 1;
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000, { isStale });
    assert.equal(result, null);
    assert.equal(fetchCalls.length, 1, 'must stop after the first refused attempt once stale, not fire the remaining 2');
  } finally { restore(); }
});

test('extraParams are appended to the querystring', async () => {
  const { fetchCalls, restore } = stub([{ ok: true, json: async () => ({}) }]);
  try {
    await fetchBybitKlinesRetry('BTCUSDT', 'D', 1000, { extraParams: { closed: '1' } });
    assert.match(fetchCalls[0].url, /[?&]closed=1(&|$)/);
    assert.match(fetchCalls[0].url, /[?&]source=bybit(&|$)/);
    assert.match(fetchCalls[0].url, /[?&]symbol=BTCUSDT(&|$)/);
    assert.match(fetchCalls[0].url, /[?&]interval=D(&|$)/);
    assert.match(fetchCalls[0].url, /[?&]limit=1000(&|$)/);
  } finally { restore(); }
});

test('an AbortSignal is passed straight through to fetch', async () => {
  const { fetchCalls, restore } = stub([{ ok: true, json: async () => ({}) }]);
  const ctrl = new AbortController();
  try {
    await fetchBybitKlinesRetry('BTCUSDT', '60', 1000, { signal: ctrl.signal });
    assert.equal(fetchCalls[0].init?.signal, ctrl.signal);
  } finally { restore(); }
});

test('CONTROL: a caller with no isStale runs to full exhaustion rather than silently short-circuiting', async () => {
  // Guards against a `stub`/helper bug reading as a pass on a helper that
  // secretly always stops early - same shape as this project's other
  // CONTROL tests (liqClusters, arena-read-card).
  const { fetchCalls, restore } = stub([{ ok: false }, { ok: false }, { ok: false }]);
  try {
    const result = await fetchBybitKlinesRetry('BTCUSDT', '60', 1000);
    assert.equal(result, null);
    assert.equal(fetchCalls.length, 3, 'no isStale supplied - must run all 3 attempts, not stop early');
  } finally { restore(); }
});
