/* #2699 (QA drawings audit #1263: BTC 1d ema_cross said "Needs 601 1d candles; BTC has 0" while ETH and SOL read fine). Written rule (Dev's cause by reading + PR body): Bybit reports a rate limit or a bad request as `{ retCode: <non-zero>, result: {} }` WITH HTTP 200; the klines route let that through and cached it for the whole candle (a closed=1 daily read is keyed by the candle), so one refusal at the wrong moment was served as "no candles" for up to a day. Now the route THROWS on a non-zero retCode or a missing result.list (502 with the status, held 30 s, then retried), so nothing is cached; a healthy answer after the hold is served and cached; a real retCode 0 answer is still an answer.
 * WHAT RUNS: the REAL route handler with real NextRequests; only the network is a stand-in (same pattern as klinesFailureHold.test.mts); the clock is Node's mocked Date. Every test has its own symbol/interval pair (the route's cache key ignores the limit).
 *   R1 refusal on 200 (retCode 10006)   R2 a missing result.list   R3 recovery: after the hold a healthy answer is served and cached   R4 retCode 0 with candles still 200 and cached   R5 HTTP refusals unchanged   R6 a retCode 0 EMPTY list is an answer and IS cached for the candle (the rule the PR keeps: stated here so a change to it is a decision, see the note)
 * NOT covered (needs live Bybit): that the refusal happens at the wrong moment in production. */
import test, { after, afterEach, beforeEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, next) { if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true }; return next(specifier, context); }`));
mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 1, 0, 0, 0) });
const tick = (ms: number) => mock.timers.tick(ms);

type Mode = 'ok' | 'refuse200' | 'refuse200list' | 'nolist' | 'empty0' | number;
const net = { bybit: 0, mode: 'ok' as Mode, unexpected: [] as string[] };
const LIST = Array.from({ length: 5 }, (_, i) => [String(1_700_000_000_000 + (4 - i) * 86_400_000), '100', '101', '99', '100.5', '10']);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); await new Promise((r) => setImmediate(r));
  if (url.host === 'api.bybit.com') { net.bybit++; const m = net.mode; return m === 'ok' ? Response.json({ retCode: 0, result: { list: LIST } }) : m === 'refuse200' ? Response.json({ retCode: 10006, retMsg: 'Too many visits. Exceeded the API Rate Limit.', result: {} }) : m === 'refuse200list' ? Response.json({ retCode: 10001, retMsg: 'params error', result: { list: [] } }) : m === 'nolist' ? Response.json({ retCode: 0, result: {} }) : m === 'empty0' ? Response.json({ retCode: 0, result: { list: [] } }) : new Response('refused', { status: m }); }
  net.unexpected.push(url.host); return new Response('[]', { status: 200 });
}) as typeof fetch;
const { GET } = await import('../app/api/market/klines/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts'); const { _resetExchangeGuard } = await import('../lib/exchangeGuard.ts');
let ip = 0; const call = async (qs: string) => { const r = await GET(new NextRequest(`https://qa.invalid/api/market/klines?${qs}`, { headers: { 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}` } })); let body: unknown = null; try { body = await r.json(); } catch { /* not json */ } return { status: r.status, body }; };
afterEach(() => { _resetApiHealthQueue(); _resetExchangeGuard(); }); after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });
const standIn = globalThis.fetch; beforeEach(() => { assert.equal(globalThis.fetch, standIn, 'the fetch stand-in is not installed: this run would reach the real network'); });
const Q = (sym: string, iv: string) => `source=bybit&symbol=${sym}&interval=${iv}&limit=600&closed=1`;
const rows = (b: unknown) => (b as { result?: { list?: unknown[] } })?.result?.list ?? (Array.isArray(b) ? b : []);

test('R1. a Bybit refusal on HTTP 200 (retCode 10006, empty result) is a FAILURE: 502, not "no candles", and held 30 s without asking Bybit again', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'refuse200';
  const a = await call(Q('BTCUSDT', 'D')); assert.equal(a.status, 502, 'a refusal on 200 was served as an answer (the cause of "BTC has 0")'); assert.equal(rows(a.body).length, 0);
  const b = await call(Q('BTCUSDT', 'D')); assert.equal(b.status, 502); assert.equal(net.bybit, 1, `Bybit was asked ${net.bybit} times inside the hold: the refusal is not held`);
  assert.deepEqual(net.unexpected, [], 'an unexpected host was called');
});
test('R2. a Bybit answer with no result.list is a failure too (502), not an empty success', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'nolist'; const a = await call(Q('BTCUSDT', 'W')); assert.equal(a.status, 502, 'a body without result.list was served as an answer');
});
test('R3. NOTHING IS CACHED FOR THE CANDLE: after the 30 s hold a healthy Bybit is served (200 with candles) and then cached', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'refuse200';
  assert.equal((await call(Q('ETHUSDT', 'D'))).status, 502); tick(31_000); net.mode = 'ok';
  const good = await call(Q('ETHUSDT', 'D')); assert.equal(good.status, 200, 'the refusal was cached for the whole candle: a healthy Bybit afterwards is not served'); assert.equal(rows(good.body).length, LIST.length, 'the candles are missing from the recovered answer');
  const calls = net.bybit; const again = await call(Q('ETHUSDT', 'D')); assert.equal(again.status, 200); assert.equal(net.bybit, calls, 'the healthy answer must be cached (no second upstream call)');
});
test('R4. a real retCode 0 answer with candles is still an answer, 200, served from the cache on the second request', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'ok'; const a = await call(Q('SOLUSDT', 'D')), b = await call(Q('SOLUSDT', 'D')); assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(net.bybit, 1, 'two healthy requests must make one upstream call'); assert.equal(rows(a.body).length, LIST.length);
});
test('R5. an HTTP refusal (500) is unchanged: 502 and held', async () => {
  tick(61_000); net.bybit = 0; net.mode = 500; const a = await call(Q('SOLUSDT', 'W')); assert.equal(a.status, 502); const b = await call(Q('SOLUSDT', 'W')); assert.equal(b.status, 502); assert.equal(net.bybit, 1);
});
/* R6 pins what the PR keeps ON PURPOSE ("a real, empty list (retCode 0) is still an answer"): it is served 200 and cached for the candle. That is the same hazard class as the bug (an empty answer pinned for a day); QA flagged it to Dev on #2699. If the rule changes, this test changes with it, deliberately. */
test('R6. a retCode 0 answer with an EMPTY list is served 200 (the rule the PR keeps) and stays cached for the candle even when Bybit is healthy 61 s later', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'empty0'; const first = await call(Q('ETHUSDT', 'W')); tick(61_000); net.mode = 'ok'; const second = await call(Q('ETHUSDT', 'W'));
  assert.equal(first.status, 200); assert.equal(rows(first.body).length, 0); assert.equal(second.status, 200); assert.equal(rows(second.body).length, 0, 'the empty answer is no longer cached (a deliberate change: update this pin and the note)'); assert.equal(net.bybit, 1);
});
test('R7. a NON-ZERO retCode is a refusal even when a (empty) result.list is present: the retCode alone decides', async () => {
  tick(61_000); net.bybit = 0; net.mode = 'refuse200list'; const a = await call(Q('SOLUSDT', 'M')); assert.equal(a.status, 502, 'a non-zero retCode with an empty list was served as an answer'); tick(31_000); net.mode = 'ok'; assert.equal((await call(Q('SOLUSDT', 'M'))).status, 200, 'and nothing was cached for the candle');
});
