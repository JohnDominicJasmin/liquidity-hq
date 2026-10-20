/* #1596 (#1604): Free AND free-trial accounts get Buy/Sell signals, Quick Research and Deep Research only on BTC, ETH and SOL; paid Pro gets every coin;
 * signed-out visitors are unchanged. A locked coin shows a clean chart (no markers, no locked circles) for Free and trial.
 *
 * TWO LAYERS.
 *   1. PURE functions of lib/signalCoinGate.ts: the plan ladder, the coin lists, the server's question, and gateSignal().
 *   2. THE REAL /api/grok ROUTE with a stand-in network. `POST` is imported from app/api/grok/route.ts and called with real NextRequests. Only the network is
 *      replaced: one in-memory Supabase (auth, the subscription row, usage, the feature flag, the usage reservation, the spend ledger) and one stand-in AI host
 *      that COUNTS the requests it receives. So the property the owner asked for, "a refused request makes no AI call and takes no quota", is observed, not assumed.
 *
 * WHAT THIS PROVES: the ladder and the order of checks (refusal BEFORE the quota reservation and BEFORE any AI request) for the coin a request DECLARES.
 * WHAT IT CANNOT PROVE (the verdict says so): that the browser sends the right coin or draws a clean chart (that is a page-level check on qa, counted from the chart's own
 * overlays); a real database; and the server cannot see the coin inside the prompt the browser builds, so a hand-made request that declares `btc` and describes XRP
 * runs. The last one is pinned below as a KNOWN limit (K1), so a change to it shows up.
 *
 * NO REAL CREDENTIALS, NO REAL DATABASE, NO REAL AI. The Supabase URL is a `.invalid` host and the keys are placeholders; any request to a host that is not the
 * stand-in database or the stand-in AI host fails the test instead of leaving the machine. */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  signalPlanFor, signalsAllowedFor, coinLockedForUnpaid, normalizeCoinId, aiCoinAllowed, gateSignal,
  FREE_SIGNAL_COINS, SIGNED_OUT_SIGNAL_COINS, type SignalPlan,
} from '../lib/signalCoinGate.ts';
import type { StrategySignal } from '../lib/useEMAStrategy.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 1. pure ──────────────────────────────────────────────────────────── */

const base = { signedIn: true, entitlementStatus: 'not_entitled' as const, authLoading: false, isPro: false, entitlementsLoading: false };

test('P1. signalPlanFor: paid -> pro, TRIAL -> trial (never pro: the reported bug), not entitled -> free, signed out, loading -> pending, a settled read with no answer -> null', () => {
  assert.equal(signalPlanFor({ ...base, entitlementStatus: 'entitled', isPro: true }), 'pro');
  assert.equal(signalPlanFor({ ...base, entitlementStatus: 'entitled', isPro: false }), 'trial');
  assert.equal(signalPlanFor({ ...base }), 'free');
  assert.equal(signalPlanFor({ ...base, signedIn: false }), 'signed_out');
  assert.equal(signalPlanFor({ ...base, authLoading: true }), 'pending');
  assert.equal(signalPlanFor({ ...base, entitlementsLoading: true }), 'pending');
  assert.equal(signalPlanFor({ ...base, entitlementStatus: 'unknown' }), null);
  // loading outranks everything else, including a signed-out guess and a stale answer
  assert.equal(signalPlanFor({ ...base, authLoading: true, signedIn: false }), 'pending');
  assert.equal(signalPlanFor({ ...base, entitlementsLoading: true, entitlementStatus: 'entitled', isPro: true }), 'pending');
});

test('P2. the lists: Free and trial see exactly BTC, ETH, SOL; signed out exactly BTC; paid Pro and a plan not yet known see every coin or nothing is locked', () => {
  assert.deepEqual([...FREE_SIGNAL_COINS], ['btc', 'eth', 'sol']);
  assert.deepEqual([...SIGNED_OUT_SIGNAL_COINS], ['btc']);
  const coins = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'doge', 'xau', 'spx'];
  for (const plan of ['free', 'trial'] as SignalPlan[]) for (const c of coins) {
    assert.equal(signalsAllowedFor(plan, c), ['btc', 'eth', 'sol'].includes(c), `${plan} ${c}`);
    assert.equal(coinLockedForUnpaid(plan, c), !['btc', 'eth', 'sol'].includes(c), `${plan} ${c} lock`);
  }
  for (const c of coins) {
    assert.equal(signalsAllowedFor('pro', c), true); assert.equal(coinLockedForUnpaid('pro', c), false);
    assert.equal(signalsAllowedFor(null, c), true); assert.equal(coinLockedForUnpaid(null, c), false, 'a failed read must never lock');
    assert.equal(coinLockedForUnpaid('pending', c), false, 'a loading plan must never show the lock');
    assert.equal(signalsAllowedFor('signed_out', c), c === 'btc');
    assert.equal(coinLockedForUnpaid('signed_out', c), false, 'signed-out is sent to sign in, not told to upgrade');
  }
  // a plan that is still loading shows no signal on a coin outside the Free list (so Pro markers never flash for a Free account)
  assert.equal(signalsAllowedFor('pending', 'xrp'), false); assert.equal(signalsAllowedFor('pending', 'btc'), true);
});

test('P3. the server\'s question: only paid Pro may name any coin; everyone else only the three, spelled however; no coin is never allowed for them', () => {
  for (const c of ['xrp', 'XRP', ' Xrp ', 'hype', 'notacoin', '', '   ', undefined, null, 5, {}, ['btc']]) {
    assert.equal(aiCoinAllowed('free', c), false, `free ${JSON.stringify(c)}`); assert.equal(aiCoinAllowed('trial', c), false, `trial ${JSON.stringify(c)}`);
  }
  for (const c of ['btc', 'BTC', ' Eth ', 'sol', '\tSOL\n']) { assert.equal(aiCoinAllowed('free', c), true, c); assert.equal(aiCoinAllowed('trial', c), true, c); }
  for (const c of ['xrp', 'btc', undefined, '']) assert.equal(aiCoinAllowed('pro', c), true, `pro ${String(c)}`);
  assert.equal(normalizeCoinId(' XRP '), 'xrp'); assert.equal(normalizeCoinId(''), null); assert.equal(normalizeCoinId('  '), null); assert.equal(normalizeCoinId(7), null); assert.equal(normalizeCoinId(undefined), null);
});

const SIG = (over: Partial<StrategySignal> = {}): StrategySignal => ({
  verdict: 'TRENDING LONG', phase: 'Trend up', conditions: [{ label: 'x', met: true } as never], ema9_4h: 1, ema20_4h: 1, ema50_4h: 1, sma200_1d: 1, volMA20: 1, lastVol: 1,
  priceInValueZone: true, sl: 1, tp: 2, loading: false, error: null, signalTimestamp: 5, signalAnchorPrice: 9, signalDir: 'long',
  signalLongs: [{ timestamp: 1, anchorPrice: 1, pending: false }, { timestamp: 2, anchorPrice: 2, pending: false }], signalShorts: [{ timestamp: 3, anchorPrice: 3, pending: false }],
  pendingSetup: { dir: 'long', held: 1, need: 3 }, signalLock: null, lockedMarkers: [{ timestamp: 1, anchorPrice: 1 }, { timestamp: 2, anchorPrice: 2 }, { timestamp: 3, anchorPrice: 3 }],
  counterTrend: false, atrLast: 1, ema50Slope: 0, chopIndex: 1, chopRegime: null, reversalWarnings: [{ timestamp: 1, anchorPrice: 1, dir: 'bullish' }],
  recentStats: { total: 1, wins: 1, losses: 0, open: 0, netR: 1 }, weakEdge: false, verdictChangedBySelection: false, ...over,
} as unknown as StrategySignal);

test('P4. gateSignal: Free and trial on a locked coin get a CLEAN chart (no markers, no locked circles, no verdict); signed out keeps its circles; pending is "loading"; allowed and unknown plans pass through untouched', () => {
  for (const plan of ['free', 'trial'] as SignalPlan[]) {
    const s = SIG(); const g = gateSignal(s, plan, 'xrp');
    assert.deepEqual(g.signalLongs, []); assert.deepEqual(g.signalShorts, []); assert.deepEqual(g.lockedMarkers, [], `${plan}: padlock circles must be gone`);
    assert.equal(g.verdict, 'FREEZE'); assert.equal(g.signalDir, null); assert.equal(g.pendingSetup, null); assert.equal(g.signalLock, 'free');
    assert.deepEqual(g.reversalWarnings, []); assert.equal(g.recentStats, null); assert.deepEqual(g.conditions, []);
    assert.equal(s.signalLongs.length, 2, 'the input signal must not be mutated');
  }
  const out = gateSignal(SIG(), 'signed_out', 'xrp');
  assert.equal(out.lockedMarkers.length, 3, 'signed-out keeps the circles it has today'); assert.equal(out.signalLock, 'signed_out'); assert.deepEqual(out.signalLongs, []);
  const pend = gateSignal(SIG(), 'pending', 'xrp');
  assert.equal(pend.loading, true); assert.equal(pend.verdict, 'LOADING'); assert.deepEqual(pend.lockedMarkers, []); assert.equal(pend.signalLock, null); assert.deepEqual(pend.signalLongs, []);
  const s2 = SIG();
  assert.equal(gateSignal(s2, 'pro', 'xrp'), s2); assert.equal(gateSignal(s2, 'free', 'btc'), s2); assert.equal(gateSignal(s2, null, 'xrp'), s2); assert.equal(gateSignal(s2, 'pending', 'btc'), s2);
  const loading = SIG({ loading: true }); assert.equal(gateSignal(loading, 'free', 'xrp'), loading, 'a signal that is still loading is returned as is');
});

/* ── 2. the real /api/grok route ─────────────────────────────────────── */

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const DAY = 86400_000;
type Persona = { token: string; id: string; row: Record<string, unknown> | null };
const PERSONAS: Record<string, Persona> = {
  free:   { token: 'tok_free',   id: 'u-free',   row: { role: 'free', trial_ends_at: null, current_period_end: null } },
  trial:  { token: 'tok_trial',  id: 'u-trial',  row: { role: 'free', trial_ends_at: new Date(Date.now() + 7 * DAY).toISOString(), current_period_end: null } },
  pro:    { token: 'tok_pro',    id: 'u-pro',    row: { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 20 * DAY).toISOString() } },
  lapsed: { token: 'tok_lapsed', id: 'u-lapsed', row: { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() - 5 * DAY).toISOString() } },
  none:   { token: 'tok_none',   id: 'u-none',   row: null },
};
const db = {
  ai: [] as string[], reservations: 0, usageWrites: 0, ledgerInserts: 0, failSubsRead: false,
  reset() { this.ai = []; this.reservations = 0; this.usageWrites = 0; this.ledgerInserts = 0; this.failSubsRead = false; },
};
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;
const noRow = () => json(406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'api.x.ai') {
    db.ai.push(url.pathname);
    if (url.pathname.endsWith('/responses')) return json(200, { model: 'qa-stand-in', usage: {}, output: [{ type: 'message', content: [{ text: 'SIGNAL: BULLISH' }] }] });
    return json(200, { model: 'qa-stand-in', usage: {}, choices: [{ message: { content: 'SIGNAL: BULLISH' } }] });
  }
  if (url.origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  const p = url.pathname; const q = url.searchParams;
  const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
  const eq = (k: string) => (q.get(k) ?? '').replace(/^eq\./, '');
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const who = Object.values(PERSONAS).find((x) => x.token === bearer);

  if (p === '/auth/v1/user') return who ? json(200, { id: who.id, aud: 'authenticated', email: `${who.id}@example.test` }) : json(401, { message: 'invalid JWT' });
  const rpc = p.match(/^\/rest\/v1\/rpc\/(.+)$/);
  if (rpc) {
    if (rpc[1] === 'increment_ai_usage') { db.reservations++; return json(200, 1); }
    if (rpc[1] === 'lhq_ai_spend_user_since' || rpc[1] === 'lhq_ai_spend_all_since') return json(200, [{ cost: 0, null_search: 0, null_other: 0 }]);
    if (/record_api_health/.test(rpc[1])) return json(200, null); // lib/xai.ts reports the outcome of every AI request (only reached when an AI request was made)
    throw new Error(`stand-in does not know rpc ${rpc[1]}`);
  }
  const table = p.replace('/rest/v1/', '');
  if (table === T('user_subscriptions') && req.method === 'GET') {
    if (db.failSubsRead) return json(500, { code: 'XX000', message: 'subs read boom' });
    const owner = Object.values(PERSONAS).find((x) => x.id === eq('user_id'));
    return owner?.row ? (single ? json(200, owner.row) : json(200, [owner.row])) : (single ? noRow() : json(200, []));
  }
  if (table === T('grok_usage') && req.method === 'GET') return single ? noRow() : json(200, []);
  if (table === T('app_config') && req.method === 'GET') return single ? noRow() : json(200, []);
  if (table === T('ai_call_log') && req.method === 'POST') { db.ledgerInserts++; return json(201, null); }
  if (req.method !== 'GET') db.usageWrites++;
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
/* lib/xai.ts reports each AI request's outcome through a batched, delayed write (lib/apiHealth.ts). The stand-in must still be installed when that
   write fires, or it would try a real network call to the .invalid host after the last test: so restore the real fetch only after it has had time to flush. */
after(async () => { await new Promise((r) => setTimeout(r, 2500)); globalThis.fetch = realFetch; });

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service'; process.env.GROK_API_KEY = 'placeholder-grok';
const { POST } = await import('../app/api/grok/route.ts') as { POST: (r: NextRequest) => Promise<Response> };

type Body = { type?: 'quick' | 'deep'; tf?: string; coin?: unknown; prompt?: string };
const call = async (who: keyof typeof PERSONAS | null, b: Body = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${PERSONAS[who].token}`;
  const r = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers, body: JSON.stringify({ prompt: 'qa prompt', tf: '1h', session: 'ny', type: 'quick', ...b }) }));
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};
const nothingSpent = (label: string) => { assert.equal(db.ai.length, 0, `${label}: an AI request was made`); assert.equal(db.reservations, 0, `${label}: quota was reserved`); assert.equal(db.ledgerInserts, 0, `${label}: the spend ledger was written`); };

test('R1. Free on a locked coin, however it is written, or on no coin: refused (403 COIN_LOCKED, or 400 COIN_REQUIRED) with ZERO AI requests, ZERO quota reservations, zero ledger writes', async () => {
  for (const type of ['quick', 'deep'] as const) for (const coin of ['xrp', 'XRP', ' Xrp ', 'hype', 'doge', 'notacoin']) {
    db.reset(); const r = await call('free', { type, coin });
    assert.equal(r.status, 403, `${type} ${coin}: ${r.status}`); assert.equal(r.body.code, 'COIN_LOCKED'); nothingSpent(`${type} ${coin}`);
  }
  for (const coin of [undefined, '', '   ', 5, null, {}]) {
    db.reset(); const r = await call('free', { coin });
    assert.equal(r.status, 400, `${JSON.stringify(coin)}: ${r.status}`); assert.equal(r.body.code, 'COIN_REQUIRED'); nothingSpent(String(coin));
  }
});

test('R2. a TRIAL account is refused on a locked coin exactly like Free (the reported bug: a trial was treated as Pro)', async () => {
  for (const type of ['quick', 'deep'] as const) for (const coin of ['xrp', 'XRP', 'hype']) {
    db.reset(); const r = await call('trial', { type, coin });
    assert.equal(r.status, 403, `${type} ${coin}`); assert.equal(r.body.code, 'COIN_LOCKED'); nothingSpent(`trial ${type} ${coin}`);
  }
  db.reset(); const none = await call('none', { coin: 'xrp' });
  assert.equal(none.status, 403, 'an account with no subscription row is Free'); nothingSpent('no row');
});

test('R3. Free and trial on BTC, ETH, SOL (any spelling): allowed, one AI request each, one quota reservation, on the right endpoint for Quick and Deep', async () => {
  for (const who of ['free', 'trial'] as const) for (const coin of ['btc', 'ETH', ' Sol ']) for (const type of ['quick', 'deep'] as const) {
    db.reset(); const r = await call(who, { type, coin });
    assert.equal(r.status, 200, `${who} ${type} ${coin}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(db.ai.length, 1); assert.equal(db.reservations, 1);
    assert.ok(db.ai[0].endsWith(type === 'deep' ? '/responses' : '/chat/completions'), db.ai[0]);
  }
});

test('R4. paid Pro may run any coin, including one no other plan can', async () => {
  for (const coin of ['xrp', 'hype', 'doge']) for (const type of ['quick', 'deep'] as const) {
    db.reset(); const r = await call('pro', { type, coin });
    assert.equal(r.status, 200, `${type} ${coin}: ${r.status}`); assert.equal(db.ai.length, 1); assert.equal(db.reservations, 1);
  }
});

test('R5. a paid account whose period lapsed more than the 48 h grace is Free for this gate: refused on a locked coin', async () => {
  db.reset(); const r = await call('lapsed', { coin: 'xrp' });
  assert.equal(r.status, 403); nothingSpent('lapsed');
});

test('R6. the plan read FAILS: a locked coin is 503 PLAN_UNKNOWN (retry) with no AI request and no reservation; a coin on the Free list still goes through; no coin is not a loophole', async () => {
  db.reset(); db.failSubsRead = true;
  let r = await call('pro', { coin: 'xrp' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'PLAN_UNKNOWN'); nothingSpent('failed read, xrp');
  db.reset(); db.failSubsRead = true;
  r = await call('pro', { coin: 'btc' });
  assert.equal(r.status, 200, 'a paying user on a Free-list coin must not be locked out by a failed read'); assert.equal(db.ai.length, 1);
  db.reset(); db.failSubsRead = true;
  r = await call('pro', {});
  assert.equal(r.status, 503); nothingSpent('failed read, no coin');
});

test('R7. no token, or a token the database does not know: 401 and nothing is spent', async () => {
  db.reset(); const r = await call(null, { coin: 'btc' });
  assert.equal(r.status, 401); nothingSpent('no token');
  db.reset();
  const r2 = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers: { authorization: 'Bearer tok_forged', 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'p', tf: '1h', session: 'ny', type: 'quick', coin: 'btc' }) }));
  assert.equal(r2.status, 401); nothingSpent('forged');
});

test('R8. the older fast-timeframe gate still refuses a Free account on 5m before anything is spent (no regression from the new check)', async () => {
  db.reset(); const r = await call('free', { tf: '5m', coin: 'btc' });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRO_REQUIRED'); nothingSpent('fast tf');
});

test('K1. KNOWN LIMIT, PINNED: the server trusts the coin a request DECLARES. A Free account that declares btc and sends a prompt about another coin runs. If this goes red the check moved to the server (good): tell the owner.', async () => {
  db.reset(); const r = await call('free', { coin: 'btc', prompt: 'Analyse XRP on the 1h chart ...' });
  assert.equal(r.status, 200); assert.equal(db.ai.length, 1);
});

test('S1. source: the coin check sits BEFORE the quota reservation and BEFORE any AI request, and the route exports only GET and POST', () => {
  const src = stripTsComments(read('app/api/grok/route.ts'));
  const check = src.indexOf('aiCoinAllowed('); const reserve = src.indexOf('incrementUsageColumn('); const xai = src.indexOf('xaiFetch(');
  assert.ok(check > 0 && reserve > 0 && xai > 0);
  assert.ok(check < reserve, 'the coin check must come before the quota reservation'); assert.ok(reserve < xai);
  assert.deepEqual([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]).sort(), ['GET', 'POST']);
});
