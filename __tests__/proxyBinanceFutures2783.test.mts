/* QA: PR #2783 (#1651), /api/proxy?type=binance-futures-24hr answers its LAST GOOD body, up to 60 minutes old (PM raised it from 10, 2026-11-23), when Binance refuses (429, 500, network), instead of a 502.
 * THE WRITTEN RULES (Dev's list on the PR):
 *   B1 a good read, then upstream 429 after the 30 s TTL: 200, the FIRST body, `x-data-stale: 1`, `x-data-age-ms` the real age, no cache-control
 *   B2 the bound: 60 minutes minus 1 ms is served stale; 60 minutes (and later) is the 502 as before
 *   B3 a 429 with no earlier read is the 502 as before (nothing of Binance's is passed through)
 *   B4 a DIFFERENT symbols list is not served the first list's body (its own last good, here none -> 502)
 *   B5 the healthy path is unchanged: 200, the live body, no stale header
 *   B6 recovery: a live answer after a stale one carries no stale header again
 *   B8 AFTER A 429 THE EXCHANGE BREAKER (lib/exchangeGuard.ts, 10 minutes minimum) keeps the route off Binance: the stale body answers without a new upstream call, and the stale bound is now 60 minutes, longer than the breaker's 10 minute minimum, so the stale body bridges the first ban and is replaced by live data when the breaker closes
 *   B7 the open-interest-1 type (no serveStaleMs) stays live-or-error: a failing upstream after a good read is a 502, never a stale body (the P4 rule of routeLastGood2740)
 * THE REAL ROUTE HANDLER RUNS HERE (`GET` of app/api/proxy/route.ts, real NextRequests, mocked clock); only the network is a stand-in. */
import test, { after, afterEach, beforeEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
mock.timers.enable({ apis: ['Date'], now: T0 });
const tick = (ms: number) => mock.timers.tick(ms);
const MIN = 60_000, TTL = 30_000;

type Mode = 'ok' | '429' | '500' | 'network';
const net = { mode: 'ok' as Mode, calls: 0, version: 1, oiMode: 'ok' as Mode, stray: [] as string[] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tickerBody = (symbols: string[], v: number) => symbols.map((s) => ({ symbol: s, lastPrice: String(100 * v), priceChangePercent: String(v), volume: '1', quoteVolume: '1' }));
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/24hr') {
    net.calls++;
    if (net.mode === 'network') throw new TypeError('fetch failed');
    if (net.mode === '429') return json(429, { code: -1003, msg: 'Too many requests' });
    if (net.mode === '500') return new Response('down', { status: 500 });
    const list = JSON.parse(url.searchParams.get('symbols') ?? '[]') as string[];
    return json(200, tickerBody(list, net.version));
  }
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/open-interest') {
    if (net.oiMode === 'network') throw new TypeError('fetch failed');
    if (net.oiMode === '500') return new Response('down', { status: 500 });
    return json(200, { retCode: 0, result: { list: [{ openInterest: `100${net.version}`, timestamp: '1800000000000' }] } });
  }
  net.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });
const standIn = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standIn, 'the fetch stand-in is not installed: this run would reach the real network'); });
mock.method(console, 'error', () => {}); mock.method(console, 'warn', () => {});

const { GET } = await import('../app/api/proxy/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
const { _resetExchangeGuard } = await import('../lib/exchangeGuard.ts');
beforeEach(() => { _resetExchangeGuard(); });
afterEach(() => { _resetApiHealthQueue(); assert.deepEqual(net.stray, [], `a request went somewhere unexpected: ${net.stray.join(', ')}`); });

let ip = 0;
const call = async (path: string) => {
  const r = await GET(new NextRequest(`https://qa.invalid${path}`, { headers: { 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}` } }));
  return { status: r.status, text: await r.text(), h: (n: string) => r.headers.get(n) };
};
const A = ['COPPERUSDT', 'XPTUSDT'], B = ['XPDUSDT', 'NATGASUSDT'];
const url = (list: string[]) => `/api/proxy?type=binance-futures-24hr&symbols=${encodeURIComponent(JSON.stringify(list))}`;
const OI = '/api/proxy?type=open-interest-1&symbol=BTCUSDT&limit=1';

test('B5 HEALTHY PATH: 200 with the live body and no stale marker', async () => {
  const L = ['PAYPUSDT'];
  net.mode = 'ok'; net.version = 1; tick(MIN);
  const r = await call(url(L)); assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), tickerBody(L, 1)); assert.equal(r.h('x-data-stale'), null); assert.equal(r.h('x-data-age-ms'), null);
});

test('B1 a good read, then Binance answers 429 after the TTL: 200, the FIRST body, x-data-stale 1, x-data-age-ms the real age, not cacheable', async () => {
  const L = ['COPPERUSDT', 'XPTUSDT'];
  net.mode = 'ok'; net.version = 2; tick(MIN);
  const good = await call(url(L)); assert.equal(good.status, 200); const body = good.text;
  for (const shape of ['429', '500', 'network'] as const) {
    net.version = 9; net.mode = shape; tick(TTL + 1_000);
    const f = await call(url(L));
    assert.equal(f.status, 200, `${shape}: answered ${f.status} instead of the last good body`);
    assert.deepEqual(JSON.parse(f.text), JSON.parse(body), `${shape}: not the first body`);
    assert.equal(f.h('x-data-stale'), '1', shape); assert.ok(Number(f.h('x-data-age-ms')) >= TTL + 1_000 && Number(f.h('x-data-age-ms')) < 60 * MIN, `${shape}: age header ${f.h('x-data-age-ms')}`);
    assert.equal(f.h('cache-control'), null, `${shape}: a stale answer is cacheable`);
  }
  net.mode = 'ok';
});

test('B2 THE BOUND: 60 minutes minus 1 ms is served stale, 60 minutes is the 502', async () => {
  const L = ['OURAUSDT'];
  net.mode = 'ok'; net.version = 3; tick(90 * MIN);
  const good = await call(url(L)); assert.equal(good.status, 200);
  net.mode = '429'; tick(60 * MIN - 1);
  const edge = await call(url(L)); assert.equal(edge.status, 200, 'just inside the bound'); assert.equal(edge.h('x-data-stale'), '1'); assert.equal(edge.h('x-data-age-ms'), String(60 * MIN - 1));
  tick(1);
  const past = await call(url(L)); assert.equal(past.status, 502, 'at the bound the answer is the 502 as before'); assert.equal(past.h('x-data-stale'), null);
  assert.match(past.text, /429|upstream|unavailable/i, 'the 502 names the failure');
  net.mode = 'ok';
});

test('B3 a 429 with no earlier read for that list is the 502 as before, nothing of Binance\'s passed through', async () => {
  net.mode = '429'; tick(30 * MIN);
  const r = await call(url(['XAUUSDT'])); assert.equal(r.status, 502); assert.equal(r.h('x-data-stale'), null);
  assert.ok(!/Too many requests|-1003/.test(r.text), 'Binance\'s own body leaked through the 502');
  net.mode = 'ok';
});

test('B4 a DIFFERENT symbols list is not served the first list\'s body', async () => {
  const A4 = ['XPDUSDT', 'NATGASUSDT'], B4 = ['HK0700USDT', 'MOONSHOTUSDT'];
  net.mode = 'ok'; net.version = 4; tick(30 * MIN);
  const a = await call(url(A4)); assert.equal(a.status, 200);
  net.mode = '429'; tick(TTL + 1_000);
  const stale = await call(url(A4)); assert.equal(stale.status, 200); assert.equal(stale.h('x-data-stale'), '1');
  const other = await call(url(B4)); assert.equal(other.status, 502, `list B was answered ${other.status} (a body for list A?)`);
  assert.ok(!other.text.includes('XPDUSDT') && !other.text.includes('NATGASUSDT'), 'list A\'s symbols appear in the answer for list B');
  net.mode = 'ok';
});

test('B6 recovery: a live answer after a stale one carries no stale header', async () => {
  const L = ['STRCUSDT'];
  net.mode = 'ok'; net.version = 5; tick(30 * MIN);
  await call(url(L)); net.mode = '429'; tick(TTL + 1_000);
  const stale = await call(url(L)); assert.equal(stale.h('x-data-stale'), '1');
  net.mode = 'ok'; net.version = 6; tick(11 * MIN);   // past the breaker's 10 minute minimum
  const live = await call(url(L)); assert.equal(live.status, 200); assert.equal(live.h('x-data-stale'), null); assert.equal(live.h('x-data-age-ms'), null);
  assert.deepEqual(JSON.parse(live.text), tickerBody(L, 6), 'the live body is not the cached one');
});

test('B7 open-interest-1 (no serveStaleMs) stays live-or-error: a failing upstream after a good read is a 502, never a stale body', async () => {
  net.oiMode = 'ok'; net.version = 7; tick(30 * MIN);
  const good = await call(OI); assert.equal(good.status, 200, 'the good read');
  net.oiMode = '500'; tick(10 * MIN);
  const f = await call(OI); assert.equal(f.status, 502, `answered ${f.status}`); assert.equal(f.h('x-data-stale'), null);
  net.oiMode = 'ok';
});

test('B8 after a 429 the breaker keeps the route off Binance: the stale body answers with NO new upstream call, and when the breaker closes (10 minutes) the answer is live again', async () => {
  const L = ['HK0700USDT']; net.mode = 'ok'; net.version = 8; tick(30 * MIN);
  await call(url(L)); net.mode = '429'; tick(TTL + 1_000);
  const first = await call(url(L)); assert.equal(first.status, 200); assert.equal(first.h('x-data-stale'), '1');
  const callsAfterFirst = net.calls;
  net.mode = 'ok'; tick(2 * MIN);                                   // Binance is healthy again, the breaker is not
  const held = await call(url(L)); assert.equal(held.status, 200); assert.equal(held.h('x-data-stale'), '1', 'the breaker did not hold the route off Binance');
  assert.equal(net.calls, callsAfterFirst, 'the route called Binance while the breaker was open');
  tick(8 * MIN);                                                    // the breaker (10 min from the 429) is now over; the good body is 10 minutes old, inside the 60 minute bound
  const after = await call(url(L)); assert.ok(after.status === 200 || after.status === 502, 'unexpected status ' + after.status);
  console.log('[B8] 10 min after the 429: status ' + after.status + ', stale ' + after.h('x-data-stale') + ', upstream calls ' + net.calls);
});

test('B9 a 45 minute old last good body is still served stale once the breaker is open, with its real age', async () => {
  const L = ['MOONSHOTUSDT']; net.mode = 'ok'; net.version = 9; tick(90 * MIN);
  await call(url(L)); net.mode = '429'; tick(TTL + 1_000); await call(url(L));      // the 429 opens the breaker
  tick(45 * MIN - TTL - 1_000);
  const r = await call(url(L)); assert.equal(r.status, 200, `answered ${r.status}`); assert.equal(r.h('x-data-stale'), '1'); assert.equal(r.h('x-data-age-ms'), String(45 * MIN), 'the age header is not the real age');
});
