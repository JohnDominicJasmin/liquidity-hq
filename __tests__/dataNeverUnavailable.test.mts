import test, { afterEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';

/* #2555 (owner sweep 2026-11-18: "no failing data"). QA's pins for the two reusable pieces of the batch that can be run for real with a mocked clock and a stand-in network:
 *   C1-C4  lib/apiCache.cachedPeek / cachedServable: the last good value is served only while it is younger than its window, and the boundary is exact
 *   G1-G7  lib/exchangeGuard: a 429 that SAYS how long to wait is taken at its word (floor 5 s, cap 6 h); a 429 with no Retry-After and a Binance 418 keep the escalating 10-minute cooldown; the same for Bybit; calls resume after the window
 * Numbers are written as the specified values (5 s, 10 min, 6 h), not read back from the constants. NOT PINNED HERE: the routes that serve the stale answer (cmc, bot-info, rsi 401) and the browser parts: those need the route harness / browser cells. */
const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
mock.timers.enable({ apis: ['Date'], now: T0 });
const tick = (ms: number) => mock.timers.tick(ms);

const { cached, cachedPeek, cachedServable } = await import('../lib/apiCache.ts');
const guard = await import('../lib/exchangeGuard.ts');

/* ── apiCache ─────────────────────────────────────────────────────────── */
test('C1. cachedPeek returns the last good value with its fetch time while it is younger than the window, and null at or past it', async () => {
  await cached('qa2555:peek', 1_000, async () => ({ n: 1 }));
  const fetchedAt = Date.now(); tick(59_999);
  const hit = cachedPeek<{ n: number }>('qa2555:peek', 60_000); assert.deepEqual(hit?.data, { n: 1 }); assert.equal(hit?.ts, fetchedAt);
  tick(1); assert.equal(cachedPeek('qa2555:peek', 60_000), null, 'exactly at the window the value is no longer served');
});
test('C2. cachedPeek is null for a key nothing was cached under', () => { assert.equal(cachedPeek('qa2555:never', 60_000), null); });
test('C3. cachedServable: true under the servable window, false at it, false for an unknown key', async () => {
  await cached('qa2555:serv', 1_000, async () => 'x'); tick(119_999);
  assert.equal(cachedServable('qa2555:serv', 120_000), true); tick(1);
  assert.equal(cachedServable('qa2555:serv', 120_000), false); assert.equal(cachedServable('qa2555:nope', 120_000), false);
});
test('C4. a held (expired) entry is still PEEKED while a failed refresh must not erase it: cachedPeek does not read the ttl', async () => {
  await cached('qa2555:ttl', 1_000, async () => 'good'); tick(30_000);
  assert.equal(cachedPeek<string>('qa2555:ttl', 6 * 60 * 60_000)?.data, 'good', 'a value past its ttl but inside the stale window is still the last good answer');
});

/* ── exchangeGuard ────────────────────────────────────────────────────── */
type Answer = { status: number; retryAfter?: string };
let next: Answer = { status: 200 }; let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { calls++; return new Response('{"code":-1003,"msg":"Too many requests; request weight"}', { status: next.status, headers: next.retryAfter != null ? { 'retry-after': next.retryAfter } : {} }); }) as typeof fetch;
afterEach(() => { guard._resetExchangeGuard(); calls = 0; next = { status: 200 }; });
process.on('exit', () => { globalThis.fetch = realFetch; });
const trip = async (url: string, a: Answer) => { next = a; await guard.exchangeFetch(url).catch(() => undefined); };
const coolMs = (ex: 'binance' | 'bybit') => { const c = guard.exchangeCoolingDown(ex); return c ? c.until - Date.now() : 0; };
const BN = 'https://api.binance.com/api/v3/ticker/24hr', BB = 'https://api.bybit.com/v5/market/tickers';

test('G1. 429 with Retry-After 7 stops calls for 7 s, not 10 minutes', async () => { await trip(BN, { status: 429, retryAfter: '7' }); assert.equal(coolMs('binance'), 7_000); });
test('G2. 429 with Retry-After 1 is floored to 5 s (cannot hammer)', async () => { await trip(BN, { status: 429, retryAfter: '1' }); assert.equal(coolMs('binance'), 5_000); });
test('G3. 429 with no Retry-After keeps the 10-minute cooldown', async () => { await trip(BN, { status: 429 }); assert.equal(coolMs('binance'), 10 * 60_000); });
test('G4. a Binance 418 (a ban) keeps the 10-minute cooldown even when it carries a Retry-After', async () => { await trip(BN, { status: 418, retryAfter: '7' }); assert.equal(coolMs('binance'), 10 * 60_000); });
test('G5. a huge Retry-After is capped at 6 hours', async () => { await trip(BN, { status: 429, retryAfter: '100000' }); assert.equal(coolMs('binance'), 6 * 60 * 60_000); });
test('G6. the same rule for Bybit', async () => { await trip(BB, { status: 429, retryAfter: '7' }); assert.equal(coolMs('bybit'), 7_000); });
test('G7. calls are refused without touching the network inside the window and go through again after it', async () => {
  await trip(BN, { status: 429, retryAfter: '7' }); assert.equal(calls, 1); next = { status: 200 };
  await assert.rejects(() => guard.exchangeFetch(BN), /cooling down/); assert.equal(calls, 1, 'a call inside the window reached the network');
  tick(7_000); const r = await guard.exchangeFetch(BN); assert.equal(r.status, 200); assert.equal(calls, 2, 'the call after the window did not go through');
});
test('G8. CONTROL: a 200 never opens the breaker', async () => { await trip(BN, { status: 200 }); assert.equal(coolMs('binance'), 0); });
