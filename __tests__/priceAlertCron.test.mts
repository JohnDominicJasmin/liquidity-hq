/* #1667 acceptance on the REAL alert cron (app/api/telegram/alert/route.ts GET), run after run.
 *
 * #1667's own acceptance, written as the oracle: "stubbed Telegram failure -> the alert stays active and is retried next run; kill switch on
 * -> no alert consumed; success -> consumed once". Plus the rule QA's review of #1669 added: a resend must not state an old price as current.
 *
 * HOW IT RUNS: the route imports types as values (DistributionInputs, and lib/waveTrend.ts's OHLCV), which Node's type stripping rejects,
 * so a load hook runs every repo .ts file through the repo's own TypeScript (transpile only, nothing else changes). The network is a
 * stand-in: Supabase (one Pro user with a linked chat, its price alerts, feature flags, everything else empty), Bybit (BTC's price), and
 * Telegram (ok or 403, recording every message). Date is Node's mocked clock, so the backoff and the 15 s flag cache are stepped exactly.
 * The held messages live in the route's module state, so the tests run in order on one process, as the cron's runs do.
 *
 * WHAT IT CANNOT PROVE: a real bot, two overlapping cron runs, or a server restart (which drops held messages by design, #1669). */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const REPO = new URL('../', import.meta.url).href;
const TS = new URL('../node_modules/typescript/lib/typescript.js', import.meta.url).href;
const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import { fileURLToPath } from 'node:url';
  let ts;
  export async function resolve(specifier, context, next) {
    if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
    return next(specifier, context);
  }
  export async function load(url, context, next) {
    if (url.startsWith(${JSON.stringify(REPO)}) && !url.includes('/node_modules/') && /\\.tsx?$/.test(url)) {
      ts ??= (await import(${JSON.stringify(TS)})).default;
      const src = await readFile(fileURLToPath(url), 'utf8');
      const out = ts.transpileModule(src, { fileName: fileURLToPath(url), compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false } });
      return { format: 'module', source: out.outputText, shortCircuit: true };
    }
    return next(url, context);
  }`));

/* A clock that RUNS, plus an offset the tests advance. Not mock.timers: a frozen Date never lets lib/exchangeGuard.ts's Bybit pacing loop
   see its window pass, so every run hung to the route's 28 s timeout (QA's first attempt). Date.now is what the backoff, the flag cache
   and the guard all read. */
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;
const tick = (ms: number) => { offset += ms; };

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.CRON_SECRET = 'qa-cron-secret'; process.env.TELEGRAM_BOT_TOKEN = 'qa-bot-token';
delete process.env.TELEGRAM_CHAT_ID;
const UID = '77777777-7777-4777-8777-777777777777', CHAT = '4242';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ── the stand-in world ── */
type Alert = { id: number; coin: string; target_price: number; direction: string; label: string; user_id: string; created_at: string; active: boolean };
const world = {
  alerts: [] as Alert[],
  btc: 101_000,
  telegram: 'ok' as 'ok' | 'blocked',
  sendingOff: false,                                         // the /ops kill switch (feature flag "telegram")
  priceAlertMessages: [] as string[],                        // every price-alert message Telegram was asked to send
  switchedOff: [] as number[][],                             // ids in each "active: false" write
  upstream: [] as string[],                                  // every call the route made to a PRICE source (not Telegram, not Supabase)
  prices: {} as Record<string, number>,
  realistic: false,                                          // serve real klines / tickers / open-interest instead of empty lists (see `realistic` below)                      // extra spot prices by symbol, e.g. ETHUSDT, for the multi-coin cells
};
/* ── A STAND-IN THAT SERVES REAL ANSWERS (QA, after Dev's #2218 review: the plain stand-in answers [] to everything it does not know, so every klines read
   is empty, the ribbon scan reads that as a failure and falls over to Bybit, and nothing is ever cacheable - 1,405 calls is the cost of an all-empty
   upstream, not of prod and not of a warm pass). With `world.realistic` on, Bybit and Binance futures/spot klines answer with CLOSED candles plus ONE
   FORMING candle per interval (the newest one open, as an exchange sends it), Bybit tickers answer for every coin the app prices, and open-interest
   answers with 13 points. Prices follow `world.prices` (BTC from `world.btc`), a known value per symbol. */
const coinsP = import('../lib/coins.ts') as Promise<{ BYBIT_SYMS: Record<string, string> }>;
const ivMsOf = (iv: string): number => {
  const n = parseInt(iv, 10);
  if (/^\d+$/.test(iv)) return n * 60_000;                 // Bybit minutes: 1, 5, 60, 240
  if (/^\d+m$/.test(iv)) return n * 60_000;                // Binance 1m, 5m, 30m
  if (/^\d+h$/.test(iv)) return n * 3_600_000;
  if (/^\d+d$/i.test(iv) || iv === 'D') return (n || 1) * 86_400_000;
  if (iv === 'W') return 7 * 86_400_000;
  return 60_000;
};
const basePrice = (symbol: string): number => (symbol === 'BTCUSDT' ? world.btc : world.prices[symbol] ?? 100);
/** Newest-first rows for Bybit; oldest-first arrays for Binance. Row 0 is the FORMING candle (open time = the current interval's start). */
function candleRows(symbol: string, ivMs: number, limit: number) {
  const now = Date.now(); const forming = Math.floor(now / ivMs) * ivMs; const p = basePrice(symbol);
  return Array.from({ length: limit }, (_, i) => {
    const t = forming - i * ivMs; const c = p * (1 + 0.002 * Math.sin(t / ivMs)); const o = p * (1 + 0.002 * Math.sin(t / ivMs - 1));
    return { t, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 100 + (i % 7) };
  });
}
async function realistic(url: URL): Promise<Response | null> {
  const sym = url.searchParams.get('symbol') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? '200');
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/kline') {
    const rows = candleRows(sym, ivMsOf(url.searchParams.get('interval') ?? '1'), limit);
    return json(200, { retCode: 0, result: { list: rows.map(r => [String(r.t), String(r.o), String(r.h), String(r.l), String(r.c), String(r.v), String(r.v * r.c)]) } });
  }
  if ((url.host === 'fapi.binance.com' && url.pathname === '/fapi/v1/klines') || (url.host === 'api.binance.com' && url.pathname === '/api/v3/klines')) {
    const iv = ivMsOf(url.searchParams.get('interval') ?? '1m');
    const rows = candleRows(sym, iv, limit).reverse();
    return json(200, rows.map(r => [r.t, String(r.o), String(r.h), String(r.l), String(r.c), String(r.v), r.t + iv - 1, String(r.v * r.c), 100, '50', '5000', '0']));
  }
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/open-interest') {
    const now = Date.now();
    return json(200, { retCode: 0, result: { list: Array.from({ length: limit || 13 }, (_, i) => ({ openInterest: String(1_000_000 + (i % 5) * 1000), timestamp: String(now - i * 300_000) })) } });
  }
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/tickers') {
    const { BYBIT_SYMS } = await coinsP;
    const syms = new Set<string>(['BTCUSDT', ...Object.values(BYBIT_SYMS), ...Object.keys(world.prices)]);
    return json(200, { retCode: 0, result: { list: [...syms].map(symbol => ({ symbol, lastPrice: String(basePrice(symbol)) })) } });
  }
  return null;
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'api.telegram.org') {
    const body = JSON.parse(await req.text()) as { text: string };
    if (body.text.includes('Price Alert Triggered')) world.priceAlertMessages.push(body.text);
    return world.telegram === 'ok' ? json(200, { ok: true }) : json(403, { ok: false, description: 'Forbidden: bot was blocked by the user' });
  }
  if (world.realistic && url.origin !== SUPABASE && url.host !== 'api.telegram.org') { if (url.origin !== SUPABASE) world.upstream.push(`${url.host}${url.pathname}${url.search ? '?' + [...url.searchParams.keys()].sort().map(k => `${k}=${['category', 'interval', 'limit', 'period', 'intervalTime'].includes(k) ? url.searchParams.get(k) : '*'}`).join('&') : ''}`); const r = await realistic(url); if (r) return r; }
  if (!world.realistic && url.origin !== SUPABASE) world.upstream.push(`${url.host}${url.pathname}${url.search ? '?' + [...url.searchParams.keys()].sort().map(k => `${k}=${['category', 'interval', 'limit', 'period', 'intervalTime'].includes(k) ? url.searchParams.get(k) : '*'}`).join('&') : ''}`);
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/tickers') {
    const spot = [{ symbol: 'BTCUSDT', lastPrice: String(world.btc) }, ...Object.entries(world.prices).map(([symbol, p]) => ({ symbol, lastPrice: String(p) }))];
    return json(200, { retCode: 0, result: { list: url.searchParams.get('category') === 'spot' ? spot : [] } });
  }
  if (url.origin !== SUPABASE) return new Response('unavailable in the QA stand-in', { status: 503 });
  const p = url.pathname, m = req.method;
  if (p.endsWith('app_config')) {
    if (m !== 'GET') return new Response(null, { status: 201 });
    return json(200, url.searchParams.get('key') === 'eq.feature_flags' && world.sendingOff ? [{ value: { telegram: false } }] : []);
  }
  if (p.endsWith('user_subscriptions') && m === 'GET') return json(200, [{ user_id: UID, role: 'pro', trial_ends_at: null, current_period_end: null }]);
  if (p.endsWith('user_settings') && m === 'GET') return json(200, [{ user_id: UID, telegram_chat_id: CHAT, timezone: null }]);
  if (p.endsWith('price_alerts')) {
    if (m === 'GET') return json(200, world.alerts.filter((a) => a.active));
    if (m === 'PATCH') {
      const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean).map(Number);
      const patch = JSON.parse(await req.text()) as { active?: boolean };
      if (patch.active === false) { world.switchedOff.push(ids); for (const a of world.alerts) if (ids.includes(a.id)) a.active = false; }
      return new Response(null, { status: 204 });
    }
  }
  if (m === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

/* Imported as a PROMISE, awaited inside `run`, never with a top-level await - the same hazard #1683 found in arenaCoinLadder: node:test
   registers a file's tests as the module body runs, so registration behind an await lets a slow import leave the file with no tests, the
   runner call it finished, and the `after` hook above restore the real fetch and clock before the tests run. */
const routeP = import('../app/api/telegram/alert/route.ts') as Promise<{ GET: (r: NextRequest) => Promise<Response> }>;
/* The stand-in must still be installed when a test runs - asserted out loud, for the #1683 reason: with the real fetch back, every
   Supabase read fails and the route's own failure handling reads as a product defect. */
const standInFetch = globalThis.fetch;
const run = async () => {
  assert.equal(globalThis.fetch, standInFetch,
    'the network stand-in is not installed: the real fetch is back, so this run measures nothing about the cron - see #1683');
  const { GET } = await routeP;
  const r = await GET(new NextRequest('http://localhost/api/telegram/alert', { headers: { 'x-cron-secret': 'qa-cron-secret' } }));
  return { status: r.status, body: await r.json() as { delivery?: { priceAlertsHeld?: number } } };
};
const alert = (id: number): Alert => ({ id, coin: 'btc', target_price: 100_000, direction: 'above', label: '', user_id: UID, created_at: new Date(Date.now() - 3_600_000).toISOString(), active: true });
const sentSince = (n: number) => world.priceAlertMessages.slice(n);
const MIN = 60_000;

test('A1. a Telegram failure does NOT consume the alert: it stays active and its message is held', async () => {
  world.alerts = [alert(7)]; world.telegram = 'blocked';
  const r = await run();
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(world.priceAlertMessages.length, 1, 'the triggered alert was not attempted');
  assert.deepEqual(world.switchedOff, [], 'a failed message switched the alert off: the user loses it silently (#1667)');
  assert.equal(r.body.delivery?.priceAlertsHeld, 1);
});

test('A2. inside the backoff nothing is resent (no duplicate), and the alert stays active', async () => {
  tick(2 * MIN); world.telegram = 'ok';
  const n = world.priceAlertMessages.length;
  await run();
  assert.deepEqual(sentSince(n), [], 'the held message was resent inside its 5-minute backoff');
  assert.deepEqual(world.switchedOff, []);
});

test('A3. after the backoff the message is resent and lands: consumed exactly once, and the resend does not call the old price "Current"', async () => {
  tick(4 * MIN); world.btc = 99_500; // price has moved since the touch
  const n = world.priceAlertMessages.length;
  const r = await run();
  const resent = sentSince(n);
  assert.equal(resent.length, 1, `the held message was sent ${resent.length} times after its backoff`);
  assert.deepEqual(world.switchedOff, [[7]], 'the delivered alert was not switched off exactly once');
  assert.equal(r.body.delivery?.priceAlertsHeld, 0);
  assert.ok(!/Current: \$101,000/.test(resent[0]), 'the resend states the price from the touch (6 minutes ago) as "Current" (QA review of #1669)');
  const n2 = world.priceAlertMessages.length;
  tick(10 * MIN); await run();
  assert.deepEqual(sentSince(n2), [], 'a consumed alert was sent again');
});

test('A4. with sending paused (kill switch), a triggered alert is neither sent nor consumed nor held', async () => {
  tick(MIN); world.alerts.push(alert(8)); world.btc = 101_000; world.sendingOff = true;
  tick(16_000); // past the 15 s feature-flag cache
  const n = world.priceAlertMessages.length, off = world.switchedOff.length;
  const r = await run();
  assert.deepEqual(sentSince(n), [], 'a message went out with the kill switch on');
  assert.equal(world.switchedOff.length, off, 'the kill switch consumed an alert');
  assert.equal(r.body.delivery?.priceAlertsHeld, 0);
});

test('A5. sending resumes: the same alert is delivered once and consumed once', async () => {
  world.sendingOff = false; tick(16_000);
  const n = world.priceAlertMessages.length, off = world.switchedOff.length;
  await run();
  assert.equal(sentSince(n).length, 1);
  assert.deepEqual(world.switchedOff.slice(off), [[8]]);
});

test('A6. an alert edited while its message is held is judged afresh: the old target is never resent', async () => {
  world.alerts.push(alert(9)); world.btc = 101_000; world.telegram = 'blocked';
  tick(MIN); await run();                                         // fails: held for its 100,000 target
  const a9 = world.alerts.find((a) => a.id === 9)!; a9.target_price = 105_000; world.telegram = 'ok';
  tick(6 * MIN);
  const n = world.priceAlertMessages.length;
  const r = await run();
  assert.deepEqual(sentSince(n), [], 'the held message for the OLD target went out after the alert was edited (price 101,000 is below the new 105,000)');
  assert.ok(!world.switchedOff.some((ids) => ids.includes(9)), 'the edited alert was consumed');
  assert.equal(r.body.delivery?.priceAlertsHeld, 0, 'the stale hold was not dropped');
  a9.active = false;
});

test('A6b. an alert whose DIRECTION is edited while its message is held is judged afresh: the old "above" touch is never resent', async () => {
  world.alerts.push(alert(11)); world.btc = 101_000; world.telegram = 'blocked';
  tick(MIN); await run();                                         // fails: held for "above 100,000"
  const a11 = world.alerts.find((a) => a.id === 11)!; a11.direction = 'below'; world.telegram = 'ok';
  tick(6 * MIN);
  const n = world.priceAlertMessages.length;
  const r = await run();
  assert.deepEqual(sentSince(n), [], 'the held "above" message went out after the alert was edited to "below" (price 101,000 is not below 100,000)');
  assert.ok(!world.switchedOff.some((ids) => ids.includes(11)), 'the edited alert was consumed');
  assert.equal(r.body.delivery?.priceAlertsHeld, 0, 'the stale hold was not dropped');
  a11.active = false;
});

test('A7. a hold older than a day is dropped and the alert judged afresh: below target now, nothing is sent', async () => {
  world.alerts.push(alert(10)); world.btc = 101_000; world.telegram = 'blocked';
  tick(MIN); await run();                                         // first failed attempt: the day starts here
  world.btc = 99_000; world.telegram = 'ok';
  tick(24 * 3_600_000 + MIN);
  const n = world.priceAlertMessages.length;
  const r = await run();
  assert.deepEqual(sentSince(n), [], 'a day-old hold was still resent although price is back below target');
  assert.equal(r.body.delivery?.priceAlertsHeld, 0);
});

/* ── #1651: THE NUMBER OF UPSTREAM PRICE CALLS ONE RUN MAKES, ON RECORD BEFORE AND AFTER THE BULK-CALL CHANGE ──────────────────────────────
 *
 * B0 is the BASELINE. Five alerts on five different coins, one of them crossed. It logs every call the route made to a price source (the
 * stand-in records them in `world.upstream`) and asserts the part that must not change whatever the call count becomes: the crossed alert is
 * delivered once and consumed once, the other four stay active and unfired. The count is printed, not asserted here: on the dev tree it is
 * the "before"; B2 (written when Dev's change exists) asserts the "after" is smaller and B3 that the answer is identical. */
test('B0. five alerts on five coins: the crossing fires once, the others stay, and the upstream price calls are logged', async () => {
  world.alerts = [];
  world.prices = { ETHUSDT: 3000, SOLUSDT: 150, XRPUSDT: 0.6, DOGEUSDT: 0.1, ADAUSDT: 0.4 };
  const mk = (id: number, coin: string, target: number): Alert => ({ ...alert(id), coin, target_price: target, direction: 'above' });
  world.alerts = [mk(201, 'eth', 3100), mk(202, 'sol', 140), mk(203, 'xrp', 0.7), mk(204, 'doge', 0.2), mk(205, 'ada', 0.5)];
  const sentBefore = world.priceAlertMessages.length;
  const switchedBefore = world.switchedOff.length;
  world.upstream.length = 0;
  const { status } = await run();
  const kinds = world.upstream.slice();   // the FULL key, with interval and limit, so a category can be split
  const tally: Record<string, number> = {};
  for (const k of kinds) tally[k] = (tally[k] ?? 0) + 1;
  // eslint-disable-next-line no-console
  console.log(`[alert] upstream calls=${world.upstream.length} by endpoint=${JSON.stringify(tally)}`);
  assert.equal(status, 200);
  const sent = sentSince(sentBefore);
  assert.equal(sent.length, 1, `exactly one alert was crossed, so exactly one message must go out; got ${sent.length}`);
  assert.match(sent[0], /SOL/i, 'the delivered message is not about the crossed coin (SOL)');
  assert.deepEqual(world.switchedOff.slice(switchedBefore), [[202]], 'only the crossed alert (id 202) may be consumed');
  assert.deepEqual(world.alerts.filter(a => a.active).map(a => a.id).sort(), [201, 203, 204, 205], 'the four uncrossed alerts must stay active');
});

/* ── B0r: THE SAME QUESTION IN A WORLD WHERE UPSTREAM ANSWERS (QA, after Dev's review of B0) ───────────────────────────────────────────────
 *
 * B0's 1,405 was an all-empty-upstream pass: every klines read came back empty, the ribbon scan read that as a failure and fell over to
 * Bybit, and nothing was cacheable. Here `world.realistic` serves closed candles plus one forming candle per interval, tickers for every coin
 * and open-interest with 13 points. TWO passes in one process, inside the same hour: the first is COLD, the second WARM. The tallies are logged
 * per endpoint (with interval and limit) and in total, and on a tree with Dev's counters (bybitKlineCalls, candleCacheHits in the JSON
 * response) those are logged too. Asserted: the crossing fires once on the first pass and nothing new on the second, the other four stay
 * active, and the warm pass never makes MORE calls than the cold one. The saving itself is B2's job once #2218's head is under it. */
test('B0r. realistic upstream: cold pass then warm pass in the same hour, tallied per endpoint', async () => {
  world.realistic = true;
  try {
    world.alerts = [];
    world.prices = { ETHUSDT: 3000, SOLUSDT: 150, XRPUSDT: 0.6, DOGEUSDT: 0.1, ADAUSDT: 0.4 };
    const mk = (id: number, coin: string, target: number): Alert => ({ ...alert(id), coin, target_price: target, direction: 'above' });
    world.alerts = [mk(301, 'eth', 3100), mk(302, 'sol', 140), mk(303, 'xrp', 0.7), mk(304, 'doge', 0.2), mk(305, 'ada', 0.5)];
    const tally = () => { const o: Record<string, number> = {}; for (const k of world.upstream) o[k] = (o[k] ?? 0) + 1; return o; };
    const sentBefore = world.priceAlertMessages.length;

    world.upstream.length = 0;
    const cold = await run();
    const coldTally = tally(); const coldTotal = world.upstream.length;
    const sentAfterCold = world.priceAlertMessages.length;

    tick(20_000);                                              // a later pass, the SAME hour
    world.upstream.length = 0;
    const warm = await run();
    const warmTally = tally(); const warmTotal = world.upstream.length;

    const lines = (t: Record<string, number>) => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)} ${k}`).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[B0r] COLD total=${coldTotal}\n${lines(coldTally)}\n[B0r] WARM total=${warmTotal}\n${lines(warmTally)}`);
    const counters = (b: unknown) => { const x = b as { bybitKlineCalls?: number; candleCacheHits?: number }; return JSON.stringify({ bybitKlineCalls: x.bybitKlineCalls ?? null, candleCacheHits: x.candleCacheHits ?? null }); };
    // eslint-disable-next-line no-console
    console.log(`[B0r] counters cold=${counters(cold.body)} warm=${counters(warm.body)}`);

    assert.equal(cold.status, 200); assert.equal(warm.status, 200);
    assert.equal(sentAfterCold - sentBefore, 1, 'the one crossed alert (SOL) must be delivered exactly once on the cold pass');
    assert.equal(world.priceAlertMessages.length, sentAfterCold, 'the warm pass delivered something new: a duplicate or a false crossing');
    assert.deepEqual(world.alerts.filter(a => a.active).map(a => a.id).sort(), [301, 303, 304, 305], 'the four uncrossed alerts must stay active');
    assert.ok(warmTotal <= coldTotal, `the warm pass made MORE calls (${warmTotal}) than the cold one (${coldTotal})`);
  } finally { world.realistic = false; }
});
