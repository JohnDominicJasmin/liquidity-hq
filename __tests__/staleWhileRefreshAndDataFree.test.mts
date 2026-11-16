/* #2393: three server-slowness items. REAL lib code where the logic is in a lib, a sliced pure function for the AppShell rule, anchors for the wiring.
 *   R1-R6  lib/apiCache.cachedRefresh: a cold call waits; an entry that JUST expired is served at once and ONE background refresh runs (concurrent callers share it) and the next call gets the new value; an entry past TTL + the bound is NOT served (the caller waits for a fresh read); a failing refresh keeps serving the old value only until it ages out, then the real error surfaces; a fresh entry never refreshes
 *   X1-X2  lib/exchangeGuard.exchangeFetch: a non-exchange upstream gets a deadline signal (5 s), a caller's own signal wins, and an exchange URL is not given that signal
 *   D1-D3  components/AppShell isDataFree (SLICED and run): the 14 data-free pages are exact matches (trailing slash tolerated), every other route including '/', '/dashboard', '/arena' and sub-paths keeps the provider; the Ask-AI chat turns it on (event)
 *   P1     the proxy: a type WITH a Bybit fallback gives its primary 3 s (the signal is only added when there is a fallback; a primary that throws falls to Bybit; without a fallback the original error is rethrown), source anchors (the route is not importable by the unit runner)
 * WHAT IT CANNOT PROVE: behaviour under real load, the 3 s threshold against real Binance latency (PM's number, per the PR), or the rendered pages: the browser cells in the group run (no /api/proxy calls on /about; chat start; landing dark/light). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { cached, cachedRefresh, STALE_WHILE_REFRESH_MS } from '../lib/apiCache.ts';
import { exchangeFetch } from '../lib/exchangeGuard.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
let n = 0; const key = () => `qa:swr:${++n}`; const TTL = 1_000, BOUND = 60_000;
const BASE = 1_950_000_000_000;
const tick = () => new Promise((r) => setImmediate(r));

test('R1. cold: the first call waits for the fetcher; a call inside the TTL is a plain hit (no second load)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key(); let loads = 0;
  assert.equal(await cachedRefresh(k, TTL, BOUND, async () => `v${++loads}`), 'v1');
  t.mock.timers.tick(500); assert.equal(await cachedRefresh(k, TTL, BOUND, async () => `v${++loads}`), 'v1'); assert.equal(loads, 1, 'a fresh entry was refreshed');
});
test('R2. THE POINT: just after expiry the OLD value is returned at once (the fetcher is slow), ONE refresh runs, and the next call gets the new value', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key(); let loads = 0; let release!: () => void;
  const slow = () => new Promise<string>((res) => { loads++; release = () => res(`v${loads}`); });
  const first = cachedRefresh(k, TTL, BOUND, async () => { loads++; return 'v1'; }); assert.equal(await first, 'v1');
  t.mock.timers.tick(TTL + 50);
  const t0 = Date.now(); const served = await cachedRefresh(k, TTL, BOUND, slow);                       // does not wait for the slow refresh
  assert.equal(served, 'v1', 'the visitor waited for the refresh instead of getting the previous value'); assert.equal(Date.now(), t0);
  assert.equal(loads, 2, 'no background refresh was started');
  release(); await tick(); await tick();
  assert.equal(await cachedRefresh(k, TTL, BOUND, async () => 'never'), 'v2', 'the next call did not get the refreshed value');
});
test('R3. concurrent callers just after expiry share ONE refresh and all get the old value', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key(); let loads = 0;
  await cachedRefresh(k, TTL, BOUND, async () => { loads++; return 'old'; }); t.mock.timers.tick(TTL + 1);
  const got = await Promise.all([1, 2, 3, 4, 5].map(() => cachedRefresh(k, TTL, BOUND, async () => { loads++; await tick(); return 'new'; })));
  assert.deepEqual(got, ['old', 'old', 'old', 'old', 'old']); assert.equal(loads, 2, 'five callers started more than one refresh');
});
test('R4. BOUNDED: past TTL + the bound the old entry is NOT served; the caller waits for a fresh read', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key();
  await cachedRefresh(k, TTL, BOUND, async () => 'old'); t.mock.timers.tick(TTL + BOUND + 1);
  assert.equal(await cachedRefresh(k, TTL, BOUND, async () => 'fresh'), 'fresh', 'data older than TTL + the bound was served');
  assert.equal(STALE_WHILE_REFRESH_MS, 60_000);
});
test('R4b. the edge: at exactly TTL the entry is served stale; at TTL + bound - 1 it is still served; at TTL + bound it is not', async (t) => {
  for (const [age, want] of [[TTL, 'old'], [TTL + BOUND - 1, 'old'], [TTL + BOUND, 'fresh']] as const) {
    t.mock.timers.enable({ apis: ['Date'], now: BASE + n * 10_000_000 }); const k = key();
    await cachedRefresh(k, TTL, BOUND, async () => 'old'); t.mock.timers.tick(age);
    assert.equal(await cachedRefresh(k, TTL, BOUND, async () => 'fresh'), want, `age ${age}`); await tick(); await tick(); t.mock.timers.reset();
  }
});
test('R5. a FAILING background refresh keeps serving the old value until it ages out (age is not extended), then the real error surfaces', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key();
  await cachedRefresh(k, TTL, BOUND, async () => 'old'); t.mock.timers.tick(TTL + 10);
  assert.equal(await cachedRefresh(k, TTL, BOUND, async () => { throw new Error('upstream down'); }), 'old'); await tick(); await tick();
  t.mock.timers.tick(30_000); assert.equal(await cachedRefresh(k, TTL, BOUND, async () => { throw new Error('upstream down'); }), 'old', 'the old value stopped being served before it aged out');
  t.mock.timers.tick(BOUND);                                                                                    // now past TTL + bound since the ORIGINAL fetch
  await assert.rejects(cachedRefresh(k, TTL, BOUND, async () => { throw new Error('upstream down'); }), /upstream down/, 'the failure never surfaced: stale data is being served for ever');
});
test('R6. cachedRefresh and cached share one store: a value cached by cached() is served stale by cachedRefresh, and vice versa', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BASE }); const k = key();
  await cached(k, TTL, async () => 'via-cached'); t.mock.timers.tick(TTL + 1);
  assert.equal(await cachedRefresh(k, TTL, BOUND, async () => 'refreshed'), 'via-cached');
});

test('X1-X2. a non-exchange upstream gets a deadline signal; a caller\'s own signal wins; an exchange URL is not given the non-exchange deadline', async () => {
  const realFetch = globalThis.fetch; const seen: { url: string; signal: AbortSignal | null | undefined }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(input), signal: init?.signal }); return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    await exchangeFetch('https://api.alternative.me/fng/'); const s = seen.at(-1)!.signal;
    assert.ok(s instanceof AbortSignal, 'a non-exchange read has no deadline: a slow upstream holds the skeleton for as long as the platform allows'); assert.equal(s!.aborted, false);
    const own = new AbortController(); await exchangeFetch('https://api.alternative.me/fng/', { signal: own.signal }); assert.equal(seen.at(-1)!.signal, own.signal, 'the caller\'s own signal was replaced');
    const src = readFileSync(new URL('../lib/exchangeGuard.ts', import.meta.url), 'utf8'); assert.ok(src.includes('const NON_EXCHANGE_TIMEOUT_MS = 5_000;'), 'the non-exchange deadline is not 5 s');
  } finally { globalThis.fetch = realFetch; }
});

const SHELL = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ra = SHELL.indexOf('const DATA_FREE_ROUTES = ['); assert.ok(ra > 0, 'CONTROL: DATA_FREE_ROUTES not found');
const rb = SHELL.indexOf('\n', SHELL.indexOf('const isDataFree =', ra));
/* the slice is OUR OWN checked-in source, never input */
const isDataFree = new Function(`${stripTypeScriptTypes(SHELL.slice(ra, rb))}\nreturn isDataFree;`)() as (p: string) => boolean;
const DATA_FREE = ['/about', '/faq', '/privacy', '/terms', '/changelog', '/help', '/learn', '/contact', '/disclaimer', '/refund', '/security', '/accessibility', '/status', '/offline'];

test('D1. every one of the 14 data-free pages (and the same with a trailing slash) skips the provider', () => {
  for (const p of DATA_FREE) { assert.equal(isDataFree(p), true, p); assert.equal(isDataFree(p + '/'), true, p + '/'); }
  assert.deepEqual([...SHELL.matchAll(/'(\/[a-z]+)'/g)].map((m) => m[1]).filter((p) => DATA_FREE.includes(p)).sort(), [...DATA_FREE].sort(), 'the list in the source is not exactly these 14 pages');
});
test('D2. an OPT-OUT list: every data page keeps its data (/, dashboard, arena, markets, liq, scanner, funding, briefing, journal, alerts, settings, login) and sub-paths are not matched', () => {
  for (const p of ['/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/briefing', '/journal', '/alerts', '/settings', '/login', '/correlation', '/research', '/news', '/upgrade', '/new-page-nobody-listed', '/about/team', '/faq/extra', '/aboutus']) assert.equal(isDataFree(p), false, `${p} lost its market data`);
});
test('D3. the provider runs when the chat asked for it or the page is not data-free; opening the chat fires the event the shell listens for', () => {
  assert.ok(SHELL.includes('<MarketProvider enabled={marketNeeded || !isDataFree(pathname)}>'), 'the provider switch is not marketNeeded || not data-free');
  assert.ok(SHELL.includes('window.addEventListener(MARKET_DATA_NEEDED_EVENT, on);') && SHELL.includes('return () => window.removeEventListener(MARKET_DATA_NEEDED_EVENT, on);'), 'the shell no longer listens (or leaks its listener)');
  assert.ok(readFileSync(new URL('../components/GrokChat.tsx', import.meta.url), 'utf8').includes('if (open) window.dispatchEvent(new Event(MARKET_DATA_NEEDED_EVENT));'), 'opening the chat on a data-free page no longer starts the market data (the chat would answer from an empty store)');
  assert.equal(readFileSync(new URL('../lib/marketDataNeeded.ts', import.meta.url), 'utf8').includes("'market-data-needed'"), true);
});

test('P1. the proxy: the 3 s primary deadline exists ONLY for a type with a Bybit fallback, a throwing primary falls to the fallback, and without one the original error is rethrown', () => {
  const s = readFileSync(new URL('../app/api/proxy/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(s.includes('const FALLBACK_AFTER_MS = 3_000;'), 'the fallback threshold changed');
  assert.ok(s.includes("...(fbUrl ? { signal: AbortSignal.timeout(FALLBACK_AFTER_MS) } : {})"), 'a type WITHOUT a fallback now gets the 3 s deadline (it would fail where it used to wait)');
  assert.ok(s.includes('if (!fbUrl) throw e;') && s.includes('primaryFailure = e;'), 'a primary that throws no longer falls to the fallback, or a fallback-less type swallows its error');
  assert.ok(s.includes('primaryFailure instanceof Error ? primaryFailure : new Error(`${type} upstream unreachable`)'), 'the original error is not what surfaces when both fail');
});
