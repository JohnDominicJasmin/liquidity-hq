/* QA: PR #2740 (#1651, PM route audit 2026-11-20), the routes answer the LAST GOOD value, not a 5xx or a default, when their upstream fails. PM's priority: a kill switch must never turn itself off.
 *
 * THE WRITTEN RULES (Dev's list, literals from the PR body):
 *   (1) /api/config keeps the LAST KNOWN maintenance / banner / kill-switch state on a DB error: after a good read a failed read answers the last known config; the safe default ONLY if it was never read; a banner past `expiresAt` is dropped
 *   (2) /api/grok GET and /api/grok-chat GET answer 503 USAGE_UNAVAILABLE on a usage-read DB error (was 200 with every count 0)
 *   (3) /api/cmc: a timeout, network error or non-JSON body answers the last good value (x-data-stale), like a CMC error body already did
 *   (4) /api/forex/jpy (6 h, stale:true + ageSeconds), /api/macro (6 h, the quote's own asOf), /api/cycle (X-Data-Stale), /api/proxy slow types (llama-stables 24 h, deribit-book 1 h, funding-history and funding-rate-1 6 h; x-data-stale + x-data-age-ms), /api/market/snapshot (all sections failed, up to 10 min) and /api/market/rsi (both groups failed: slow 1 h, 5m 10 min) serve the last good with a stale marker when the upstream fails; with no good read the error is the same as before
 *   (5) healthy paths are unchanged: same body, same status, same headers for a good read
 *
 * THE REAL ROUTE HANDLERS RUN HERE (`GET` imported from each route file, called with real NextRequests). Only the network is a stand-in: `globalThis.fetch` answers Supabase (a signed token, the usage row, app_config, the plan), the market hosts (_marketStandIn), CoinMarketCap, Yahoo, the rate provider, Bybit and the slow proxy hosts, each with a mode that makes it fail. Nothing reaches a real host: an unknown origin throws. The clock is Node's mocked Date, so "past the TTL" and "6 h later" are exact; module state (the caches, the failure holds, the config's last known) lives for the whole file, so the tests run IN ORDER on one advancing clock and every "never read" case is placed before the first good read of its route.
 *   C0-C9   config: never read -> the safe default (both failure shapes, retried after 5 s); a good read is served 15 s with no header; a failed read after a good one answers it (maintenance ON stays ON, a kill switch OFF stays OFF, both directions, after 24 h too); a banner past its expiry is dropped (the boundary is "<= now"), one without an expiry never; the next good read replaces the last known; an empty table is still a good read; a THROWN read (the admin client cannot be built) answers the last known too
 *   G1-G6   grok and grok-chat GET: a good read answers the real counts; no row yet is 200 with zeros; a usage DB error (HTTP 500 or a network error) is 503 USAGE_UNAVAILABLE, never 200 with zeros; an unreadable PLAN alone is still 200 (the Pro numbers)
 *   M1-M7   cmc: a good read; abort / network error / non-JSON / error_code body after the TTL answers the last good; the hold keeps it off the upstream; never read -> 502 unavailable; older than 6 h -> 502
 *   J1-J6   forex/jpy: never read -> 502; good read; both sources down -> the last good, stale + age; the er-api fallback is not stale; 6 h bound
 *   Y1-Y6   macro: never read -> null per series; good read; Yahoo failing -> the last quote per series (all three failure shapes); one series failing does not freeze the others; 6 h bound
 *   Z1-Z5   cycle: never read -> 500; good read; failed refresh -> the last curve with X-Data-Stale (each failure shape); recovery is automatic
 *   P1-P8   proxy: the four slow types serve the last good with both headers, each at its own bound; a type without serveStaleMs and a cursor request still fail; never read -> 502; a healthy read is unchanged
 *   S1-S5   market/snapshot: never read -> 502; good read; part-failed is NOT stale; every section failed -> the last good, flagged, ts the real age; 10 min bound
 *   B1-B2   MarketProvider.fetchStablecoinFlows (cut out of the component by brace matching and run): a non-OK answer from the proxy keeps the last supply (the store is not written); a good answer writes it; a 200 with a missing coin still writes null (unchanged)
 *   R1-R5   market/rsi: the all-groups-failed merge (mergeRsiGroups, real): both kept, the 5m group only for a Pro caller and only to 10 min, the slow group to 1 h, nothing kept -> the same error; the real route after a total outage
 * WHAT THIS CANNOT PROVE: the real upstreams' behaviour (no host is called), that a page renders the stale marker (the browser cells in qa/e2e), and the POST paths of grok / grok-chat (paid: nothing here calls xAI). */
import test, { after, afterEach, beforeEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { NextRequest } from 'next/server';
import { isMarketHost, marketStandIn } from './_marketStandIn.mts';

/* Sentry, stood in for: lib/apiError.ts imports it and its Node entry has no captureException (same stand-in as macroForexUpstreamCount). */
const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

/* THE CMC ROUTE CANNOT BE LOADED AS IT IS: Node's strip-only mode refuses its `constructor(public readonly body)` parameter property (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX), and no test has ever imported it. This load hook compiles exactly that one file with the repo's own TypeScript (transpileModule); the file is not edited or copied, so the handler under test is the real one. */
const compileStub = `import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
  const ts = createRequire(pathToFileURL(process.cwd() + '/package.json').href)('typescript');
  export async function load(url, context, next) {
    if (url.endsWith('/app/api/cmc/route.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(compileStub));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.GROK_API_KEY = 'placeholder-xai'; process.env.CMC_API_KEY = 'placeholder-cmc';
const UID = '77777777-7777-4777-8777-777777777777'; const EMAIL = 'qa@example.test';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const dbDown = () => json(500, { code: 'XX000', message: 'stand-in: db down', details: '', hint: '' });

/* the clock: one file-wide mocked Date, ticked forward */
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
mock.timers.enable({ apis: ['Date'], now: T0 });
const tick = (ms: number) => mock.timers.tick(ms);
const MIN = 60_000, HOUR = 3_600_000;

/* ---- a token, signed here (the same way aiUnknownPlan does) ---- */
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: now, exp: now + 600 }));
  return `${h}.${p}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}

/* ---- the stand-in network ---- */
type Mode = 'ok' | 'http500' | 'network';
type Row = { key: string; value: unknown };
const net = {
  /* Supabase */
  config: { mode: 'ok' as Mode, rows: [] as Row[], reads: 0 },
  usage: { mode: 'ok' as Mode, row: null as Record<string, number> | null },
  plan: 'free' as 'free' | 'pro' | 'down',
  /* CoinMarketCap */
  cmc: { mode: 'ok' as 'ok' | 'abort' | 'network' | 'notjson' | 'http500' | 'errcode', calls: 0, global: { status: { error_code: 0 }, data: { btc_dominance: 58.1 } } as unknown, altseason: { status: { error_code: 0 }, data: [{ symbol: 'BTC' }, { symbol: 'ETH' }] } as unknown },
  /* forex/jpy and macro (Yahoo, er-api, FRED) */
  jpy: { yahoo: 'ok' as Mode, er: 'ok' as Mode, price: 150.5, time: 1_800_000_000, erRate: 149.9, erTime: 1_799_990_000, calls: 0 },
  macro: { mode: {} as Record<string, Mode | 'noPrice'>, price: {} as Record<string, number>, calls: {} as Record<string, number> },
  /* Bybit weekly candles for the cycle route */
  cycle: { mode: 'ok' as 'ok' | 'http500' | 'network' | 'retcode' | 'empty', closes: [60000, 66000, 72000, 48000], calls: 0 },
  /* the slow proxy types, by type */
  proxy: { mode: {} as Record<string, Mode>, version: 1, calls: {} as Record<string, number> },
  /* every other market host (snapshot, RSI) */
  market: 'ok' as 'ok' | 'down',
  stray: [] as string[], gaps: [] as string[],
};
const YAHOO_LABEL: Record<string, string> = { 'CL%3DF': 'oil', 'DX-Y.NYB': 'dxy', '%5EGSPC': 'spx', 'GC%3DF': 'gold', 'JPY%3DX': 'jpy', '%5ETNX': 'tnx' };
const SERIES = ['oil', 'dxy', 'spx', 'gold', 'jpy', 'tnx'] as const;
for (const s of SERIES) { net.macro.mode[s] = 'ok'; net.macro.price[s] = 200; net.macro.calls[s] = 0; }
const MACRO_PREV = 160, MACRO_TIME = 1_800_000_100;
const HALVING_MS = Date.UTC(2024, 3, 20);
const WEEK = 7 * 86_400_000;
const llamaBody = (v: number) => ({ peggedAssets: [
  { symbol: 'USDT', circulating: { peggedUSD: 100 * v }, circulatingPrevWeek: { peggedUSD: 90 * v }, circulatingPrevMonth: { peggedUSD: 80 * v }, name: 'Tether', chains: ['x'] },
  { symbol: 'DAI', circulating: { peggedUSD: 5 }, circulatingPrevWeek: { peggedUSD: 5 }, circulatingPrevMonth: { peggedUSD: 5 }, name: 'Dai' },
] });
const llamaTrimmed = (v: number) => ({ peggedAssets: [{ symbol: 'USDT', circulating: { peggedUSD: 100 * v }, circulatingPrevWeek: { peggedUSD: 90 * v }, circulatingPrevMonth: { peggedUSD: 80 * v } }] });
const proxyBody = (type: string, v: number): unknown =>
  type === 'llama-stables' ? llamaBody(v)
  : type === 'deribit-book' ? { jsonrpc: '2.0', result: [{ instrument_name: 'BTC-1JAN27-100000-C', mark_price: 0.01 * v, volume: 5, open_interest: 7, mark_iv: 50 + v, underlying_price: 60000 }] }
  : type === 'funding-history' ? { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', fundingRate: `0.0001${v}`, fundingRateTimestamp: '1800000000000' }] } }
  : type === 'funding-rate-1' ? [{ symbol: 'BTCUSDT', fundingRate: `0.0002${v}`, fundingTime: 1800000000000 }]
  : { retCode: 0, result: { list: [{ openInterest: `100${v}`, timestamp: '1800000000000' }] } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  await new Promise((r) => setImmediate(r)); // a real await, so concurrent callers overlap

  if (url.origin === SUPABASE) {
    const p = url.pathname;
    const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
    if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
    if (p.endsWith('app_config')) {
      if (!url.search.includes('key=in.')) return json(200, []);            // feature_flags read (lib/featureFlags), not the config route's
      net.config.reads++;
      if (net.config.mode === 'network') throw new TypeError('fetch failed');
      if (net.config.mode === 'http500') return dbDown();
      return json(200, net.config.rows);
    }
    if (p.endsWith('grok_usage') && req.method === 'GET') {
      if (net.usage.mode === 'network') throw new TypeError('fetch failed');
      if (net.usage.mode === 'http500') return dbDown();
      return net.usage.row ? one(net.usage.row) : json(200, []);
    }
    if (p.endsWith('user_status')) return one({ banned: false });
    if (p.endsWith('user_subscriptions')) {
      if (net.plan === 'down') return json(500, { message: 'stand-in: subscription read failed' });
      return one(net.plan === 'free' ? { role: 'free', trial_ends_at: null, current_period_end: null } : { role: 'pro', trial_ends_at: null, current_period_end: '2099-01-01T00:00:00.000Z' });
    }
    if (req.method === 'GET') return json(200, []);
    return new Response(null, { status: 201 });
  }

  if (url.host === 'pro-api.coinmarketcap.com') {
    net.cmc.calls++;
    const m = net.cmc.mode;
    if (m === 'abort') throw new DOMException('The operation was aborted.', 'AbortError');
    if (m === 'network') throw new TypeError('fetch failed');
    if (m === 'notjson') return new Response('<html>Bad gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (m === 'http500') return json(500, { status: { error_code: 500, error_message: 'stand-in: cmc down' } });
    if (m === 'errcode') return json(200, { status: { error_code: 1008, error_message: 'stand-in: rate limit' } });
    return json(200, url.pathname.includes('global-metrics') ? net.cmc.global : net.cmc.altseason);
  }

  if (url.host === 'query1.finance.yahoo.com') {
    const last = url.pathname.split('/').pop()!;
    if (last === 'JPY%3DX' && url.search.includes('interval=1m')) {   // forex/jpy's own read (macro reads JPY=X on a daily interval)
      net.jpy.calls++;
      if (net.jpy.yahoo === 'network') throw new TypeError('fetch failed');
      if (net.jpy.yahoo === 'http500') return new Response('down', { status: 500 });
      return json(200, { chart: { result: [{ meta: { regularMarketPrice: net.jpy.price, regularMarketTime: net.jpy.time } }] } });
    }
    const label = YAHOO_LABEL[last];
    if (!label) { net.stray.push(`yahoo ${url.pathname}`); return new Response('unknown symbol', { status: 404 }); }
    net.macro.calls[label]++;
    const m = net.macro.mode[label];
    if (m === 'network') throw new TypeError('fetch failed');
    if (m === 'http500') return new Response('upstream down', { status: 500 });
    if (m === 'noPrice') return json(200, { chart: { result: [{ meta: {} }] } });
    return json(200, { chart: { result: [{ meta: { regularMarketPrice: net.macro.price[label], previousClose: MACRO_PREV, regularMarketTime: MACRO_TIME } }] } });
  }
  if (url.host === 'open.er-api.com') {
    if (net.jpy.er === 'network') throw new TypeError('fetch failed');
    if (net.jpy.er === 'http500') return new Response('down', { status: 500 });
    return json(200, { rates: { JPY: net.jpy.erRate }, time_last_update_unix: net.jpy.erTime });
  }
  if (url.host === 'fred.stlouisfed.org') return new Response('observation_date,DFII10\n2026-11-18,1.80\n2026-11-19,1.85\n', { status: 200 });

  /* cycle: Bybit weekly candles, newest first, as strings */
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/kline' && url.searchParams.get('interval') === 'W') {
    net.cycle.calls++;
    const m = net.cycle.mode;
    if (m === 'network') throw new TypeError('fetch failed');
    if (m === 'http500') return new Response('down', { status: 500 });
    if (m === 'retcode') return json(200, { retCode: 10001, retMsg: 'stand-in: params error', result: {} });
    if (m === 'empty') return json(200, { retCode: 0, result: { list: [] } });
    const list = net.cycle.closes.map((c, i) => [String(HALVING_MS + i * WEEK), String(c), String(c), String(c), String(c), '1', '1']).reverse();
    return json(200, { retCode: 0, result: { list } });
  }

  /* the slow proxy types, each with its own switch */
  const proxyType = url.host === 'stablecoins.llama.fi' ? 'llama-stables'
    : url.host === 'www.deribit.com' ? 'deribit-book'
    : url.host === 'api.bybit.com' && url.pathname === '/v5/market/funding/history' ? 'funding-history'
    : url.host === 'fapi.binance.com' && url.pathname === '/fapi/v1/fundingRate' ? 'funding-rate-1'
    : url.host === 'api.bybit.com' && url.pathname === '/v5/market/open-interest' ? 'open-interest-1' : null;
  if (proxyType) {
    net.proxy.calls[proxyType] = (net.proxy.calls[proxyType] ?? 0) + 1;
    const m = net.proxy.mode[proxyType] ?? 'ok';
    if (m === 'network') throw new TypeError('fetch failed');
    if (m === 'http500') return new Response('down', { status: 500 });
    return json(200, proxyBody(proxyType, net.proxy.version));
  }

  /* every other market host: the shared market stand-in, or a plain 500 */
  if (isMarketHost(url.host)) {
    if (net.market === 'down') return new Response('stand-in: exchange down', { status: 500 });
    const hit = marketStandIn(req, url, { gap: (g) => net.gaps.push(g) });
    if (hit) return hit;
  }
  net.stray.push(url.host);
  throw new Error(`stray request ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

/* THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS (#1683): a top-level `await import` suspends this module, so a late registration would let after() restore the real fetch under a running test. */
const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

/* console noise is recorded, not printed: the routes log every failure, and "a non-CmcError is still logged" is itself an assertion */
const logs = { error: [] as string[] };
mock.method(console, 'log', () => {});
mock.method(console, 'warn', () => {});
mock.method(console, 'error', (...a: unknown[]) => { logs.error.push(a.map(String).join(' ')); });

const { GET: configGET } = await import('../app/api/config/route.ts');
const { GET: grokGET } = await import('../app/api/grok/route.ts');
const { GET: chatGET } = await import('../app/api/grok-chat/route.ts');
const { GET: cmcGET } = await import('../app/api/cmc/route.ts');
const { GET: jpyGET } = await import('../app/api/forex/jpy/route.ts');
const { GET: macroGET } = await import('../app/api/macro/route.ts');
const { GET: cycleGET } = await import('../app/api/cycle/route.ts');
const { GET: proxyGET } = await import('../app/api/proxy/route.ts');
const { GET: snapshotGET } = await import('../app/api/market/snapshot/route.ts');
const { GET: rsiGET } = await import('../app/api/market/rsi/route.ts');
const { mergeRsiGroups } = await import('../lib/marketRsi.ts');
const { cached } = await import('../lib/apiCache.ts');
const { polledCacheControl } = await import('../lib/cacheHeaders.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
afterEach(() => { _resetApiHealthQueue(); assert.deepEqual(net.stray, [], `a request went somewhere unexpected: ${net.stray.join(', ')}`); });

let ip = 0;
const headersOf = (extra: Record<string, string> = {}) => ({ 'cf-connecting-ip': `198.51.100.${(ip++ % 250) + 1}-${ip}`, ...extra });
const req = (path: string, extra: Record<string, string> = {}) => new NextRequest(`https://qa.invalid${path}`, { headers: headersOf(extra) });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
type Res = { status: number; body: any; h: (n: string) => string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = async (r: Response): Promise<Res> => ({ status: r.status, body: await r.json(), h: (n) => r.headers.get(n) });
const DEFAULT_CONFIG = { maintenanceMode: false, announcementBanner: null, featureFlags: { grok: true, telegram: true } };

/* ═══════════════════════════ /api/config ═══════════════════════════ */

const cfg = async () => read(await configGET());
const iso = (ms: number) => new Date(ms).toISOString();
const cfgRows = (o: { maintenance?: boolean; banner?: { text: string; link?: string | null; expiresAt?: string | null }; flags?: { grok?: boolean; telegram?: boolean } }): Row[] => [
  ...(o.maintenance === undefined ? [] : [{ key: 'maintenance_mode', value: { enabled: o.maintenance } }]),
  ...(o.banner ? [{ key: 'announcement_banner', value: o.banner }] : []),
  ...(o.flags ? [{ key: 'feature_flags', value: o.flags }] : []),
];
/* a fresh read on every call: the previous answer's life (15 s good, 5 s failed) is spent first */
const coldCfg = async () => { tick(15_100); return cfg(); };

test('C0. NEVER READ: a failed read answers the safe default (both failure shapes), is asked again after 5 s, and never invents maintenance or a banner', async () => {
  net.config.mode = 'http500'; net.config.reads = 0;
  const a = await cfg();
  assert.equal(a.status, 200); assert.deepEqual(a.body, DEFAULT_CONFIG, 'a process that never had a good read must answer the safe default');
  tick(4_900); await cfg(); assert.equal(net.config.reads, 1, 'a failed read is asked again inside 5 s');
  tick(200); await cfg(); assert.equal(net.config.reads, 2, 'not asked again after 5 s: a failed read is wedged');
  /* a network error is retried by supabase-js itself (about 7 s, several attempts per read), so only the ANSWER is asserted for it, not a read count */
  net.config.mode = 'network'; tick(5_100);
  const b = await cfg(); assert.deepEqual(b.body, DEFAULT_CONFIG, 'a network error with no good read must also answer the default');
  assert.ok(logs.error.some((l) => l.includes('/api/config') && l.includes('last known')), 'the failure is not logged');
});

test('C1. HEALTHY PATH: a good read answers the stored state exactly, is held 15 s with no second read, carries no cache header, and the read is real after 15 s', async () => {
  net.config.mode = 'ok'; tick(5_100);
  const banner = { text: 'Maintenance tonight', link: 'https://example.test/status', expiresAt: iso(Date.now() + 2 * HOUR) };
  net.config.rows = cfgRows({ maintenance: true, banner, flags: { grok: false, telegram: true } }); net.config.reads = 0;
  const a = await cfg();
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { maintenanceMode: true, announcementBanner: banner, featureFlags: { grok: false, telegram: true } });
  assert.equal(a.h('cache-control'), null, 'the config answer gained a cache header');
  tick(14_900); await cfg(); assert.equal(net.config.reads, 1, 'a read inside the 15 s life');
  tick(200); await cfg(); assert.equal(net.config.reads, 2, 'no fresh read after 15 s: the switches would be stale');
});

test('C2. THE KILL SWITCH: after a good read a failed read answers the LAST KNOWN config (maintenance ON stays ON, grok OFF stays OFF, the banner stays), for an HTTP error and a network error', async () => {
  const known = { maintenanceMode: true, announcementBanner: { text: 'Maintenance tonight', link: 'https://example.test/status', expiresAt: (await cfg()).body.announcementBanner.expiresAt }, featureFlags: { grok: false, telegram: true } };
  for (const shape of ['http500', 'network'] as const) {
    net.config.mode = shape; tick(15_100);
    const f = await cfg();
    assert.equal(f.status, 200, `${shape}: a failed read must still answer 200`);
    assert.deepEqual(f.body, known, `${shape}: a failed read must answer the last known config, not the safe default (maintenance would silently turn OFF and grok back ON)`);
    assert.equal(f.body.maintenanceMode, true); assert.equal(f.body.featureFlags.grok, false);
  }
});

test('C3. BOTH DIRECTIONS: a failed read never SWITCHES a flag either way - the last known OFF telegram stays OFF and maintenance OFF stays OFF; the newest good read replaces the older one', async () => {
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: false, flags: { grok: true, telegram: false } });
  const good = await coldCfg();
  assert.deepEqual(good.body, { maintenanceMode: false, announcementBanner: null, featureFlags: { grok: true, telegram: false } });
  net.config.mode = 'http500';
  const f = await coldCfg();
  assert.deepEqual(f.body, { maintenanceMode: false, announcementBanner: null, featureFlags: { grok: true, telegram: false } }, 'the failed read answered neither the default (telegram back ON) nor the OLDER good read (maintenance ON, grok OFF)');
  assert.equal(f.body.featureFlags.telegram, false, 'a kill switch turned itself back ON on a failed read');
});

test('C4. the failed answer is held 5 s (no read inside it), the next read after 5 s hits the database, and a heal answers the NEW state at once', async () => {
  net.config.mode = 'http500'; await coldCfg(); const r0 = net.config.reads;
  tick(4_900); await cfg(); assert.equal(net.config.reads, r0, 'a failed read was asked again inside 5 s');
  tick(200); await cfg(); assert.equal(net.config.reads, r0 + 1, 'a failed read was not asked again after 5 s');
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: true, flags: { grok: true, telegram: true } }); tick(5_100);
  const healed = await cfg();
  assert.deepEqual(healed.body, { maintenanceMode: true, announcementBanner: null, featureFlags: { grok: true, telegram: true } }, 'the healed read did not replace the last known state');
});

test('C5. a banner past its expiry is DROPPED from the last-known answer, the rest is kept; the boundary is "<= now"; a banner with no expiry never expires', async () => {
  /* five reads, each: a good read with a banner, then a failure at a chosen time */
  const scenario = async (expiresIn: number | null, failAfter: number) => {
    net.config.mode = 'ok';
    net.config.rows = cfgRows({ maintenance: true, banner: { text: 'Planned work', link: null, expiresAt: expiresIn === null ? null : iso(Date.now() + 15_100 + expiresIn) }, flags: { grok: false, telegram: true } });
    const good = await coldCfg(); const goodAt = Date.now();
    net.config.mode = 'http500'; tick(Math.max(15_100, failAfter));
    const f = await cfg(); return { good, f, sinceGood: Date.now() - goodAt };
  };
  /* (a) expiry still ahead at the failure: kept */
  { const { good, f } = await scenario(60 * MIN, 20_000);
    assert.equal(good.body.announcementBanner.text, 'Planned work'); assert.deepEqual(f.body.announcementBanner, good.body.announcementBanner, 'a banner that has NOT expired was dropped from the last-known answer'); }
  /* (b) expiry passed by the failure: dropped, maintenance and the flags untouched */
  { const { good, f } = await scenario(10_000, 30_000);
    assert.equal(good.body.announcementBanner.text, 'Planned work'); assert.equal(f.body.announcementBanner, null, 'a banner past its expiry was served from the last-known answer');
    assert.equal(f.body.maintenanceMode, true, 'dropping the banner dropped maintenance too'); assert.deepEqual(f.body.featureFlags, { grok: false, telegram: true }, 'dropping the banner changed a kill switch'); }
  /* (c) the boundary: expiresAt == now is expired, one ms ahead is not */
  { net.config.mode = 'ok'; const at = Date.now() + 15_100 + 20_000;
    net.config.rows = cfgRows({ maintenance: false, banner: { text: 'Edge', link: null, expiresAt: iso(at) } });
    await coldCfg(); net.config.mode = 'http500'; tick(at - Date.now()); assert.equal(Date.now(), at);
    assert.equal((await cfg()).body.announcementBanner, null, 'expiresAt == now must be dropped (the rule is "<= now")'); }
  { net.config.mode = 'ok'; const at = Date.now() + 15_100 + 20_000;
    net.config.rows = cfgRows({ maintenance: false, banner: { text: 'Edge', link: null, expiresAt: iso(at) } });
    await coldCfg(); net.config.mode = 'http500'; tick(at - 1 - Date.now()); assert.equal(Date.now(), at - 1);
    assert.equal((await cfg()).body.announcementBanner?.text, 'Edge', 'a banner one ms before its expiry was dropped'); }
  /* (d) no expiry: kept for ever */
  { const { good, f } = await scenario(null, 7 * 24 * HOUR);
    assert.equal(good.body.announcementBanner.expiresAt, null); assert.deepEqual(f.body.announcementBanner, good.body.announcementBanner, 'a banner with no expiry vanished on a failed read'); }
});

test('C6. the last known state has no age limit: maintenance ON is still ON after 24 hours of a failing database', async () => {
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: true, flags: { grok: false, telegram: false } });
  await coldCfg(); net.config.mode = 'http500';
  for (let i = 0; i < 4; i++) { tick(6 * HOUR); const f = await cfg(); assert.deepEqual(f.body, { maintenanceMode: true, announcementBanner: null, featureFlags: { grok: false, telegram: false } }, `after ${6 * (i + 1)} h`); }
});

test('C7. HEALTHY PATH: an expired banner is dropped on a good read as before, and a banner with a missing text is no banner', async () => {
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: false, banner: { text: 'Old news', link: null, expiresAt: iso(Date.now() - 1_000) } });
  assert.equal((await coldCfg()).body.announcementBanner, null, 'a good read served an expired banner');
  net.config.rows = cfgRows({ maintenance: false, banner: { text: '', link: 'https://example.test', expiresAt: null } });
  assert.equal((await coldCfg()).body.announcementBanner, null, 'an empty banner text became a banner');
});

test('C8. HEALTHY PATH: an empty table is a read (the defaults, not a failure), and it replaces the earlier last known state', async () => {
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: true });
  assert.equal((await coldCfg()).body.maintenanceMode, true);
  net.config.rows = [];
  const empty = await coldCfg(); assert.deepEqual(empty.body, DEFAULT_CONFIG);
  net.config.mode = 'http500';
  assert.deepEqual((await coldCfg()).body, DEFAULT_CONFIG, 'the failed read answered the state from BEFORE the last good read');
  net.config.mode = 'ok'; net.config.rows = [];
});

test('C9. a THROWN read (the admin client cannot be built: env missing) is a failure too: it answers the last known config, not the safe default', async () => {
  net.config.mode = 'ok'; net.config.rows = cfgRows({ maintenance: true, flags: { grok: false, telegram: true } });
  assert.equal((await coldCfg()).body.maintenanceMode, true);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; logs.error.length = 0;
  try {
    const f = await coldCfg();
    assert.deepEqual(f.body, { maintenanceMode: true, announcementBanner: null, featureFlags: { grok: false, telegram: true } }, 'a thrown read answered the safe default: maintenance turned OFF and grok back ON');
    assert.ok(logs.error.some((l) => l.includes('/api/config read failed')), 'the thrown read was not logged');
  } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = key; }
  net.config.rows = [];
});

/* ═══════════════════ /api/grok GET and /api/grok-chat GET ═══════════════════ */

const authed = async (path: string) => req(path, { authorization: `Bearer ${await token()}` });
const grok = async () => read(await grokGET(await authed('/api/grok')));
const chat = async () => read(await chatGET(await authed('/api/grok-chat')));
const USAGE_ROW = { deep_count: 2, quick_count: 1, chat_count: 3, chat_search_count: 1, briefing_count: 1, tool_pool_count: 4 };

test('G1. HEALTHY PATH, /api/grok GET: a good read answers 200 with the REAL counts and the plan limits (Free, then Pro)', async () => {
  net.usage.mode = 'ok'; net.usage.row = USAGE_ROW; net.plan = 'free';
  const a = await grok();
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { usage: { deep_used: 2, deep_limit: 3, quick_used: 1, quick_limit: 5, chat_used: 3, chat_limit: 5, search_used: 1, search_limit: 3, briefing_used: 1, briefing_limit: 2, tool_pool_used: 4, tool_pool_limit: 0 } });
  net.plan = 'pro';
  const p = await grok();
  assert.deepEqual(p.body, { usage: { deep_used: 2, deep_limit: 10, quick_used: 1, quick_limit: 30, chat_used: 3, chat_limit: 50, search_used: 1, search_limit: 10, briefing_used: 1, briefing_limit: 4, tool_pool_used: 4, tool_pool_limit: 25 } });
});

test('G2. /api/grok GET: a usage DB error (HTTP 500, and a network error) is 503 USAGE_UNAVAILABLE with usage null - never 200 with every count at 0', async () => {
  net.plan = 'free'; net.usage.row = USAGE_ROW;
  for (const shape of ['http500', 'network'] as const) {
    net.usage.mode = shape;
    const f = await grok();
    assert.equal(f.status, 503, `${shape}: a failed usage read answered ${f.status}`);
    assert.deepEqual(f.body, { usage: null, error: 'USAGE_UNAVAILABLE' }, `${shape}: the body must say unavailable, not carry counts`);
    assert.equal(JSON.stringify(f.body).includes('deep_used'), false, `${shape}: zero counts were served for an unknown usage`);
  }
});

test('G3. /api/grok GET, the other direction: NO ROW YET (a new user) is a real zero - 200 with every count 0 - and an unreadable PLAN alone is still 200 with the Pro numbers (U7), not 503', async () => {
  net.usage.mode = 'ok'; net.usage.row = null; net.plan = 'free';
  const fresh = await grok();
  assert.equal(fresh.status, 200, 'a user with no usage row was refused: a real zero was read as an error');
  assert.deepEqual(fresh.body.usage, { deep_used: 0, deep_limit: 3, quick_used: 0, quick_limit: 5, chat_used: 0, chat_limit: 5, search_used: 0, search_limit: 3, briefing_used: 0, briefing_limit: 2, tool_pool_used: 0, tool_pool_limit: 0 });
  net.usage.row = USAGE_ROW; net.plan = 'down';
  const unknownPlan = await grok();
  assert.equal(unknownPlan.status, 200, 'an unreadable plan with a good usage row must not be a 503');
  assert.equal(unknownPlan.body.usage.deep_limit, 10, 'the unknown plan must show the Pro numbers (U7)'); assert.equal(unknownPlan.body.usage.deep_used, 2);
  net.plan = 'free';
});

test('G4. /api/grok GET: a signed-out caller is unchanged (200 usage null), and a failing usage table is not even read for them', async () => {
  net.usage.mode = 'http500';
  const out = await read(await grokGET(req('/api/grok')));
  assert.equal(out.status, 200); assert.deepEqual(out.body, { usage: null });
  net.usage.mode = 'ok';
});

test('G5. HEALTHY PATH, /api/grok-chat GET: a good read answers 200 with the real chat and search counts and the limits', async () => {
  net.usage.mode = 'ok'; net.usage.row = USAGE_ROW; net.plan = 'free';
  const a = await chat();
  assert.equal(a.status, 200); assert.deepEqual(a.body, { chat_used: 3, chat_limit: 5, search_used: 1, search_limit: 3 });
  net.plan = 'pro';
  assert.deepEqual((await chat()).body, { chat_used: 3, chat_limit: 50, search_used: 1, search_limit: 10 });
});

test('G6. /api/grok-chat GET: a usage DB error (HTTP 500 and a network error) is 503 USAGE_UNAVAILABLE, never 200 with zeros; no row yet is a real zero; an unreadable plan alone is 200 with the Pro limit', async () => {
  net.plan = 'free'; net.usage.row = USAGE_ROW;
  for (const shape of ['http500', 'network'] as const) {
    net.usage.mode = shape;
    const f = await chat();
    assert.equal(f.status, 503, `${shape}: a failed usage read answered ${f.status}`);
    assert.deepEqual(f.body, { error: 'USAGE_UNAVAILABLE' }, `${shape}: the body carried counts for an unknown usage`);
  }
  net.usage.mode = 'ok'; net.usage.row = null;
  const fresh = await chat(); assert.equal(fresh.status, 200); assert.deepEqual(fresh.body, { chat_used: 0, chat_limit: 5, search_used: 0, search_limit: 3 });
  net.usage.row = USAGE_ROW; net.plan = 'down';
  const unknownPlan = await chat(); assert.equal(unknownPlan.status, 200); assert.deepEqual(unknownPlan.body, { chat_used: 3, chat_limit: 50, search_used: 1, search_limit: 10 });
  net.plan = 'free';
});

/* ═══════════════════════════ /api/cmc ═══════════════════════════ */

const CMC_TTL = 5 * MIN, CMC_HOLD = 60_000;
const cmc = async (type: string) => read(await cmcGET(req(`/api/cmc?type=${type}`)));

test('M0. NEVER READ: with CoinMarketCap failing and no good read, the answer is the documented 502 unavailable (no body of theirs), for an abort and a non-JSON body', async () => {
  for (const mode of ['abort', 'notjson'] as const) {
    net.cmc.mode = mode; tick(CMC_HOLD + 1_000);
    const f = await cmc('altseason');
    assert.equal(f.status, 502, `${mode}: ${f.status}`); assert.deepEqual(f.body, { error: 'unavailable' });
    assert.equal(f.h('x-data-stale'), null, `${mode}: a stale marker with nothing to serve`);
  }
});

test('M1. HEALTHY PATH: a good read answers 200 with CMC\'s own body and the polled cache header, no stale marker; inside 5 minutes it is served from memory', async () => {
  net.cmc.mode = 'ok'; tick(CMC_HOLD + 1_000); net.cmc.calls = 0;
  const a = await cmc('global');
  assert.equal(a.status, 200); assert.deepEqual(a.body, net.cmc.global);
  assert.equal(a.h('cache-control'), polledCacheControl(300)); assert.equal(a.h('x-data-stale'), null); assert.equal(a.h('x-data-age-ms'), null);
  tick(CMC_TTL - 1_000); await cmc('global'); assert.equal(net.cmc.calls, 1, 'a call inside 5 minutes went to CoinMarketCap');
  const b = await cmc('altseason'); assert.deepEqual(b.body, net.cmc.altseason); assert.equal(b.h('x-data-stale'), null);
});

test('M2. an ABORT (the 8 s timeout) after the TTL answers the LAST GOOD with x-data-stale and its age, and the 60 s hold keeps the next calls off CoinMarketCap', async () => {
  net.cmc.mode = 'abort'; tick(2_000);                               // 5 min + 1 s since the good read
  net.cmc.calls = 0; logs.error.length = 0;
  const f = await cmc('global');
  assert.equal(f.status, 200, 'an aborted refresh answered a failure instead of the last good value');
  assert.deepEqual(f.body, net.cmc.global); assert.equal(f.h('x-data-stale'), '1');
  assert.equal(f.h('x-data-age-ms'), String(CMC_TTL + 1_000), 'the age header is not the real age of the good value');
  assert.equal(f.h('cache-control'), polledCacheControl(300));
  assert.equal(net.cmc.calls, 1);
  assert.ok(logs.error.some((l) => l.includes('[cmc] upstream failed')), 'a non-CmcError failure is not logged');
  tick(30_000); const again = await cmc('global'); assert.equal(net.cmc.calls, 1, 'the 60 s hold did not keep the next call off CoinMarketCap'); assert.equal(again.status, 200); assert.equal(again.h('x-data-stale'), '1');
});

test('M3. a network error and a non-JSON 200 body also answer the last good (they were rethrown to a 500 before); an error_code body and an HTTP 500 still do (unchanged)', async () => {
  for (const mode of ['network', 'notjson', 'errcode', 'http500'] as const) {
    net.cmc.mode = mode; tick(CMC_HOLD + 1_000); logs.error.length = 0;
    const f = await cmc('global');
    assert.equal(f.status, 200, `${mode}: answered ${f.status}`); assert.deepEqual(f.body, net.cmc.global, `${mode}: not the last good body`); assert.equal(f.h('x-data-stale'), '1', `${mode}: no stale marker`);
    const logged = logs.error.some((l) => l.includes('[cmc] upstream failed'));
    assert.equal(logged, mode === 'network' || mode === 'notjson', `${mode}: the "still logged" rule is wrong (a CMC error body is expected, anything else is logged)`);
  }
});

test('M4. a recovery is served fresh at once (no stale marker, the new body), altseason has its own last good, and the stale answer never replaced the stored entry', async () => {
  net.cmc.mode = 'ok'; net.cmc.global = { status: { error_code: 0 }, data: { btc_dominance: 61.7 } }; tick(CMC_HOLD + 1_000);
  const a = await cmc('global'); assert.deepEqual(a.body, net.cmc.global); assert.equal(a.h('x-data-stale'), null);
  net.cmc.mode = 'abort'; tick(CMC_TTL + 1_000);
  const alt = await cmc('altseason'); assert.equal(alt.status, 200); assert.deepEqual(alt.body, { status: { error_code: 0 }, data: [{ symbol: 'BTC' }, { symbol: 'ETH' }] }); assert.equal(alt.h('x-data-stale'), '1');
});

test('M5. THE 6 HOUR BOUND: a good value 6 h minus 1 ms old is served stale; at 6 h it is not (502), and a type never read still answers 502', async () => {
  net.cmc.mode = 'ok'; net.cmc.global = { status: { error_code: 0 }, data: { btc_dominance: 62.2 } }; tick(CMC_HOLD + 1_000);
  await cmc('global'); const goodAt = Date.now();
  net.cmc.mode = 'abort';
  tick(6 * HOUR - 1 - (Date.now() - goodAt)); assert.equal(Date.now() - goodAt, 6 * HOUR - 1);
  const edge = await cmc('global'); assert.equal(edge.status, 200, 'a value 6 h minus 1 ms old was refused'); assert.equal(edge.h('x-data-age-ms'), String(6 * HOUR - 1));
  tick(CMC_HOLD + 1_000);                                            // past the hold, now older than 6 h
  const old = await cmc('global'); assert.equal(old.status, 502, 'a value older than 6 h was served'); assert.deepEqual(old.body, { error: 'unavailable' });
});

test('M6. unchanged: an unknown type is 400 and the rate limit still answers 429', async () => {
  net.cmc.mode = 'ok';
  assert.equal((await cmc('nothing')).status, 400);
  const fixedIp = { 'cf-connecting-ip': '203.0.113.200' }; let last = 0;
  for (let i = 0; i < 121; i++) last = (await cmcGET(new NextRequest('https://qa.invalid/api/cmc?type=nothing', { headers: fixedIp }))).status;
  assert.equal(last, 429, 'the 120 per minute limit is gone');
});

/* ═══════════════════════════ /api/forex/jpy ═══════════════════════════ */

const jpy = async () => read(await jpyGET(req('/api/forex/jpy')));
const JPY_HOLD = 30_000, JPY_TTL = 60_000;

test('J0. NEVER READ: both sources down and no good read is the same 502 as before ("Upstream fetch failed"), with no stale marker', async () => {
  net.jpy.yahoo = 'http500'; net.jpy.er = 'http500';
  const f = await jpy();
  assert.equal(f.status, 502); assert.deepEqual(f.body, { error: 'Upstream fetch failed' }); assert.equal(f.h('x-data-stale'), null);
  tick(JPY_HOLD + 1_000);
  net.jpy.yahoo = 'network'; net.jpy.er = 'network'; assert.equal((await jpy()).status, 502, 'network errors with no good read');
});

test('J1. HEALTHY PATH: a good read answers {jpy, asOf, source} and nothing else, with the polled header; a stale marker never appears', async () => {
  net.jpy.yahoo = 'ok'; net.jpy.er = 'ok'; tick(JPY_HOLD + 1_000);
  const a = await jpy();
  assert.equal(a.status, 200); assert.deepEqual(a.body, { jpy: 150.5, asOf: 1_800_000_000_000, source: 'yahoo' }, 'the healthy body gained or lost a field');
  assert.equal(a.h('cache-control'), polledCacheControl(60)); assert.equal(a.h('x-data-stale'), null);
});

test('J2. BOTH SOURCES DOWN after the TTL: the LAST GOOD rate, 200, with stale true, its age in seconds, the rate\'s own asOf and source, no-store and x-data-stale; the hold keeps it off the upstream', async () => {
  net.jpy.yahoo = 'http500'; net.jpy.er = 'http500'; tick(JPY_TTL + 1_000);   // 61 s since the good read
  net.jpy.calls = 0;
  const f = await jpy();
  assert.equal(f.status, 200, 'both sources down answered a failure instead of the last good rate');
  assert.deepEqual(f.body, { jpy: 150.5, asOf: 1_800_000_000_000, source: 'yahoo', stale: true, ageSeconds: 61 });
  assert.equal(f.h('cache-control'), 'no-store'); assert.equal(f.h('x-data-stale'), '1');
  const calls = net.jpy.calls; tick(10_000);
  const again = await jpy(); assert.equal(net.jpy.calls, calls, 'the 30 s hold did not keep the next call off the upstream'); assert.equal(again.body.stale, true); assert.equal(again.body.ageSeconds, 71);
});

test('J3. the other direction: Yahoo down but er-api up is a GOOD read from the daily source (not stale, source er-api); a recovery is fresh again', async () => {
  net.jpy.yahoo = 'http500'; net.jpy.er = 'ok'; tick(JPY_HOLD + 1_000);
  const a = await jpy();
  assert.equal(a.status, 200); assert.deepEqual(a.body, { jpy: 149.9, asOf: 1_799_990_000_000, source: 'er-api' }); assert.equal(a.h('x-data-stale'), null); assert.equal(a.h('cache-control'), polledCacheControl(60));
  net.jpy.yahoo = 'ok'; net.jpy.price = 151.25; tick(JPY_TTL + 1_000);
  const b = await jpy(); assert.deepEqual(b.body, { jpy: 151.25, asOf: 1_800_000_000_000, source: 'yahoo' });
});

test('J4. a last good rate that came from er-api keeps that source when it is served stale', async () => {
  net.jpy.yahoo = 'http500'; net.jpy.er = 'ok'; net.jpy.erRate = 148.8; tick(JPY_TTL + 1_000); await jpy();   // a good er-api read
  net.jpy.er = 'http500'; tick(JPY_TTL + 1_000);
  const f = await jpy();
  assert.equal(f.status, 200); assert.deepEqual(f.body, { jpy: 148.8, asOf: 1_799_990_000_000, source: 'er-api', stale: true, ageSeconds: 61 });
});

test('J5. THE 6 HOUR BOUND: 6 h minus 1 s old is served stale, 6 h is the same 502 as before', async () => {
  net.jpy.yahoo = 'ok'; net.jpy.er = 'ok'; net.jpy.price = 152; tick(JPY_HOLD + 1_000); await jpy(); const goodAt = Date.now();
  net.jpy.yahoo = 'http500'; net.jpy.er = 'http500';
  tick(6 * HOUR - 1_000 - (Date.now() - goodAt));
  const edge = await jpy(); assert.equal(edge.status, 200); assert.equal(edge.body.jpy, 152); assert.equal(edge.body.stale, true); assert.equal(edge.body.ageSeconds, 21_599);
  tick(JPY_HOLD + 1_000);
  const old = await jpy(); assert.equal(old.status, 502, 'a rate older than 6 h was served'); assert.deepEqual(old.body, { error: 'Upstream fetch failed' });
});

test('J6. unchanged: the rate limit answers 429 after 20 calls a minute', async () => {
  net.jpy.yahoo = 'ok'; net.jpy.er = 'ok';
  let last = 0; for (let i = 0; i < 21; i++) last = (await jpyGET(new NextRequest('https://qa.invalid/api/forex/jpy', { headers: { 'cf-connecting-ip': '203.0.113.201' } }))).status;
  assert.equal(last, 429);
});

/* ═══════════════════════════ /api/macro ═══════════════════════════ */

const macro = async () => { const r = await read(await macroGET(req('/api/macro'))); assert.equal(r.status, 200, 'the macro route answered a non-200'); return r; };
type Quote = { price: number; chg: number | null; asOf: number | null } | null;
const q = (r: Res, s: string): Quote => r.body[s];
const setMacro = (mode: Mode | 'noPrice') => { for (const s of SERIES) net.macro.mode[s] = mode; };
const YF_TTL = 60_000, YF_HOLD = 30_000;

test('Y0. NEVER READ: Yahoo failing with no good read answers null for every Yahoo series, as before', async () => {
  setMacro('http500');
  const r = await macro();
  for (const s of SERIES) assert.equal(q(r, s), null, `${s} was not null with nothing ever read`);
  assert.ok('real10y' in r.body, 'the real-yield key is gone');
});

test('Y1. HEALTHY PATH: a good read answers {price, chg, asOf} per series (asOf in ms from the quote\'s own time) plus real10y, with the polled header', async () => {
  setMacro('ok'); tick(YF_HOLD + 1_000);
  const r = await macro();
  for (const s of SERIES) { const v = q(r, s)!; assert.equal(v.price, 200, s); assert.ok(near(v.chg!, 25), `${s} chg ${v.chg}`); assert.equal(v.asOf, MACRO_TIME * 1000, s); }
  assert.deepEqual(Object.keys(r.body).sort(), ['dxy', 'gold', 'jpy', 'oil', 'real10y', 'spx', 'tnx']);
  assert.equal(r.h('cache-control'), polledCacheControl(300));
});

test('Y2. YAHOO FAILING after the TTL: every series answers its LAST GOOD quote (the same price, chg and asOf), not null - for an HTTP error, a 200 without a price and a network error', async () => {
  const good = await macro();                                       // the cached good read (inside the TTL)
  for (const shape of ['http500', 'noPrice', 'network'] as const) {
    setMacro(shape); tick(YF_TTL + YF_HOLD + 1_000);
    const r = await macro();
    for (const s of SERIES) { assert.notEqual(q(r, s), null, `${shape}: ${s} went null on a failed refresh`); assert.deepEqual(q(r, s), q(good, s), `${shape}: ${s} is not its last good quote`); }
    assert.equal(r.h('cache-control'), polledCacheControl(300));
  }
});

test('Y3. BOTH DIRECTIONS: one failing series serves ITS last good while the others serve the NEW fresh quote (the last good does not freeze a healthy series)', async () => {
  setMacro('ok'); for (const s of SERIES) net.macro.price[s] = 210; tick(YF_TTL + YF_HOLD + 1_000);
  await macro();                                                    // 210 everywhere is now the good read
  for (const s of SERIES) net.macro.price[s] = 224; net.macro.mode.gold = 'http500'; tick(YF_TTL + YF_HOLD + 1_000);
  const r = await macro();
  assert.equal(q(r, 'gold')!.price, 210, 'gold did not serve its last good quote');
  for (const s of SERIES.filter((x) => x !== 'gold')) assert.equal(q(r, s)!.price, 224, `${s} was frozen at the old quote while its upstream answers`);
  assert.ok(near(q(r, 'oil')!.chg!, 40), 'a fresh quote lost its own change');
  net.macro.mode.gold = 'ok';
});

test('Y4. a recovery after a failure serves the new quote once the hold is over (the stale value does not stick)', async () => {
  setMacro('ok'); for (const s of SERIES) net.macro.price[s] = 232; tick(YF_TTL + YF_HOLD + 1_000);
  const r = await macro(); for (const s of SERIES) assert.equal(q(r, s)!.price, 232, s);
});

test('Y5. THE 6 HOUR BOUND: a quote 6 h minus 1 ms old is served, one 6 h old is null (nothing else to serve)', async () => {
  setMacro('ok'); for (const s of SERIES) net.macro.price[s] = 240; tick(YF_TTL + YF_HOLD + 1_000); await macro(); const goodAt = Date.now();
  setMacro('http500');
  tick(6 * HOUR - 1 - (Date.now() - goodAt)); assert.equal(Date.now() - goodAt, 6 * HOUR - 1);
  const edge = await macro(); for (const s of SERIES) assert.equal(q(edge, s)!.price, 240, `${s} refused at 6 h minus 1 ms`);
  tick(1);
  const old = await macro(); for (const s of SERIES) assert.equal(q(old, s), null, `${s} was served at 6 h`);
  setMacro('ok');
});

/* ═══════════════════════════ /api/cycle ═══════════════════════════ */

const cycle = async (path = '/api/cycle') => read(await cycleGET(req(path)));
const ratios = (closes: number[]) => closes.map((c, i) => ({ day: i * 7, ratio: c / closes[0] }));
const CYCLE_TTL = HOUR;

test('Z0. NEVER READ: Bybit failing with no good read is the same 500 "Request failed" as before, with no stale marker', async () => {
  net.cycle.mode = 'http500';
  const f = await cycle();
  assert.equal(f.status, 500); assert.deepEqual(f.body, { error: 'Request failed' }); assert.equal(f.h('x-data-stale'), null);
});

test('Z1. HEALTHY PATH: a good read answers the three curves and currentDay, with the polled header and no stale marker; inside the hour it is served from memory', async () => {
  net.cycle.mode = 'ok'; net.cycle.calls = 0;
  const a = await cycle();
  assert.equal(a.status, 200); assert.deepEqual(Object.keys(a.body), ['2016', '2020', '2024', 'currentDay']);
  assert.deepEqual(a.body['2024'], ratios([60000, 66000, 72000, 48000]));
  assert.equal(a.body.currentDay, Math.floor((Date.now() - HALVING_MS) / 86_400_000)); assert.equal(a.body['2016'].length, 80); assert.equal(a.body['2020'].length, 80);
  assert.equal(a.h('cache-control'), polledCacheControl(300)); assert.equal(a.h('x-data-stale'), null);
  tick(CYCLE_TTL - 1_000); const b = await cycle(); assert.equal(net.cycle.calls, 1, 'a call inside the hour went to Bybit'); assert.deepEqual(b.body['2024'], a.body['2024']);
});

test('Z2. A FAILED HOURLY REFRESH serves the last good curve (200) with X-Data-Stale carrying its age and no-store - for an HTTP error, a retCode error, an empty list and a network error', async () => {
  const good = ratios([60000, 66000, 72000, 48000]);
  for (const [i, shape] of (['http500', 'retcode', 'empty', 'network'] as const).entries()) {
    net.cycle.mode = shape; tick(i === 0 ? 2_000 : 60_000);       // 1 h + 1 s since the good read, then a minute more each time
    const f = await cycle();
    assert.equal(f.status, 200, `${shape}: answered ${f.status} instead of the last curve`);
    assert.deepEqual(f.body['2024'], good, `${shape}: not the last good curve`);
    assert.equal(f.body.currentDay, Math.floor((Date.now() - HALVING_MS) / 86_400_000), `${shape}: currentDay is not today's`);
    assert.equal(f.h('x-data-stale'), `true; age=${3601 + i * 60}s`, `${shape}: the stale header`);
    assert.equal(f.h('cache-control'), 'no-store', `${shape}: a stale answer must not be cacheable`);
  }
});

test('Z3. RECOVERY is automatic: the stale answer did not refresh the entry\'s time, so the next call retries Bybit and serves the NEW curve fresh (polled header, no stale marker)', async () => {
  net.cycle.mode = 'ok'; net.cycle.closes = [50000, 55000, 60000, 65000, 70000]; net.cycle.calls = 0;
  const a = await cycle();
  assert.equal(net.cycle.calls, 1, 'the call after a stale answer did not retry Bybit');
  assert.equal(a.status, 200); assert.deepEqual(a.body['2024'], ratios([50000, 55000, 60000, 65000, 70000])); assert.equal(a.h('x-data-stale'), null); assert.equal(a.h('cache-control'), polledCacheControl(300));
});

test('Z4. a refresh that fails INSIDE the hour is not an upstream call at all (the hit is served, unchanged), and the stale answer is not a 5xx at any age (a day on)', async () => {
  net.cycle.mode = 'http500'; net.cycle.calls = 0; tick(HOUR / 2);
  const hit = await cycle(); assert.equal(net.cycle.calls, 0); assert.equal(hit.h('x-data-stale'), null); assert.equal(hit.status, 200);
  tick(24 * HOUR);
  const day = await cycle(); assert.equal(day.status, 200); assert.deepEqual(day.body['2024'], ratios([50000, 55000, 60000, 65000, 70000])); assert.equal(day.h('x-data-stale'), `true; age=${Math.round((HOUR / 2 + 24 * HOUR) / 1000)}s`);
});

test('Z5. unchanged: the rate limit answers 429 after 20 calls a minute', async () => {
  net.cycle.mode = 'ok';
  let last = 0; for (let i = 0; i < 21; i++) last = (await cycleGET(new NextRequest('https://qa.invalid/api/cycle', { headers: { 'cf-connecting-ip': '203.0.113.202' } }))).status;
  assert.equal(last, 429);
});

/* ═══════════════════════════ /api/proxy (the four slow types) ═══════════════════════════ */

const PROXY_URL: Record<string, string> = {
  'llama-stables': '/api/proxy?type=llama-stables&includePrices=true',
  'deribit-book': '/api/proxy?type=deribit-book&currency=BTC&kind=option',
  'funding-history': '/api/proxy?type=funding-history&symbol=BTCUSDT&limit=50',
  'funding-rate-1': '/api/proxy?type=funding-rate-1&symbol=BTCUSDT&limit=50',
  'open-interest-1': '/api/proxy?type=open-interest-1&symbol=BTCUSDT&intervalTime=5min&limit=20',
};
const SLOW: Array<{ type: string; ttl: number; stale: number }> = [
  { type: 'llama-stables', ttl: 15 * MIN, stale: 24 * HOUR },
  { type: 'deribit-book', ttl: MIN, stale: HOUR },
  { type: 'funding-history', ttl: 15 * MIN, stale: 6 * HOUR },
  { type: 'funding-rate-1', ttl: 15 * MIN, stale: 6 * HOUR },
];
const proxyRaw = async (url: string) => { const r = await proxyGET(req(url)); return { status: r.status, text: await r.text(), h: (n: string) => r.headers.get(n) }; };
/* the expected body is what the stand-in sent through the route's own trim (llama and deribit trim; deribit keeps the fields it names) */
const expectBody = (type: string, v: number): unknown => type === 'llama-stables' ? llamaTrimmed(v) : type === 'deribit-book' ? { jsonrpc: '2.0', result: [{ instrument_name: 'BTC-1JAN27-100000-C', open_interest: 7, mark_iv: 50 + v, underlying_price: 60000 }] } : proxyBody(type, v);
const fresh = (type: string) => { net.proxy.mode[type] = 'ok'; };
const failed = (type: string) => { net.proxy.mode[type] = 'http500'; };

test('P0. NEVER READ: a slow type failing with no good read is the same 502 as before, and an unknown type is still 400', async () => {
  for (const { type } of SLOW) {
    failed(type);
    const f = await proxyRaw(PROXY_URL[type]);
    assert.equal(f.status, 502, `${type}: ${f.status}`); assert.equal(f.h('x-data-stale'), null, `${type}: a stale marker with nothing to serve`);
    assert.deepEqual(JSON.parse(f.text), { error: `${type} upstream returned 500` }, `${type}: the error text changed`);
  }
  assert.equal((await proxyRaw('/api/proxy?type=nothing')).status, 400);
});

test('P1. HEALTHY PATH: each slow type answers 200 with the route\'s own (trimmed) body, JSON content type and the polled header, no stale marker', async () => {
  for (const { type, ttl } of SLOW) {
    fresh(type); tick(ttl + 1_000);
    const a = await proxyRaw(PROXY_URL[type]);
    assert.equal(a.status, 200, type); assert.deepEqual(JSON.parse(a.text), expectBody(type, 1), `${type}: the healthy body changed`);
    assert.equal(a.h('content-type'), 'application/json'); assert.equal(a.h('cache-control'), polledCacheControl(300), type);
    assert.equal(a.h('x-data-stale'), null, type); assert.equal(a.h('x-data-age-ms'), null, type);
  }
});

test('P2. EACH SLOW TYPE after its TTL with the upstream down answers the LAST GOOD body, 200, with x-data-stale 1 and x-data-age-ms the real age (an HTTP error and a network error)', async () => {
  for (const { type, ttl } of SLOW) {
    for (const shape of ['http500', 'network'] as const) {
      fresh(type); tick(ttl + 1_000);
      const good = await proxyRaw(PROXY_URL[type]); assert.equal(good.status, 200, `${type}/${shape}: the good read`); assert.equal(good.h('x-data-stale'), null);
      net.proxy.mode[type] = shape; tick(ttl + 1_000);                  // past the TTL, far inside the stale bound
      const f = await proxyRaw(PROXY_URL[type]);
      assert.equal(f.status, 200, `${type}/${shape}: answered ${f.status} instead of the last good body`);
      assert.deepEqual(JSON.parse(f.text), expectBody(type, 1), `${type}/${shape}: not the last good body`);
      assert.equal(f.h('x-data-stale'), '1', `${type}/${shape}`); assert.equal(f.h('x-data-age-ms'), String(ttl + 1_000), `${type}/${shape}: the age header is not the real age`);
      assert.equal(f.h('cache-control'), null, `${type}/${shape}: a stale answer is cacheable`);
    }
    fresh(type);
  }
});

test('P3. THE BOUNDS: each type is served stale up to ITS bound (llama 24 h, deribit 1 h, funding 6 h) minus 1 ms and not at the bound - the same 502 as before', async () => {
  for (const { type, stale } of SLOW) {
    fresh(type); net.proxy.version = 2; tick(stale + 1_000); await proxyRaw(PROXY_URL[type]); const goodAt = Date.now();   // a new good body (version 2)
    failed(type); tick(stale - 1 - (Date.now() - goodAt)); assert.equal(Date.now() - goodAt, stale - 1);
    const edge = await proxyRaw(PROXY_URL[type]); assert.equal(edge.status, 200, `${type}: refused at its bound minus 1 ms`); assert.deepEqual(JSON.parse(edge.text), expectBody(type, 2), type); assert.equal(edge.h('x-data-age-ms'), String(stale - 1));
    tick(1);
    const old = await proxyRaw(PROXY_URL[type]); assert.equal(old.status, 502, `${type}: served at its bound`); assert.equal(old.h('x-data-stale'), null);
    fresh(type); net.proxy.version = 1;
  }
});

test('P4. the types WITHOUT a bound stay live-or-error (open-interest-1: a failing upstream after a good read is the same 502, never a stale body), and a CURSOR request (startTime) is not answered from the cached body', async () => {
  fresh('open-interest-1'); tick(10 * MIN);
  assert.equal((await proxyRaw(PROXY_URL['open-interest-1'])).status, 200);
  failed('open-interest-1'); tick(10 * MIN);
  const oi = await proxyRaw(PROXY_URL['open-interest-1']); assert.equal(oi.status, 502, 'a type with no serveStaleMs served a stale body'); assert.equal(oi.h('x-data-stale'), null);
  /* funding-history has a good cached body (same symbol and limit) - a paginated read of it must still fail, not return that body */
  fresh('funding-history'); tick(20 * MIN); assert.equal((await proxyRaw(PROXY_URL['funding-history'])).status, 200);
  failed('funding-history'); tick(20 * MIN);
  const cursor = await proxyRaw(`${PROXY_URL['funding-history']}&startTime=1799000000000&endTime=1799900000000`);
  assert.equal(cursor.status, 502, 'a paginated (cursor) read was answered with a cached body for other parameters'); assert.equal(cursor.h('x-data-stale'), null);
  const plain = await proxyRaw(PROXY_URL['funding-history']); assert.equal(plain.status, 200); assert.equal(plain.h('x-data-stale'), '1', 'the plain read lost its stale answer');
  fresh('funding-history'); fresh('open-interest-1');
});

test('P5. a different parameter set has its OWN last good: a symbol never read before is a 502 while the one that was read is served stale', async () => {
  fresh('funding-rate-1'); tick(20 * MIN); assert.equal((await proxyRaw(PROXY_URL['funding-rate-1'])).status, 200);
  failed('funding-rate-1'); tick(20 * MIN);
  assert.equal((await proxyRaw(PROXY_URL['funding-rate-1'])).h('x-data-stale'), '1');
  const other = await proxyRaw('/api/proxy?type=funding-rate-1&symbol=ETHUSDT&limit=50'); assert.equal(other.status, 502, 'ETH was answered with the BTC body'); assert.equal(other.h('x-data-stale'), null);
  fresh('funding-rate-1');
});

/* ═══════════════════════ /api/market/snapshot ═══════════════════════ */

const snapshot = async () => read(await snapshotGET(req('/api/market/snapshot')));
const TICKER_TTL = 45_000, KLINES_TTL = 3 * MIN, LSR_TTL = 5 * MIN, SWR = 60_000;
let snapshotGoodAt = 0;

test('S0. NEVER READ: every section failing with no good read is the same 502 "Upstream unavailable" as before', async () => {
  net.market = 'down';
  const f = await snapshot();
  assert.equal(f.status, 502); assert.deepEqual(f.body, { error: 'Upstream unavailable' }); assert.equal(f.h('x-data-stale'), null);
});

test('S1. HEALTHY PATH: a good read answers ticker, klines, lsr and ts (the oldest section\'s time) - no stale key - with the polled header', async () => {
  net.market = 'ok'; tick(MIN);
  const a = await snapshot(); snapshotGoodAt = Date.now();
  assert.equal(a.status, 200);
  assert.ok(Object.keys(a.body.ticker).length > 40, `ticker has ${Object.keys(a.body.ticker).length} coins`); assert.ok(Object.keys(a.body.klines).length > 40); assert.ok(Object.keys(a.body.lsr).length > 40);
  assert.equal('stale' in a.body, false, 'a healthy answer carries a stale key'); assert.equal(a.body.ts, snapshotGoodAt);
  assert.equal(a.h('cache-control'), polledCacheControl(60));
  assert.equal(a.body.ticker.btc.price, 100, 'the ticker value is not the stand-in\'s'); assert.equal(a.body.ticker.btc.change, 1.5);
});

test('S2. a PART-failed snapshot is NOT stale: with only the ticker beyond its window and its upstream down, the answer is the normal partial one (the ticker named in partial, no stale key); nothing newly stale is served while an upstream works', async () => {
  net.market = 'down'; tick(TICKER_TTL + SWR + 5_000 - (Date.now() - snapshotGoodAt));   // ticker is past ttl + 60 s, klines and lsr are still inside theirs
  const a = await snapshot();
  assert.equal(a.status, 200); assert.equal('stale' in a.body, false, 'a part-failed answer was flagged stale'); assert.deepEqual(a.body.partial, ['ticker'], 'the failed section is not named');
  assert.deepEqual(a.body.ticker, {}); assert.ok(Object.keys(a.body.klines).length > 40, 'the sections that were fine were dropped');
});

test('S3. EVERY SECTION FAILED (all three beyond ttl + 60 s, the upstream down): the LAST GOOD snapshot, 200, flagged stale, with ts the real age of its oldest part and the same data as the good read', async () => {
  tick(LSR_TTL + SWR + 5_000 - (Date.now() - snapshotGoodAt));       // lsr (the longest window) is now past its bound too
  const f = await snapshot();
  assert.equal(f.status, 200, 'every section failing answered a failure instead of the last good snapshot');
  assert.equal(f.body.stale, true); assert.equal(f.body.ts, snapshotGoodAt, 'ts must be the real age of the data, not "now"');
  assert.ok(Object.keys(f.body.ticker).length > 40 && Object.keys(f.body.klines).length > 40 && Object.keys(f.body.lsr).length > 40, 'a section of the last good snapshot is missing');
  assert.equal(f.body.ticker.btc.price, 100); assert.equal('partial' in f.body, false, 'a complete last-good snapshot carries partial');
  assert.equal(f.h('cache-control'), polledCacheControl(60));
});

test('S4. THE 10 MINUTE BOUND: the last good is served up to 10 minutes minus 1 ms old and at 10 minutes the answer is the same 502', async () => {
  tick(10 * MIN - 1 - (Date.now() - snapshotGoodAt)); assert.equal(Date.now() - snapshotGoodAt, 10 * MIN - 1);
  const edge = await snapshot(); assert.equal(edge.status, 200, 'refused at 10 minutes minus 1 ms'); assert.equal(edge.body.stale, true);
  tick(1);
  const old = await snapshot(); assert.equal(old.status, 502, 'a snapshot 10 minutes old was served'); assert.deepEqual(old.body, { error: 'Upstream unavailable' });
});

test('S5. RECOVERY: when the exchanges answer again the next call is a fresh read - no stale key, ts is now', async () => {
  net.market = 'ok'; tick(MIN);
  const a = await snapshot();
  assert.equal(a.status, 200); assert.equal('stale' in a.body, false); assert.equal(a.body.ts, Date.now(), 'the fresh answer is dated by the stale one');
});

/* ═══════════════ MarketProvider.fetchStablecoinFlows ═══════════════ */

/* The function is a useCallback inside a 2000-line React component, so it is CUT OUT by brace matching and compiled (own checked-in source, never input); `fetch` and `setStore` are its only free variables. */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const provider = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
const cutStablecoinFn = (): ((fetchImpl: typeof fetch, setStore: (u: (s: Store) => Store) => void) => () => Promise<void>) => {
  const head = 'const fetchStablecoinFlows = useCallback(async () => {';
  const at = provider.indexOf(head); assert.ok(at > 0, 'CONTROL: fetchStablecoinFlows not found'); assert.equal(provider.indexOf(head, at + 1), -1, 'CONTROL: more than one fetchStablecoinFlows');
  const open = provider.indexOf('{', at + 'const fetchStablecoinFlows = useCallback(async () '.length);
  let depth = 0, end = -1;
  for (let i = open; i < provider.length; i++) { if (provider[i] === '{') depth++; else if (provider[i] === '}' && --depth === 0) { end = i; break; } }
  assert.ok(end > open, 'CONTROL: the closing brace was not found');
  const body = provider.slice(open, end + 1);
  const compiled = stripTypeScriptTypes('(async () => ' + body + ')').trim();
  return new Function('fetch', 'setStore', 'return ' + compiled) as never;
};
type Store = { stablecoinSupply: number | null; stablecoinPrev: number | null; stablecoinChg7d: number | null; stablecoinChg30d: number | null };
const runStablecoins = async (answer: () => Response) => {
  let store: Store = { stablecoinSupply: 250, stablecoinPrev: 249, stablecoinChg7d: 1.5, stablecoinChg30d: 2.5 }; let writes = 0;
  await cutStablecoinFn()((async () => answer()) as typeof fetch, (u) => { writes++; store = u(store); })();
  return { store, writes };
};
const llamaFull = () => json(200, { peggedAssets: [
  { symbol: 'USDT', circulating: { peggedUSD: 100e9 }, circulatingPrevWeek: { peggedUSD: 90e9 }, circulatingPrevMonth: { peggedUSD: 80e9 } },
  { symbol: 'USDC', circulating: { peggedUSD: 50e9 }, circulatingPrevWeek: { peggedUSD: 50e9 }, circulatingPrevMonth: { peggedUSD: 40e9 } },
] });

test('B1. MarketProvider.fetchStablecoinFlows: a GOOD answer writes the supply (150 B), the 7 and 30 day changes and keeps the previous supply; a NON-OK answer (a 502 from the proxy, or a 500) writes NOTHING - the last supply stays', async () => {
  const good = await runStablecoins(llamaFull);
  assert.equal(good.writes, 1); assert.deepEqual(good.store, { stablecoinSupply: 150, stablecoinPrev: 250, stablecoinChg7d: 10, stablecoinChg30d: 30 });
  for (const status of [502, 500]) {
    const r = await runStablecoins(() => json(status, { error: 'Upstream unavailable' }));
    assert.equal(r.writes, 0, `a ${status} answer wrote to the store (the 502 body has no peggedAssets: it was read as an unknown supply)`);
    assert.deepEqual(r.store, { stablecoinSupply: 250, stablecoinPrev: 249, stablecoinChg7d: 1.5, stablecoinChg30d: 2.5 }, `${status}: the last supply was not kept`);
  }
});

test('B2. the other direction: a 200 that is missing a coin still writes the unknown (null) as before, and a fetch that throws writes nothing', async () => {
  const noUsdc = await runStablecoins(() => json(200, { peggedAssets: [{ symbol: 'USDT', circulating: { peggedUSD: 100e9 }, circulatingPrevWeek: { peggedUSD: 90e9 }, circulatingPrevMonth: { peggedUSD: 80e9 } }] }));
  assert.equal(noUsdc.writes, 1, 'a 200 body with only one coin must still write the unknown'); assert.deepEqual(noUsdc.store, { stablecoinSupply: null, stablecoinPrev: 249, stablecoinChg7d: null, stablecoinChg30d: null });
  let writes = 0;
  await cutStablecoinFn()((async () => { throw new TypeError('fetch failed'); }) as typeof fetch, () => { writes++; })();
  assert.equal(writes, 0, 'a thrown fetch wrote to the store');
});

/* ═══════════════════════ /api/market/rsi ═══════════════════════ */

const rsi = async (bearer?: string) => read(await rsiGET(req('/api/market/rsi', bearer ? { authorization: `Bearer ${bearer}` } : {})));
/* A TOTAL OUTAGE sends ~270 jobs to Bybit, and lib/exchangeGuard's 250-per-5-s window sleeps on REAL timers while it reads Date.now(), which is frozen here: it would sleep for ever. The mocked clock is moved forward (20 ms per 5 ms) for the duration of that one call, so the window slides; the drift is about a minute, far inside every bound asserted below. */
async function withMovingClock<T>(fn: () => Promise<T>): Promise<T> {
  const id = setInterval(() => tick(20), 5);
  try { return await fn(); } finally { clearInterval(id); }
}
const ok = <T,>(v: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value: v });
const bad = (m: string): PromiseRejectedResult => ({ status: 'rejected', reason: new Error(m) });
type G = { out: Record<string, Record<string, number>>; viaFallback: string[] };
const seed = (key: string, v: G) => cached(key, 24 * HOUR, async () => v);   // a good read in the real cache, under the key the route reads

test('R1. mergeRsiGroups (real), both groups rejected with NOTHING stored: the same error as before; a healthy pair and a part-failed pair are unchanged (no stale key)', () => {
  const none = mergeRsiGroups([bad('fast down'), bad('slow down')], true);
  assert.equal(none.ok, false); assert.match(String((none as { reason: Error }).reason.message), /fast down/);
  const healthy = mergeRsiGroups([ok({ out: { btc: { rsi5m: 41 } }, viaFallback: [] }), ok({ out: { btc: { rsi1h: 55 } }, viaFallback: ['eth'] })], true);
  assert.deepEqual(healthy, { ok: true, rsi: { btc: { rsi5m: 41, rsi1h: 55 } }, viaFallback: ['eth'] }); assert.equal('stale' in healthy, false);
  const part = mergeRsiGroups([bad('fast down'), ok({ out: { btc: { rsi1h: 55 } }, viaFallback: [] })], true);
  assert.deepEqual(part, { ok: true, rsi: { btc: { rsi1h: 55 } }, viaFallback: [] }); assert.equal('stale' in part, false, 'a part-failed merge was flagged stale');
});

test('R2. mergeRsiGroups (real), BOTH rejected with the last good tables stored: both are served, flagged stale; the 5m group only for a Pro caller; the slow group alone for the rest', async () => {
  tick(MIN);
  await seed('market-rsi:slow', { out: { btc: { rsi1h: 55, rsi4h: 52 }, eth: { rsi1h: 61 } }, viaFallback: ['eth'] });
  await seed('market-rsi:fast', { out: { btc: { rsi5m: 41 }, eth: { rsi5m: 38 } }, viaFallback: [] });
  tick(5 * MIN);                                                    // slow 5 min old (limit 1 h), fast 5 min old (limit 10 min)
  const pro = mergeRsiGroups([bad('fast down'), bad('slow down')], true);
  assert.deepEqual(pro, { ok: true, rsi: { btc: { rsi1h: 55, rsi4h: 52, rsi5m: 41 }, eth: { rsi1h: 61, rsi5m: 38 } }, viaFallback: ['eth'], stale: true });
  const free = mergeRsiGroups([bad('fast down'), bad('slow down')], false);
  assert.deepEqual(free, { ok: true, rsi: { btc: { rsi1h: 55, rsi4h: 52 }, eth: { rsi1h: 61 } }, viaFallback: ['eth'], stale: true }, 'a caller who is not Pro was handed the 5m group');
});

test('R3. the BOUNDS: the 5m group is dropped past 10 minutes (the slow group alone remains), the slow group past 1 h (nothing remains: the same error)', async () => {
  tick(5 * MIN - 1 + 0);                                            // fast is now 10 min - 1 ms... (it was 5 min old above, +5 min -1 ms)
  const edge = mergeRsiGroups([bad('fast down'), bad('slow down')], true) as { ok: true; rsi: Record<string, Record<string, number>>; stale?: boolean };
  assert.equal(edge.ok, true); assert.equal(edge.rsi.btc.rsi5m, 41, 'the 5m group was refused at 10 minutes minus 1 ms'); assert.equal(edge.stale, true);
  tick(1);
  const noFast = mergeRsiGroups([bad('fast down'), bad('slow down')], true) as { ok: true; rsi: Record<string, Record<string, number>>; stale?: boolean };
  assert.equal(noFast.ok, true); assert.equal('rsi5m' in noFast.rsi.btc, false, 'the 5m group was served at 10 minutes'); assert.equal(noFast.rsi.btc.rsi1h, 55); assert.equal(noFast.stale, true);
  tick(HOUR - 5 * MIN - 5 * MIN - 1 + 0);                           // slow is now 1 h - 1 ms old
  const slowEdge = mergeRsiGroups([bad('fast down'), bad('slow down')], true) as { ok: boolean; rsi?: Record<string, Record<string, number>> };
  assert.equal(slowEdge.ok, true, 'the slow group was refused at 1 h minus 1 ms');
  tick(1);
  const none = mergeRsiGroups([bad('fast down'), bad('slow down')], true); assert.equal(none.ok, false, 'the slow group was served at 1 h'); assert.match(String((none as { reason: Error }).reason.message), /fast down/);
});

test('R4. the REAL ROUTE, healthy: a good read answers rsi, ts and the polled-private header, no stale key (a signed-out caller gets the slow group; a Pro caller gets 5m too)', async () => {
  net.market = 'ok'; net.plan = 'pro'; tick(2 * HOUR);
  const free = await rsi();
  assert.equal(free.status, 200); assert.ok(Object.keys(free.body.rsi).length > 40, `rsi has ${Object.keys(free.body.rsi).length} coins`); assert.equal('stale' in free.body, false);
  assert.equal(free.h('cache-control'), 'private, max-age=60'); assert.equal(free.h('vary'), 'Authorization');
  assert.ok(Object.values(free.body.rsi as Record<string, Record<string, number>>).every((row) => !('rsi5m' in row)), 'a signed-out caller was handed the 5m group');
  const pro = await rsi(await token());
  assert.ok(Object.values(pro.body.rsi as Record<string, Record<string, number>>).some((row) => 'rsi5m' in row), 'a Pro caller got no 5m group');
  assert.equal('stale' in pro.body, false);
});

test('R5. the REAL ROUTE after a TOTAL outage (both groups past ttl + 60 s, every exchange down): the last good tables, 200, flagged stale, ts the real age (inside 1 h)', async () => {
  const goodAt = Date.now(); const good = (await rsi()).body.rsi;
  net.market = 'down'; tick(15 * MIN + SWR + 5_000);                // both groups beyond their servable window
  const f = await withMovingClock(() => rsi());
  assert.equal(f.status, 200, `a total outage answered ${f.status} with ${Object.keys(f.body.rsi ?? {}).length} coins instead of the last good tables`);
  assert.equal(f.body.stale, true, `the answer is not flagged stale (it carries ${Object.keys(f.body.rsi ?? {}).length} coins, the good read had ${Object.keys(good).length})`); assert.deepEqual(f.body.rsi, good, 'not the last good tables'); assert.equal(f.body.ts, goodAt, 'ts must be the age of the data');
  net.market = 'ok';
});
