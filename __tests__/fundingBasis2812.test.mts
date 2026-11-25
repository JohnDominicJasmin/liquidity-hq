/* QA: PR #2812 (#1651 owner item 92), /funding's history is the same venue as "Current" (Bybit), per 8 hours, over real time. Expected numbers are written from that rule. The REAL lib/fundingHistory.ts and the REAL route run; the exchanges are a stand-in.
 *   B1 each row is scaled to per 8 hours from its own settlement gap (8 h unchanged, 4 h doubled, 1 h x8, a change part way scaled row by row, a lone or gapped row read as 8 h)
 *   B2 a range is time: 7 days is 42 rows of a 4 hour contract and 21 of an 8 hour one
 *   B3 a range the history does not reach is not covered (200 hourly rows cover 7 days and not 14; a new listing covers what it has)
 *   B4 the average counts each row for the hours it covered
 *   R1 the route asks Bybit first and Binance only for what Bybit cannot give (no Bybit market, empty list, failure), and names those in viaFallback
 *   R2 no row older than 15 days is sent, from either venue; limit 200 is accepted and 201 refused
 * WHAT IT CANNOT PROVE: the rendered table (read on a deployed site). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { perEightHours, lastDays, coversDays, timeAverage } from '../lib/fundingHistory.ts';

const H = 3_600_000, T0 = Date.UTC(2026, 0, 1);
const series = (n: number, stepH: number, rate = 0.0001) => Array.from({ length: n }, (_, i) => ({ rate, ts: T0 + i * stepH * H }));
const r8 = (v: number) => Math.round(v * 1e10) / 1e10;

test('B1. every row is per 8 hours, from its own gap', () => {
  for (const [step, factor] of [[8, 1], [4, 2], [2, 4], [1, 8]] as const) assert.deepEqual(perEightHours(series(4, step)).map((p) => [r8(p.rate), p.hours]), Array(4).fill([r8(0.0001 * factor), step]), `${step} h`);
  const changed = [0, 8, 16, 20, 24].map((h) => ({ rate: 0.0001, ts: T0 + h * H }));
  assert.deepEqual(perEightHours(changed).map((p) => p.hours), [8, 8, 8, 4, 4]);
  assert.deepEqual(perEightHours([{ rate: 0.0003, ts: T0 }]).map((p) => [p.rate, p.hours]), [[0.0003, 8]], 'a lone row');
  assert.equal(perEightHours([{ rate: 0.0001, ts: T0 }, { rate: 0.0001, ts: T0 + 24 * H }])[1].hours, 8, 'a long gap is a missing row, not a 24 hour rate');
  assert.equal(perEightHours([{ rate: 0.0001, ts: T0 }, { rate: 0.0001, ts: T0 + 4 * H + 60_000 }])[1].hours, 4, 'a settlement stamped a minute late');
});

test('B2. ranges are time, not a row count', () => {
  assert.equal(lastDays(series(100, 4), 7).length, 42); assert.equal(lastDays(series(100, 8), 7).length, 21);
  assert.equal(lastDays(series(100, 4), 1).length, 6); assert.equal(lastDays(series(100, 8), 14).length, 42);
  assert.deepEqual(lastDays([], 7), []);
});

test('B3. a range the history does not reach is not covered', () => {
  const pts = (n: number, step: number) => perEightHours(series(n, step));
  assert.equal(coversDays(pts(200, 1), 7), true); assert.equal(coversDays(pts(200, 1), 14), false);
  for (const step of [4, 8]) { assert.equal(coversDays(pts(200, step), 7), true); assert.equal(coversDays(pts(200, step), 14), true); }
  assert.equal(coversDays(pts(9, 8), 3), true, 'three days of 8 hour rows'); assert.equal(coversDays(pts(8, 8), 3), false); assert.equal(coversDays(pts(9, 8), 7), false);
  assert.equal(coversDays(pts(21, 8), 7), true); assert.equal(coversDays(pts(20, 8), 7), false); assert.equal(coversDays([], 1), false);
});

test('B4. the average is weighted by the hours each row covered', () => {
  assert.equal(r8(timeAverage([{ rate: 0.0003, hours: 8 }, { rate: 0, hours: 4 }])!), 0.0002);
  assert.equal(timeAverage([]), null);
});

/* ── the route ── */
const NOW = Date.now();
const ages = [0, 8, 16, 14 * 24, 16 * 24, 40 * 24];   // hours before now: the last two are older than 15 days
const asked = { bybit: [] as string[], binance: [] as string[], limits: new Set<string>() };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const symbol = url.searchParams.get('symbol') ?? '';
  asked.limits.add(url.searchParams.get('limit') ?? '');
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/funding/history') {
    asked.bybit.push(symbol);
    if (symbol === 'ETHUSDT') return json(200, { retCode: 0, result: { list: [] } });
    if (symbol === 'SOLUSDT') return json(500, {});
    return json(200, { retCode: 0, result: { list: ages.map((h) => ({ symbol, fundingRate: '0.0002', fundingRateTimestamp: String(NOW - h * H) })) } });
  }
  if (url.host === 'fapi.binance.com' && url.pathname === '/fapi/v1/fundingRate') {
    asked.binance.push(symbol);
    return json(200, [...ages].reverse().map((h) => ({ symbol, fundingRate: '0.0005', fundingTime: NOW - h * H })));
  }
  throw new Error(`stray request ${url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const routeP = import('../app/api/market/funding-rate/route.ts');
const call = async (qs: string) => (await routeP).GET(new NextRequest(`http://localhost/api/market/funding-rate?${qs}`, { headers: { 'x-forwarded-for': '10.8.0.1' } }));

test('R1. Bybit first; Binance only for no Bybit market, an empty list or a failure', async () => {
  const res = await call('limit=200'); assert.equal(res.status, 200);
  const body = await res.json() as { data: Record<string, Array<{ fundingRate: string; fundingTime: number }>>; viaFallback?: string[] };
  assert.deepEqual([...(body.viaFallback ?? [])].sort(), ['ETHUSDT', 'FETUSDT', 'SOLUSDT']);
  assert.deepEqual([...asked.binance].sort(), ['ETHUSDT', 'FETUSDT', 'SOLUSDT'], 'Binance was asked for a coin Bybit answered');
  assert.ok(asked.bybit.includes('BTCUSDT') && !asked.bybit.includes('FETUSDT'));
  assert.equal(body.data.BTCUSDT[0].fundingRate, '0.0002'); assert.equal(body.data.ETHUSDT[0].fundingRate, '0.0005');
  assert.deepEqual([...asked.limits], ['200']);
  for (const [sym, rows] of Object.entries(body.data)) {
    assert.equal(rows.length, 4, `${sym}: ${rows.length} rows`);
    assert.ok(rows.every((x) => NOW - x.fundingTime <= 15 * 24 * H), `${sym} carries a row older than 15 days`);
    assert.deepEqual(Object.keys(rows[0]).filter((k) => k !== 'symbol').sort(), ['fundingRate', 'fundingTime'], sym);
  }
});

test('R2. limit 200 is the most the route takes', async () => {
  const res = await call('limit=201'); assert.equal(res.status, 400);
});
