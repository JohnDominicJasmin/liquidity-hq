/* #1631 C: the Coinbase premium compares like with like (Coinbase BTC/USD against the exchange's BTC/USDT converted to USD), and the BTC
 * price never waits on the conversion rate.
 *
 * THE REAL ROUTE RUNS HERE (app/api/coinbase-price/route.ts GET). Coinbase's two tickers are stand-ins. Date is Node's mocked clock, so the
 * route's caches (5 s for the price, 60 s for the rate) are stepped past between cases; timers stay REAL, because the route's one-second
 * wait for the rate is the thing measured in U3.
 *
 * WHAT THIS PINS: a healthy pair answers both; a rate outside 0.9-1.1, an error or no number answers usdtUsd null with the BTC price still
 * served; a rate that hangs costs the answer about a second (the price is served, the rate null) and is not lost - the next caller gets it
 * once it lands, with no second request; both requests carry a 5 s timeout.
 *
 * WHAT IT CANNOT PROVE: Coinbase's real latency, or the premium MarketProvider computes from these numbers (client code). */
import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 15, 0, 0) });
const fresh = () => mock.timers.tick(61_000); // past both caches

type Usdt = { kind: 'ok'; price: string } | { kind: 'http500' } | { kind: 'hang' };
let usdt: Usdt = { kind: 'ok', price: '0.99885' };
let releaseHang: (() => void) | null = null;
const net = { btc: 0, usdt: 0, unexpected: [] as string[] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === 'https://api.exchange.coinbase.com/products/BTC-USD/ticker') { net.btc++; return Response.json({ price: '107250.12' }); }
  if (url.href === 'https://api.exchange.coinbase.com/products/USDT-USD/ticker') {
    net.usdt++;
    if (usdt.kind === 'http500') return new Response('down', { status: 500 });
    if (usdt.kind === 'hang') {
      return new Promise<Response>((resolve, reject) => {
        releaseHang = () => resolve(Response.json({ price: '0.99901' }));
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return Response.json({ price: usdt.price });
  }
  net.unexpected.push(url.href);
  return new Response('[]', { status: 200 });
}) as typeof fetch;
after(() => { releaseHang?.(); globalThis.fetch = realFetch; mock.timers.reset(); });

const { GET } = await import('../app/api/coinbase-price/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
afterEach(() => _resetApiHealthQueue());

let ip = 0;
async function get() {
  const t0 = performance.now();
  const r = await GET(new NextRequest('https://qa.invalid/api/coinbase-price', { headers: { 'cf-connecting-ip': `198.51.100.${++ip}` } }));
  return { status: r.status, body: await r.json() as { price?: number; usdtUsd?: number | null }, ms: performance.now() - t0 };
}

test('U1. a healthy pair: the BTC price and the USDT rate are both served', async () => {
  const r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.price, 107250.12); assert.equal(r.body.usdtUsd, 0.99885);
});

test('U2. a rate outside 0.9-1.1, an error, or no number: the rate is null and the BTC price is still served', async () => {
  const cases: [string, Usdt][] = [['0.85', { kind: 'ok', price: '0.85' }], ['1.2', { kind: 'ok', price: '1.2' }], ['HTTP 500', { kind: 'http500' }], ['no number', { kind: 'ok', price: 'n/a' }]];
  for (const [what, u] of cases) {
    fresh(); usdt = u;
    const r = await get();
    assert.equal(r.status, 200, `${what}: the route failed`);
    assert.equal(r.body.price, 107250.12, `${what}: the BTC price was not served`);
    assert.equal(r.body.usdtUsd, null, `${what}: a bad rate was served`);
  }
});

test('U3. a rate that hangs costs the answer about a second, not the request: the BTC price is served with the rate null', async () => {
  fresh(); usdt = { kind: 'hang' };
  const r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.price, 107250.12); assert.equal(r.body.usdtUsd, null);
  assert.ok(r.ms >= 900 && r.ms < 3000, `the answer took ${Math.round(r.ms)} ms: it should wait about 1 s (USDT_WAIT_MS) for the rate, then answer`);
});

test('U4. the hung rate is not lost: once it lands, the next caller gets it with no second request', async () => {
  const before = net.usdt;
  releaseHang!();
  await new Promise((resolve) => setImmediate(resolve));
  const r = await get();
  assert.equal(r.body.usdtUsd, 0.99901, 'the rate that landed after the answer was not kept');
  assert.equal(net.usdt, before, 'a second USDT request was made instead of using the one already in flight');
});

test('U5. both Coinbase requests carry a 5 s timeout (PM audit of #1665: a hung answer held the route open)', () => {
  const src = stripTsComments(read('app/api/coinbase-price/route.ts'));
  const fetches = src.match(/fetch\(CB_(?:USDT_)?TICKER,[\s\S]*?\}\)/g) ?? [];
  assert.equal(fetches.length, 2, `precondition: ${fetches.length} Coinbase fetch calls found`);
  for (const f of fetches) assert.match(f, /signal: AbortSignal\.timeout\(5_000\)/, `a Coinbase request has no timeout: ${f.slice(0, 80)}`);
});

test('U6. CONTROL: every request went to one of the two tickers', () => {
  assert.deepEqual(net.unexpected, []);
  assert.ok(net.btc > 0 && net.usdt > 0);
});
