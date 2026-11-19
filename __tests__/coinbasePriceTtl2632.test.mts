/* #2632 (#1651 L13): the Coinbase premium read is cached 20 s, not 5 s. THE REAL ROUTE RUNS (app/api/coinbase-price/route.ts GET); Coinbase's two tickers are stand-ins and Date is Node's mocked clock, so the cache is stepped through exactly.
 *   C1 a caller 19 s after a fetch is served from the cache (no new upstream BTC request), a caller 21 s after refetches once   C2 a minute of callers at random phases (every 3 s, 40 callers) costs at most 3 upstream BTC rounds (was up to 12 at 5 s)
 *   C3 the price served by the cache is the same body (nothing about the answer changed)   C4 source pin: the TTL is 20_000 and the read goes through cached() */
import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const src = readFileSync(new URL('../app/api/coinbase-price/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 15, 0, 0) });
const net = { btc: 0, usdt: 0, unexpected: [] as string[] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === 'https://api.exchange.coinbase.com/products/BTC-USD/ticker') { net.btc++; return Response.json({ price: '107250.12' }); }
  if (url.href === 'https://api.exchange.coinbase.com/products/USDT-USD/ticker') { net.usdt++; return Response.json({ price: '0.99885' }); }
  net.unexpected.push(url.href); return new Response('[]', { status: 200 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });
const standIn = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standIn, 'the fetch stand-in is not installed (#1683): this run would reach the real network'); });

const { GET } = await import('../app/api/coinbase-price/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
let ip = 0;
async function get() { const r = await GET(new NextRequest('https://qa.invalid/api/coinbase-price', { headers: { 'cf-connecting-ip': `198.51.100.${(++ip % 250) + 1}` } })); return { status: r.status, body: await r.json() as { price?: number; usdtUsd?: number | null } }; }
const fresh = () => mock.timers.tick(121_000);

test('C1. 19 s after a fetch the cache answers; 21 s after, exactly one new upstream BTC request', async () => {
  fresh(); _resetApiHealthQueue();
  await get(); const base = net.btc; assert.ok(base >= 1, 'CONTROL: the first call did not reach the stand-in');
  mock.timers.tick(19_000); await get(); assert.equal(net.btc, base, 'a caller 19 s later re-fetched: the TTL is shorter than 20 s');
  mock.timers.tick(2_000); await get(); assert.equal(net.btc, base + 1, `a caller 21 s later: expected one new fetch, got ${net.btc - base}`);
  await get(); assert.equal(net.btc, base + 1, 'a second caller right after the refetch fetched again');
});
test('C2. a minute of visitors at random phases (a caller every 3 s) costs at most 3 upstream BTC rounds', async () => {
  fresh(); _resetApiHealthQueue(); const base = net.btc;
  for (let i = 0; i < 40; i++) { await get(); mock.timers.tick(3_000); }
  const rounds = net.btc - base; assert.ok(rounds >= 2, `CONTROL: only ${rounds} rounds in 120 s`); assert.ok(rounds <= 6, `${rounds} upstream rounds in 120 s: at 20 s that is at most 6 (3 a minute)`);
});
test('C3. the cached answer is the same body as the fresh one', async () => {
  fresh(); _resetApiHealthQueue(); const a = await get(); mock.timers.tick(10_000); const b = await get();
  assert.deepEqual(b, a); assert.equal(a.status, 200); assert.equal(a.body.price, 107250.12);
});
test('C4. source: the TTL is 20_000 and the price read goes through cached()', () => {
  assert.match(src, /const CACHE_TTL = 20_000;/); assert.match(src, /cached\('coinbase-price', CACHE_TTL,/);
});
