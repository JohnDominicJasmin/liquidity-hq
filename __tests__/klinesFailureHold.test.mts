/* /api/market/klines holds a refused exchange answer for 30 seconds, per cache key (#1404, PR #1515; keys
 * corrected in #1523).
 *
 * THE BUG. `cached()` stores only successes. While Binance refused this server (it has banned the qa and staging
 * addresses with a 418 on exactly this route before), every candle request that did not overlap another one asked
 * the exchange AGAIN: more traffic at the host that is refusing, for as long as it refuses. The fix gives both the
 * main exchange call and the Bybit stand-in `{ failTtlMs: 30_000 }`, so a refusing exchange gets at most one request
 * per key per 30 seconds, however many visitors ask.
 *
 * WHAT RUNS: the REAL route handler, called with real NextRequests. Only the network is a stand-in: `globalThis.fetch`
 * answers api.binance.com and api.bybit.com from a per-host mode and counts every call; the clock is Node's mocked
 * Date so "inside the hold" and "30 s later" are exact. Same pattern as macroForexUpstreamCount.test.mts. Every test
 * uses its own symbol/interval/limit combination, so the module-level cache and failure memory of one test cannot
 * answer for another.
 *
 * #1523 PUT `:closed` ON BOTH KEYS. The stand-in's key once had no closed tag, so a closed=1 request and a live one
 * shared one entry. K5 pins that the two are held and cached apart on the main call AND the stand-in.
 *
 * WHAT IS NOT PINNED: range requests (start/end) skip the cache by design and are asserted only as "still call the
 * exchange every time" (K7), which is the documented behaviour, not a goal.
 *
 * MUTATIONS (each must turn the named tests red; recorded in the commit):
 *   M1 main call loses failTtlMs                     -> K1, K2, K3, K4, K5
 *   M2 Bybit stand-in loses failTtlMs                -> K1, K3 (stand-in count)
 *   M3 KLINES_FAIL_TTL_MS 30_000 -> 60_000           -> K1, K3, K6
 *   M4 stand-in key loses ${closedTag}               -> K5
 *   M5 main key loses ${closedTag}                   -> K5
 *   M6 held error loses its status (status dropped)  -> K4 */
import test, { after, afterEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');

mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 1, 0, 0, 0) });
const tick = (ms: number) => mock.timers.tick(ms);

/* ── the stand-in network ─────────────────────────────────────────────── */

type Mode = 'ok' | number | 'empty';
const net = {
  binance: 0,
  bybit: 0,
  binanceMode: 'ok' as Mode,
  bybitMode: 'ok' as Mode,
  unexpected: [] as string[],
};
const BINANCE_BODY = Array.from({ length: 5 }, (_, i) => [1_700_000_000_000 + i * 60_000, '100', '101', '99', '100.5', '10']);
const BYBIT_BODY = { retCode: 0, result: { list: Array.from({ length: 5 }, (_, i) => [String(1_700_000_000_000 + (4 - i) * 60_000), '100', '101', '99', '100.5', '10']) } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  await new Promise((r) => setImmediate(r));
  const answer = (mode: Mode, okBody: unknown, emptyBody: unknown) =>
    mode === 'ok' ? Response.json(okBody)
    : mode === 'empty' ? Response.json(emptyBody)
    : new Response('refused', { status: mode });
  if (url.host === 'api.binance.com' || url.host === 'fapi.binance.com') { net.binance++; return answer(net.binanceMode, BINANCE_BODY, []); }
  if (url.host === 'api.bybit.com') { net.bybit++; return answer(net.bybitMode, BYBIT_BODY, { retCode: 0, result: { list: [] } }); }
  net.unexpected.push(url.host);
  return new Response('[]', { status: 200 });
}) as typeof fetch;

const { GET } = await import('../app/api/market/klines/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
// #1649: a 418 now also opens lib/exchangeGuard.ts's breaker for 10 minutes. Each test here pins the klines cache HOLD, so each starts closed.
const { _resetExchangeGuard } = await import('../lib/exchangeGuard.ts');

let ip = 0;
const call = async (qs: string) => {
  const r = await GET(new NextRequest(`https://qa.invalid/api/market/klines?${qs}`, { headers: { 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}` } }));
  let body: unknown = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, source: r.headers.get('X-Data-Source'), body };
};
function world(b: Mode, y: Mode) { net.binance = 0; net.bybit = 0; net.binanceMode = b; net.bybitMode = y; }

afterEach(() => { _resetApiHealthQueue(); _resetExchangeGuard(); });
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

/* ── the tests ────────────────────────────────────────────────────────── */

test('CONTROL. an exchange that answers is called once and then served from the cache, and the stand-in counts calls', async () => {
  world('ok', 'ok');
  const a = await call('source=binance&symbol=BTCUSDT&interval=15m&limit=5');
  const b = await call('source=binance&symbol=BTCUSDT&interval=15m&limit=5');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(net.binance, 1, `CONTROL: two healthy requests made ${net.binance} Binance calls - the success cache is not working, so the hold counts below prove nothing`);
  assert.equal(net.bybit, 0);
  assert.deepEqual(net.unexpected, []);
  tick(61_000);
});

test('K1. both exchanges refusing: N requests inside 30 s make ONE call to Binance and ONE to the Bybit stand-in, every one answers 502', async () => {
  tick(61_000);
  world(500, 500);
  const results = [await call('source=binance&symbol=ETHUSDT&interval=5m&limit=100')];
  for (const at of [5_000, 10_000, 10_000, 4_900]) { tick(at); results.push(await call('source=binance&symbol=ETHUSDT&interval=5m&limit=100')); }
  assert.equal(net.binance, 1, `a refusing Binance got ${net.binance} calls in 29.9 s for one key - the main call's hold is gone`);
  assert.equal(net.bybit, 1, `a refusing Bybit got ${net.bybit} stand-in calls in 29.9 s for one key - the stand-in has no hold, so every visitor asks Bybit again`);
  for (const r of results) assert.equal(r.status, 502, 'a held refusal must still answer 502, not an empty candle list');
  tick(100); // 30.0 s after the failure: the hold has ended
  await call('source=binance&symbol=ETHUSDT&interval=5m&limit=100');
  assert.equal(net.binance, 2, 'the first request after 30 s must try Binance again');
  assert.equal(net.bybit, 2, 'and the stand-in too');
});

test('K2. a banned Binance key goes straight to Bybit: Binance is asked once per 30 s, the stand-in answers from its own cache', async () => {
  tick(61_000);
  world(418, 'ok');
  const first = await call('source=binance&symbol=SOLUSDT&interval=5m&limit=100');
  assert.equal(first.status, 200);
  assert.equal(first.source, 'bybit-fallback', 'the first request must be served by the stand-in');
  const later = [];
  for (const at of [5_000, 10_000, 10_000]) { tick(at); later.push(await call('source=binance&symbol=SOLUSDT&interval=5m&limit=100')); }
  for (const r of later) {
    assert.equal(r.status, 200);
    assert.equal(r.source, 'bybit-fallback', 'a held Binance error must still fail over to the stand-in');
  }
  assert.equal(net.binance, 1, `Binance answered 418 and was then asked ${net.binance - 1} more time(s) inside the hold`);
  assert.equal(net.bybit, 1, `the stand-in's own cache should answer while its entry is fresh; Bybit got ${net.bybit} calls`);
});

test('K3. the hold ends at 30 s, not before and not after: held at 29.9 s, retried at 30.0 s', async () => {
  tick(61_000);
  world(500, 'empty');
  const qs = 'source=binance&symbol=XRPUSDT&interval=1m&limit=100';
  await call(qs);
  assert.equal(net.binance, 1);
  tick(29_900); await call(qs);
  assert.equal(net.binance, 1, 'at 29.9 s the failure must still be held');
  tick(200); await call(qs);
  assert.equal(net.binance, 2, 'past 30 s the next request must go to Binance again');
  assert.equal(net.bybit, 2, 'an empty Bybit list is a failure and is held the same way: asked again only after 30 s');
});

test('K4. a held error keeps its HTTP status: with no stand-in available, the second request still names the 418', async () => {
  tick(61_000);
  world(418, 'ok');
  // 8h has no Bybit equivalent, so the original error is the answer.
  const qs = 'source=binance&symbol=BTCUSDT&interval=8h&limit=100';
  const first = await call(qs);
  const second = await call(qs);
  assert.equal(net.binance, 1, 'the second request must be answered from the hold, not a new call');
  assert.equal(net.bybit, 0, 'no Bybit mapping for 8h: the stand-in must not be tried');
  for (const r of [first, second]) {
    assert.equal(r.status, 502);
    assert.match(JSON.stringify(r.body), /rate-limiting this server \(418\)/, 'the 418 must survive the hold; losing it turns a ban into a plain "Upstream unavailable"');
  }
});

test('K5. closed=1 and live requests are held and cached APART, on the main call and on the stand-in (#1523 key tag)', async () => {
  tick(61_000);
  // #1649: a plain refusal (500), not a 418: a 418 would now open the exchange breaker, and the closed=1 call would (rightly) not reach
  // Binance at all - this test is about the cache keys, not the ban.
  world(500, 'ok');
  const live = 'source=binance&symbol=BNBUSDT&interval=5m&limit=100';
  const closed = live + '&closed=1';
  await call(live);
  assert.deepEqual([net.binance, net.bybit], [1, 1]);
  await call(closed);
  assert.deepEqual([net.binance, net.bybit], [2, 2], `a closed=1 request shared the live request's entry: Binance ${net.binance}, stand-in ${net.bybit} (want 2 and 2). Main key and stand-in key must each carry the :closed tag`);
  await call(live); await call(closed);
  assert.deepEqual([net.binance, net.bybit], [2, 2], 'repeating both inside the hold must add no calls');
});

test('K6. a failure is never held longer than the shortest success TTL (30 s): the constant and ttlFor agree', () => {
  const src = read('app/api/market/klines/route.ts');
  const fail = src.match(/const KLINES_FAIL_TTL_MS = ([0-9_]+);/);
  assert.ok(fail, 'CONTROL: KLINES_FAIL_TTL_MS is not declared as a plain number in the route any more - re-derive this test');
  const body = src.match(/function ttlFor\(interval: string\): number \{([\s\S]*?)\n\}/);
  assert.ok(body, 'CONTROL: ttlFor moved or changed shape - re-derive this test');
  const ttls = [...body[1].matchAll(/return ([0-9_]+);/g)].map((m) => Number(m[1].replace(/_/g, '')));
  assert.ok(ttls.length >= 3, `CONTROL: expected several TTL returns in ttlFor, found ${ttls.length}`);
  const min = Math.min(...ttls);
  assert.equal(min, 30_000, 'the shortest success TTL is no longer 30 s - re-decide the hold');
  assert.equal(Number(fail[1].replace(/_/g, '')), 30_000);
  assert.ok(Number(fail[1].replace(/_/g, '')) <= min, 'a failure would be held longer than the shortest success is cached');
});

test('K7. range requests are cached and held per WINDOW since #1649 (H3): the same window asks once, another window is its own entry', async () => {
  tick(61_000);
  world(500, 500);
  const qs = 'source=binance&symbol=BTCUSDT&interval=1h&limit=100&start=1700000000000&end=1700003600000';
  await call(qs); await call(qs); await call(qs);
  assert.equal(net.binance, 1, 'the same window inside the hold must be answered from it, not by three exchange calls');
  await call(qs.replace('start=1700000000000', 'start=1699996400000'));
  assert.equal(net.binance, 2, 'a paginated backfill must not be answered from a held failure of a DIFFERENT window');
  assert.equal(net.bybit, 0, 'range requests never fail over (no splicing)');
});

test('every call in this file went to Binance or Bybit and nowhere else', () => {
  assert.deepEqual(net.unexpected, []);
});
