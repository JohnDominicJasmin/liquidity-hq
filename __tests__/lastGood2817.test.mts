/* QA: PR #2817 (#1651 owner item 29), funding, the Coinbase price and the backup price answer the last good value with its age instead of failing. The REAL routes run; the venues are a stand-in that can be switched off; the clock is advanced by hand.
 *   L0 nothing read yet and the venue dead: the same error answer as before
 *   L1 inside the bound (funding 1 h, Coinbase 10 min, backup 10 min): 200, the last figures, x-data-stale and the real age, not cacheable
 *   L2 Coinbase's old price carries no USDT rate, so no premium can be made from it
 *   L3 past the bound: the old error answer again
 *   C1 the browser ignores an old premium and an old backup price; the AI funding line says how old the rates are */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const world = { up: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = new URL(String((input as { url?: string }).url ?? input));
  if (!world.up) return json(500, { error: 'down' });
  if (/binance\.com$/.test(url.host)) return json(200, [{ symbol: 'BTCUSDT', lastFundingRate: '0.0001', nextFundingTime: 1 }]);
  if (url.host === 'api.bybit.com') return json(200, { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', fundingRate: '0.0002', nextFundingTime: '1', fundingIntervalHour: '8' }] } });
  if (url.host === 'api.exchange.coinbase.com') return json(200, { price: url.pathname.includes('USDT') ? '0.999' : '60000' });
  if (url.host === 'api.hyperliquid.xyz') {
    const dex = (JSON.parse(String(init?.body ?? '{}')) as { dex?: string }).dex ?? '';
    return json(200, dex ? [{ universe: [{ name: 'xyz:COPPER' }] }, [{ midPx: '5', prevDayPx: '4', dayNtlVlm: '10' }]] : [{ universe: [{ name: 'FET' }] }, [{ midPx: '2', prevDayPx: '1', dayNtlVlm: '10' }]]);
  }
  return json(404, {});
}) as typeof fetch;
const realNow = Date.now; let clock = Date.UTC(2026, 0, 1);
Date.now = () => clock;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let ip = 0;
const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { 'x-forwarded-for': `10.7.0.${++ip}` } });
const MIN = 60_000;
const ROUTES = [
  { name: 'funding', mod: '../app/api/funding/route.ts', path: '/api/funding', bound: 60 * MIN, errorStatus: 500, error: 'Request failed' },
  { name: 'coinbase', mod: '../app/api/coinbase-price/route.ts', path: '/api/coinbase-price', bound: 10 * MIN, errorStatus: 502, error: 'fetch failed' },
  { name: 'backup', mod: '../app/api/market/price-backup/route.ts', path: '/api/market/price-backup?coins=fet,copper', bound: 10 * MIN, errorStatus: 502, error: 'Price backup unavailable.' },
];

for (const r of ROUTES) {
  test(`${r.name}: cold error, then the last good value with its age inside the bound, then the error again`, async () => {
    const { GET } = await import(r.mod) as { GET: (q: NextRequest) => Promise<Response> };
    const call = async () => { const res = await GET(req(r.path)); return { status: res.status, stale: res.headers.get('x-data-stale'), age: res.headers.get('x-data-age-ms'), cc: res.headers.get('cache-control'), body: await res.json() as Record<string, unknown> }; };
    world.up = false; clock += 5 * 60 * MIN;
    const cold = await call(); assert.equal(cold.status, r.errorStatus, 'L0'); assert.equal((cold.body as { error?: string }).error, r.error); assert.equal(cold.stale, null);
    world.up = true; clock += 2 * MIN;
    const good = await call(); assert.equal(good.status, 200, `the good read: ${JSON.stringify(good.body)}`); assert.equal(good.stale, null);
    const readAt = clock;
    world.up = false; clock = readAt + r.bound - 1_000;
    const old = await call();
    assert.equal(old.status, 200, 'L1: an error although a value inside the bound was held'); assert.equal(old.stale, '1'); assert.equal(old.age, String(r.bound - 1_000), 'the age is not the real age'); assert.equal(old.cc, 'no-store');
    if (r.name === 'coinbase') { assert.equal(good.body.usdtUsd, 0.999); assert.deepEqual(old.body, { price: 60000, usdtUsd: null }, 'L2'); }
    else assert.deepEqual(old.body, good.body);
    if (r.name === 'backup') assert.deepEqual(Object.keys(old.body).sort(), ['copper', 'fet']);
    clock = readAt + r.bound + 31_000;
    const gone = await call(); assert.equal(gone.status, r.errorStatus, 'L3: served past its bound'); assert.equal(gone.stale, null);
  });
}

test('C1. the browser ignores old figures where it cannot show an age, and the AI line states it', () => {
  const mp = read('components/MarketProvider.tsx');
  assert.match(mp, /if \(!r\.ok \|\| r\.headers\.get\('x-data-stale'\) === '1'\) return;/);
  assert.match(mp, /if \(!res\.ok \|\| res\.headers\?\.get\('x-data-stale'\) === '1'\) \{ markCb\('failed'\); return; \}\n\s*const \{ price: cbPrice, usdtUsd \}/);
  const arena = read('app/(main)/arena/page.tsx');
  assert.ok(arena.includes("setFundingStaleAt(staleAtFromHeaders(res.headers.get('x-data-stale'), res.headers.get('x-data-age-ms'), Date.now()));"));
  assert.ok(arena.includes("const aged = fundingStaleAt != null ? ` (rates last read ${Math.max(1, Math.round((Date.now() - fundingStaleAt) / 60_000))} min ago)` : '';"));
});
