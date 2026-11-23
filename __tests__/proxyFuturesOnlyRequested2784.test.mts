/* QA: PR #2784 (#1651), /api/proxy?type=binance-futures-24hr answers ONLY the symbols asked for. Binance's futures ticker/24hr ignores `symbols` and answers the whole market (QA on prod 2026-11-23: 817 items, 302 KB for 16 requested symbols); the route's trim keeps the requested ones.
 * THE WRITTEN RULES (Dev's list on the PR):
 *   C1 a stubbed 817-item body with 16 requested symbols (one of them not listed by Binance) answers exactly the listed ones, in upstream order, each item byte-identical to the stub's
 *   C2 a comma list answers the same as the JSON array
 *   C3 a requested symbol Binance does not list is absent, with no error (still a 200)
 *   C4 a non-array body is untouched; an unreadable `symbols` value is untouched (trimToRequestedSymbols, called directly, because the route refuses an unreadable list with a 400 before it reaches the trim)
 *   C5 the second request is a cache hit (one upstream call) and answers the SMALL body; a failing refresh after that serves the SMALL body as the last good one (the #2783 stale path), flagged x-data-stale
 *   C6 the other trims are unchanged: bybit-tickers, deribit-book, llama-stables keep their trimmed bodies (their cells in routeLastGood2740 P1 run on the same code)
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

mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 23, 14, 0, 0) });
const tick = (ms: number) => mock.timers.tick(ms);
const MIN = 60_000, TTL = 30_000;

const REQ = ['ANTHROPICUSDT', 'COPPERUSDT', 'DISUSDT', 'FRHCUSDT', 'HK0625USDT', 'HK0700USDT', 'HK0992USDT', 'HK1810USDT', 'MOONSHOTUSDT', 'NATGASUSDT', 'OPENAIUSDT', 'OURAUSDT', 'PAYPUSDT', 'STRCUSDT', 'XPDUSDT', 'XPTUSDT'];
const NOT_LISTED = 'DISUSDT';
/* the whole market: 801 filler symbols and the 15 listed requested ones, interleaved, each item with extra fields so "byte-identical" means something */
const item = (symbol: string, i: number) => ({ symbol, priceChange: `${i}.5`, priceChangePercent: `${(i % 9) + 0.25}`, weightedAvgPrice: `${100 + i}`, lastPrice: `${100 + i}.125`, lastQty: '3', openPrice: `${99 + i}`, highPrice: `${101 + i}`, lowPrice: `${98 + i}`, volume: `${1000 + i}`, quoteVolume: `${50000 + i}`, openTime: 1_795_000_000_000 + i, closeTime: 1_795_086_400_000 + i, firstId: i, lastId: i + 10, count: 77 + i });
const MARKET: Array<ReturnType<typeof item>> = []; const listed = REQ.filter((s) => s !== NOT_LISTED);
for (let i = 0; i < 817; i++) MARKET.push(item(`FILL${i}USDT`, i));
/* the 15 listed requested symbols sit at known places of the upstream order */
const ORDER: string[] = []; { const pos = [40, 90, 130, 170, 215, 260, 300, 345, 390, 430, 480, 520, 560, 610, 700]; listed.forEach((s, k) => { MARKET[pos[k]] = item(s, pos[k]); ORDER.push(s); }); }
assert.equal(MARKET.length, 817);

type Mode = 'ok' | '429' | 'object';
const net = { mode: 'ok' as Mode, calls: 0, stray: [] as string[] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init); const url = new URL(req.url);
  if (url.host === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/24hr') {
    net.calls++;
    if (net.mode === '429') return json(429, { code: -1003, msg: 'Too many requests' });
    if (net.mode === 'object') return json(200, { code: 0, note: 'not an array' });
    return json(200, MARKET);                                   // symbols ignored, as Binance does
  }
  net.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });
const standIn = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standIn, 'the fetch stand-in is not installed'); });
mock.method(console, 'error', () => {}); mock.method(console, 'warn', () => {});

const { GET } = await import('../app/api/proxy/route.ts');
const { trimToRequestedSymbols } = await import('../lib/payloadTrim.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
const { _resetExchangeGuard } = await import('../lib/exchangeGuard.ts');
beforeEach(() => { _resetExchangeGuard(); });
afterEach(() => { _resetApiHealthQueue(); assert.deepEqual(net.stray, [], `a request went somewhere unexpected: ${net.stray.join(', ')}`); });

let ip = 0;
const call = async (path: string) => { const r = await GET(new NextRequest(`https://qa.invalid${path}`, { headers: { 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}` } })); return { status: r.status, text: await r.text(), h: (n: string) => r.headers.get(n) }; };
const arr = (list: string[]) => `/api/proxy?type=binance-futures-24hr&symbols=${encodeURIComponent(JSON.stringify(list))}`;
const csv = (list: string[]) => `/api/proxy?type=binance-futures-24hr&symbols=${encodeURIComponent(list.join(','))}`;
const expected = (list: string[]) => MARKET.filter((m) => list.map((s) => s.toUpperCase()).includes(m.symbol));

test('C1 an 817-item body with 16 requested symbols answers exactly the listed ones, in upstream order, each item byte-identical', async () => {
  net.mode = 'ok'; tick(MIN);
  const r = await call(arr(REQ)); assert.equal(r.status, 200);
  const got = JSON.parse(r.text) as Array<{ symbol: string }>;
  assert.equal(got.length, 15, `${got.length} items, not the 15 listed ones`);
  assert.deepEqual(got.map((g) => g.symbol), ORDER, 'not the requested symbols in upstream order');
  const want = expected(REQ); for (let i = 0; i < want.length; i++) assert.equal(JSON.stringify(got[i]), JSON.stringify(want[i]), `item ${i} (${want[i].symbol}) is not byte-identical`);
  assert.ok(r.text.length < 10_000, `the answer is still ${r.text.length} bytes`);
});

test('C2 a comma list answers the same as the JSON array', async () => {
  net.mode = 'ok'; tick(MIN);
  const a = await call(arr(REQ)); const c = await call(csv(REQ));
  assert.equal(c.status, 200); assert.equal(c.text, a.text, 'the comma list answered another body');
  const lower = await call(csv(REQ.map((s) => s.toLowerCase()).slice(0, 5))); assert.equal(lower.status, 200, 'a lower-case list is refused by the tracked-symbol check before the trim');
  assert.deepEqual((JSON.parse(lower.text) as Array<{ symbol: string }>).map((x) => x.symbol), expected(REQ.slice(0, 5)).map((x) => x.symbol), 'lower case is not matched case-insensitively');
});

test('C3 a requested symbol Binance does not list is absent, with no error', async () => {
  net.mode = 'ok'; tick(MIN);
  const r = await call(arr([NOT_LISTED, 'XPTUSDT'])); assert.equal(r.status, 200);
  assert.deepEqual((JSON.parse(r.text) as Array<{ symbol: string }>).map((x) => x.symbol), ['XPTUSDT']);
  const only = await call(arr([NOT_LISTED])); assert.equal(only.status, 200); assert.equal(only.text, '[]', 'a list of unlisted symbols is not an empty array');
});

test('C4 a non-array body is untouched, and an unreadable symbols value is untouched (the trim, called directly)', async () => {
  net.mode = 'object'; tick(MIN);
  const r = await call(arr(['XPTUSDT'])); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.text), { code: 0, note: 'not an array' }, 'a non-array body was changed');
  net.mode = 'ok';
  const body = [{ symbol: 'A' }, { symbol: 'B' }];
  assert.equal(trimToRequestedSymbols(body, new URLSearchParams('symbols=%5Bnot-json')), body, 'an unreadable JSON list changed the body');
  assert.equal(trimToRequestedSymbols(body, new URLSearchParams('')), body, 'a missing symbols value changed the body');
  assert.equal(trimToRequestedSymbols(body, new URLSearchParams('symbols=%5B1%2C2%5D')), body, 'a non-string list changed the body');
  assert.deepEqual(trimToRequestedSymbols(body, new URLSearchParams('symbols=a%2CB')), [{ symbol: 'A' }, { symbol: 'B' }].filter((x) => ['A', 'B'].includes(x.symbol)), 'case-insensitive comma list');
  assert.equal(trimToRequestedSymbols({ a: 1 }, new URLSearchParams('symbols=A')) !== undefined, true);
});

test('C5 the second request is a cache hit with the SMALL body; a failing refresh serves the SMALL body stale', async () => {
  net.mode = 'ok'; tick(30 * MIN); const before = net.calls; const L = ['COPPERUSDT', 'OURAUSDT', 'STRCUSDT'];
  const first = await call(arr(L)); const second = await call(arr(L));
  assert.equal(net.calls - before, 1, 'the second request went upstream again'); assert.equal(second.text, first.text);
  assert.ok(second.text.length < 2_000, `the cached body is ${second.text.length} bytes`);
  net.mode = '429'; tick(TTL + 1_000);
  const stale = await call(arr(L)); assert.equal(stale.status, 200); assert.equal(stale.h('x-data-stale'), '1'); assert.equal(stale.text, first.text, 'the stale body is not the small last good body');
  assert.ok(stale.text.length < 2_000, `the stale body is ${stale.text.length} bytes`);
  net.mode = 'ok';
});
