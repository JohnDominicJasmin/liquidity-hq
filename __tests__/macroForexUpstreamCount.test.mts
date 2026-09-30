/* #1397 / #1404 / #1473: how many upstream calls do /api/macro and /api/forex/jpy make?
 *
 * THE REAL ROUTES RUN HERE. `GET` is imported from both route files and called
 * with real NextRequests. Only the network is a stand-in: `globalThis.fetch` is
 * replaced by a counter that answers Yahoo, the rate provider and FRED, and the
 * clock is Node's mocked Date, so "inside the window" and "30 s later" are exact.
 *
 * WHAT THIS PROVES: the bound the server cache gives, AFTER #1473 - one call per
 * series per window while the upstream answers, one call per series per 30 s
 * while it refuses, one call for any number of concurrent cold callers, and
 * recovery. The six cases are the ones #1473 lists under "For QA's unit count".
 *
 * WHAT IT CANNOT PROVE: what the old `next: { revalidate }` did BEFORE. Plain Node
 * ignores that option, so a before-count here would be meaningless. That
 * measurement needs a production build (100 dashboard loads, count upstream
 * calls) and is still owed on #1397.
 *
 * Module state (the cache, the failure hold, the rate limiter) lives for the
 * whole file, so the tests run in order on one advancing clock and every request
 * comes from a fresh client IP. */
import test, { after, afterEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

/* Sentry, stood in for: lib/apiError.ts (used by /api/forex/jpy) imports it, and its
   Node entry has no captureException - same stand-in as boomfiWebhookRoute.test.mts. */
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

type Mode = 'ok' | 'http500' | 'noPrice' | 'network';
const SYMBOL_LABEL: Record<string, string> = { 'CL%3DF': 'oil', 'DX-Y.NYB': 'dxy', '%5EGSPC': 'spx', 'GC%3DF': 'gold', 'JPY%3DX': 'jpy' };
const SERIES = ['oil', 'dxy', 'spx', 'gold', 'jpy'] as const;
const net = {
  yahoo: Object.fromEntries(SERIES.map((s) => [s, 0])) as Record<string, number>,
  yahooMode: Object.fromEntries(SERIES.map((s) => [s, 'ok'])) as Record<string, Mode>,
  rate: 0,
  rateMode: 'ok' as Mode,
  fred: 0,
  unexpected: [] as string[],
};
const yahooBody = (label: string) => ({ chart: { result: [{ meta: { regularMarketPrice: 100 + SERIES.indexOf(label as typeof SERIES[number]), previousClose: 99 } }] } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  await new Promise((r) => setImmediate(r)); // a real await, so concurrent callers overlap
  if (url.host === 'query1.finance.yahoo.com') {
    const label = SYMBOL_LABEL[url.pathname.split('/').pop()!];
    assert.ok(label, `unexpected Yahoo symbol ${url.pathname}`);
    net.yahoo[label]++;
    const m = net.yahooMode[label];
    if (m === 'network') throw new TypeError('fetch failed');
    if (m === 'http500') return new Response('upstream down', { status: 500 });
    if (m === 'noPrice') return Response.json({ chart: { result: [{ meta: {} }] } });
    return Response.json(yahooBody(label));
  }
  if (url.host === 'open.er-api.com') {
    net.rate++;
    if (net.rateMode === 'network') throw new TypeError('fetch failed');
    if (net.rateMode === 'http500') return new Response('down', { status: 500 });
    if (net.rateMode === 'noPrice') return Response.json({ rates: { EUR: 0.9 } });
    return Response.json({ rates: { JPY: 150.25 } });
  }
  if (url.host === 'fred.stlouisfed.org') {
    net.fred++;
    return new Response('observation_date,DFII10\n2026-09-28,1.80\n2026-09-29,1.85\n', { status: 200 });
  }
  net.unexpected.push(url.host);
  return new Response('[]', { status: 200 });
}) as typeof fetch;

const { GET: macroGET } = await import('../app/api/macro/route.ts');
const { GET: jpyGET } = await import('../app/api/forex/jpy/route.ts');
const { cached } = await import('../lib/apiCache.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');

let ip = 0;
const req = (path: string) => new NextRequest(`https://qa.invalid${path}`, { headers: { 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}` } });
type Macro = Record<string, { price: number; chg: number } | null>;
const macro = async () => { const r = await macroGET(req('/api/macro')); assert.equal(r.status, 200); return (await r.json()) as Macro; };
const jpy = async () => { const r = await jpyGET(req('/api/forex/jpy')); return { status: r.status, body: await r.json() as { jpy?: number } }; };
const yahooTotal = () => SERIES.reduce((n, s) => n + net.yahoo[s], 0);
const allOk = () => { for (const s of SERIES) net.yahooMode[s] = 'ok'; };

afterEach(() => _resetApiHealthQueue());
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

/* ── /api/macro ──────────────────────────────────────────────────────── */

test('M1. inside the window: N calls make ONE upstream call per series, and every call gets the same figures', async () => {
  const before = { ...net.yahoo };
  const bodies: Macro[] = [];
  for (let i = 0; i < 8; i++) { bodies.push(await macro()); tick(5_000); } // 8 calls across 40 s
  for (const s of SERIES) assert.equal(net.yahoo[s] - before[s], 1, `${s}: ${net.yahoo[s] - before[s]} upstream calls for 8 requests inside one minute`);
  for (const s of SERIES) assert.ok(bodies[0][s] && bodies[0][s]!.price > 0, `${s} is null on a healthy upstream`);
  for (const b of bodies) assert.deepEqual(b, bodies[0], 'two requests inside the window got different figures');
  assert.deepEqual(net.unexpected, [], `a request went somewhere unexpected: ${net.unexpected.join(', ')}`);
});

test('M2. N concurrent COLD calls share one upstream call per series', async () => {
  tick(61_000); // past the one-minute window
  const before = yahooTotal();
  const bodies = await Promise.all(Array.from({ length: 12 }, () => macro()));
  assert.equal(yahooTotal() - before, 5, `12 concurrent cold requests made ${yahooTotal() - before} Yahoo calls - expected 5, one per series`);
  for (const b of bodies) for (const s of SERIES) assert.ok(b[s], `${s} null in a concurrent response`);
});

test('M3. a FAILED series is held for 30 s: N calls inside the hold make one upstream call, each still answers null for it', async () => {
  tick(61_000);
  net.yahooMode.oil = 'http500';
  const oil0 = net.yahoo.oil;
  const bodies: Macro[] = [await macro()];
  for (const at of [5_000, 10_000, 10_000, 4_900]) { tick(at); bodies.push(await macro()); } // up to 29.9 s after the failure
  assert.equal(net.yahoo.oil - oil0, 1, `a refusing Yahoo got ${net.yahoo.oil - oil0} oil calls in 29.9 s - the hold should allow one`);
  for (const b of bodies) {
    assert.equal(b.oil, null, 'the failed series is not null - a failure is being served as a value');
    assert.ok(b.dxy && b.spx && b.gold && b.jpy, 'one failing series took the others down with it');
  }
});

test('M4. the first call at 30 s retries; a success after a failure is stored and served', async () => {
  tick(100); // exactly 30.0 s after the failure in M3
  const oil0 = net.yahoo.oil;
  assert.equal((await macro()).oil, null, 'still failing, still null');
  assert.equal(net.yahoo.oil - oil0, 1, 'the call at 30 s did not retry the upstream');
  tick(30_000);
  allOk();
  const recovered = await macro();
  assert.ok(recovered.oil && recovered.oil.price > 0, 'the recovered series is still null');
  assert.equal(net.yahoo.oil - oil0, 2);
  tick(20_000);
  const next = await macro();
  assert.equal(net.yahoo.oil - oil0, 2, 'the recovered value was not stored - the next call went upstream again');
  assert.deepEqual(next.oil, recovered.oil);
});

test('M5. every failure shape is held, not only an HTTP error: a 200 with no price, and a network error', async () => {
  for (const shape of ['noPrice', 'network'] as const) {
    tick(61_000);
    allOk();
    net.yahooMode.gold = shape;
    const g0 = net.yahoo.gold;
    for (let i = 0; i < 5; i++) { assert.equal((await macro()).gold, null, `${shape}: gold not null`); tick(2_000); }
    assert.equal(net.yahoo.gold - g0, 1, `${shape}: ${net.yahoo.gold - g0} upstream calls for 5 requests inside the hold`);
    // Held as a FAILURE (retried at 30 s), not stored as a null value (which would sit for the full minute).
    tick(20_000);
    await macro();
    assert.equal(net.yahoo.gold - g0, 2, `${shape}: not retried 30 s after the failure - it was stored as a value, not held as a failure`);
  }
  allOk();
});

/* ── /api/forex/jpy ──────────────────────────────────────────────────── */

test('J1. inside five minutes: N calls make one call to the rate provider', async () => {
  const r0 = net.rate;
  const answers = [];
  for (let i = 0; i < 6; i++) { answers.push(await jpy()); tick(45_000); } // 6 calls across 3m45s
  assert.equal(net.rate - r0, 1, `${net.rate - r0} rate-provider calls for 6 requests inside five minutes`);
  for (const a of answers) assert.deepEqual(a, { status: 200, body: { jpy: 150.25 } });
  tick(5 * 60_000);
  await jpy();
  assert.equal(net.rate - r0, 2, 'the call after five minutes did not refresh');
});

test('J2. a failed rate read is held 30 s (still 502 to every caller), retried at 30 s, and a recovery is stored', async () => {
  for (const shape of ['http500', 'noPrice'] as const) {
    tick(5 * 60_000 + 1_000);
    net.rateMode = shape;
    const r0 = net.rate;
    for (let i = 0; i < 5; i++) { const a = await jpy(); assert.equal(a.status, 502, `${shape}: a held failure answered ${a.status}`); tick(i < 4 ? 7_000 : 2_000); } // 30 s later
    assert.equal(net.rate - r0, 1, `${shape}: ${net.rate - r0} calls to a refusing provider inside 30 s`);
    assert.equal((await jpy()).status, 502);
    assert.equal(net.rate - r0, 2, `${shape}: no retry at 30 s`);
    tick(30_000);
    net.rateMode = 'ok';
    assert.deepEqual(await jpy(), { status: 200, body: { jpy: 150.25 } });
    tick(10_000);
    await jpy();
    assert.equal(net.rate - r0, 3, `${shape}: the recovery was not stored`);
  }
});

/* ── lib/apiCache.ts, the option itself ──────────────────────────────── */

test('A1. without failTtlMs, cached() still retries on every failing call - the other routes are unchanged', async () => {
  let n = 0;
  const failing = () => { n++; return Promise.reject(new Error('down')); };
  for (let i = 0; i < 5; i++) await assert.rejects(cached('qa:no-hold', 60_000, failing));
  assert.equal(n, 5, `${n} fetcher calls for 5 failing callers without the option`);
});

test('A2. with failTtlMs, 20 concurrent cold failing callers make ONE call, and all 20 see the failure', async () => {
  let n = 0;
  const failing = async () => { n++; await new Promise((r) => setImmediate(r)); throw new Error('down'); };
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => cached('qa:hold', 60_000, failing, { failTtlMs: 30_000 })));
  assert.equal(n, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 20);
  tick(29_999);
  await assert.rejects(cached('qa:hold', 60_000, failing, { failTtlMs: 30_000 }));
  assert.equal(n, 1, 'held at 29.999 s');
  tick(1);
  await assert.rejects(cached('qa:hold', 60_000, failing, { failTtlMs: 30_000 }));
  assert.equal(n, 2, 'not retried at 30 s');
});

/* ── source: one cache, one age ─────────────────────────────────────── */

test('S1. both routes fetch with no-store and a 30 s hold - no second cache stacked on the first', () => {
  for (const f of ['app/api/macro/route.ts', 'app/api/forex/jpy/route.ts']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(src, /cache: 'no-store'/, `${f} no longer fetches with no-store`);
    assert.doesNotMatch(src, /next:\s*\{\s*revalidate/, `${f} declares next.revalidate again - two caches with two ages`);
    assert.match(src, /failTtlMs: (YF|JPY)_FAIL_TTL_MS/, `${f} no longer passes a failure hold`);
    assert.match(src, /_FAIL_TTL_MS = 30_000;/, `${f}: the failure hold is no longer 30 s`);
  }
});
