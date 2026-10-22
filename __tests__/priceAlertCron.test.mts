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
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'api.telegram.org') {
    const body = JSON.parse(await req.text()) as { text: string };
    if (body.text.includes('Price Alert Triggered')) world.priceAlertMessages.push(body.text);
    return world.telegram === 'ok' ? json(200, { ok: true }) : json(403, { ok: false, description: 'Forbidden: bot was blocked by the user' });
  }
  if (url.host === 'api.bybit.com' && url.pathname === '/v5/market/tickers') {
    return json(200, { retCode: 0, result: { list: url.searchParams.get('category') === 'spot' ? [{ symbol: 'BTCUSDT', lastPrice: String(world.btc) }] : [] } });
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

const { GET } = await import('../app/api/telegram/alert/route.ts');
const run = async () => {
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
