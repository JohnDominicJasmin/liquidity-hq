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
import { marketStandIn } from './_marketStandIn.mts';
import { NextRequest } from 'next/server';
import {
  signalPlanFor, signalsAllowedFor, coinLockedForUnpaid, normalizeCoinId, aiCoinAllowed, gateSignal,
  FREE_SIGNAL_COINS, SIGNED_OUT_SIGNAL_COINS, type SignalPlan,
} from '../lib/signalCoinGate.ts';
import type { StrategySignal } from '../lib/useEMAStrategy.ts';
import { chartFor, contextFor, grokBody, ROUTE_NAMES_UNTRACKED_COIN, SERVER_BUILDS_PROMPT } from './_grokBody.mts';

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
  /* PAIR SYMBOLS ARE REFUSED, AND THAT IS THE PINNED EXPECTATION RATHER THAN A GAP (#1631 item 5).
     Dev nearly shipped a caller that passed `ctx.coin` here, which is `BTC/USDT` and not a coin id:
     normalizeCoinId lowercases it to `btc/usdt`, which is not on the Free list, so EVERY Free and
     trial account would have been locked out of BTC, ETH and SOL - while a Pro account saw nothing
     wrong, because aiCoinAllowed returns true for pro BEFORE it looks at the coin at all.

     A TEST ACCOUNT WITH ENTITLEMENTS CANNOT SEE AN ENTITLEMENT BUG. That is why these cases sit
     beside the free/trial rows below and not only the pro row.

     The fix belongs in the CALLER - it must pass a coin id. Teaching this function to accept pair
     symbols would be the wrong repair: `XRP/USDT` would then need handling too, and the Free list
     would stop meaning what it says. So refusal is asserted deliberately, and a future change that
     makes a pair symbol ALLOWED here should fail this cell and be argued for rather than slipped in. */
  for (const c of ['xrp', 'XRP', ' Xrp ', 'hype', 'notacoin', '', '   ', undefined, null, 5, {}, ['btc'],
    'BTC/USDT', 'btc/usdt', ' BTC/USDT ', 'BTCUSDT', 'ETH/USDT', 'SOL-USD']) {
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
/* A MOVABLE CLOCK, because lib/apiCache.ts reads Date.now and marketSnapshotData caches the
   ticker for TICKER_TTL (3 min). Without advancing it, a test that makes the ticker fail is
   served the previous test's cached ticker and reads as "the route did not refuse". The same
   pattern aiFeedsUnknownNotEmpty.test.mts uses, and safe here because the personas carry opaque
   bearer strings rather than JWTs with an exp. */
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
/** Move past every market TTL, so the next gather actually calls the stand-in. */
const expireMarketCaches = () => { clockOffset += 10 * 60_000; };

const db = {
  ai: [] as string[], reservations: 0, usageWrites: 0, ledgerInserts: 0, failSubsRead: false, banned: false,
  /* The xAI request BODIES, for #1910 item 4: the overwrite is only observable in the prompt the
     model is actually sent, and db.ai records pathnames only. */
  prompts: [] as string[],
  /* #1910 item 5: an empty TICKER SECTION is the outage the route refuses on - not an absent
     coin, which is item 6's coverage gap. Set per test, answered in the stub below. */
  emptyTicker: false,
  /* How many times the empty-ticker answer was actually served. Zero while emptyTicker is set
     means the mkt:ticker CACHE answered instead and the cell measured nothing. */
  emptyTickerServed: 0,
  /* Paths the route asked for that the stand-in does not model. Collected rather than thrown (see the fall-through below) and asserted
     after every call, so a gap names itself instead of surfacing as a status mismatch several seconds later. */
  unknown: [] as string[],
  /* Market feeds the gather reached. A cell can assert the gather HAPPENED rather than inferring
     it from a 200 - see the market stand-in below. */
  market: [] as string[],
  reset() { this.prompts = []; this.emptyTicker = false; this.emptyTickerServed = 0; this.ai = []; this.reservations = 0; this.usageWrites = 0; this.ledgerInserts = 0; this.failSubsRead = false; this.banned = false; this.unknown = []; this.market = []; },
};
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;
const noRow = () => json(406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'api.x.ai') {
    db.ai.push(url.pathname);
    /* Read off init rather than the Request, which the route may still hold. */
    db.prompts.push(typeof init?.body === 'string' ? init.body : '');
    /* A COMPLETE answer - a signal AND a whole-number confidence. These tests are about the coin ladder, the quota and the endpoint, so
       the answer's text is scaffolding; it just has to be one the route accepts. Since #1651 item 3 (owner-approved) an answer carrying
       one and not the other is asked again and then refused with 502 BAD_ANSWER, rather than shown as "BULLISH 0%" - so a stub with no
       CONFIDENCE line would make every test here fail for a reason none of them is about, and would also double the AI request count
       the ladder tests assert. The refusal itself is pinned where it belongs, in the item 3 tests. */
    if (url.pathname.endsWith('/responses')) return json(200, { model: 'qa-stand-in', usage: {}, output: [{ type: 'message', content: [{ text: 'SIGNAL: BULLISH\nCONFIDENCE: 60' }] }] });
    return json(200, { model: 'qa-stand-in', usage: {}, choices: [{ message: { content: 'SIGNAL: BULLISH\nCONFIDENCE: 60' } }] });
  }
  /* ── THE MARKET FEEDS, STUBBED SO THESE CELLS CAN REACH WHAT THEY TEST ────────────────────────
   * Shared with `aiReadChecks.test.mts`, the only other file that invokes a route which gathers
   * market data. Why it is shared rather than copied, what it is shaped for, and - importantly -
   * what may NOT be asserted from it are all in `_marketStandIn.mts`. Must run BEFORE the
   * stray-request throw below, or every market request reads as a stray. */
  /* #1910 item 5: the TICKER SECTION empty for everyone. Answered here rather than in
     __tests__/_marketStandIn.mts because that helper is shared with aiReadChecks and exists to make
     the gather SUCCEED - teaching it to fail would put a test-only failure mode into a file another
     spec depends on. marketSnapshotData reports 'ticker' in `partial` when the section comes back
     empty, and that is what arenaServerNumbers refuses on. */
  if (db.emptyTicker && url.pathname.endsWith('/ticker/24hr')) { db.emptyTickerServed++; return json(200, []); }

  {
    const answered = marketStandIn(req, url, {
      seen: (hostAndPath) => db.market.push(hostAndPath),
      gap: (what) => db.unknown.push(what),
    });
    if (answered) return answered;
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
  /* THE SNAPSHOT ROW, answered as ABSENT on purpose. `accountRatioFor` resolves the snapshot row
     before the live fan-out (`feedFor` -> `resolveFeedSnapshot` -> `readSnapshot`), which is a
     Supabase read, not an exchange call - so it belongs here and not in the market stand-in.
     `noRow()` is the DOCUMENTED path: `readSnapshot` turns 406/PGRST116 into null, and
     `resolveFeedSnapshot` then logs "no snapshot row yet - serving live" and falls through to the
     fan-out. Answering absent therefore exercises BOTH halves of the resolution order in one run,
     where seeding a row would exercise only the first and hide the second.
     Found by Dev Team running #1912's control, which printed this path in `db.unknown` - neither of
     us predicted it, and the gap report named it rather than letting it read as a route defect. */
  if (table === T('market_snapshot') && req.method === 'GET') return single ? noRow() : json(200, []);
  if (table === T('grok_usage') && req.method === 'GET') return single ? noRow() : json(200, []);
  if (table === T('app_config') && req.method === 'GET') return single ? noRow() : json(200, []);
  if (table === T('ai_call_log') && req.method === 'POST') { db.ledgerInserts++; return json(201, null); }
  /* The ban flag, read by every BILLED call (lib/authUser.ts isAccountBanned -> T.user_status). The stand-in did not know this path and
     THREW, which supabase-js reads as a network failure and retries about four times over some seven seconds - so one unmodelled read made
     R1 take ~14 s. That slowness is what let the delayed `after` restore land mid-test in a cloud container (#1683): the race needed a slow
     test to land in. Answering it is the fix the instrumented run measured; `db.banned` keeps the other half of the rule reachable. */
  if (table === T('user_status') && req.method === 'GET') {
    const row = { user_id: eq('user_id'), banned: db.banned };
    return single ? json(200, row) : json(200, [row]);
  }
  if (req.method !== 'GET') db.usageWrites++;
  /* A path the stand-in does not model is RECORDED and answered at once, never thrown. A throw is a network error to supabase-js, which
     retries it with backoff: the failure then arrives seconds late, in a shape that reads as the route misbehaving. The 501 cannot be
     mistaken for a real answer, and `nothingSpent`/`call` name the path. */
  db.unknown.push(`${req.method} ${p}`);
  return json(501, { code: 'QA_STAND_IN_GAP', message: `the stand-in does not model ${req.method} ${p}` });
}) as typeof fetch;
/* lib/xai.ts reports each AI request's outcome through a batched, delayed write (lib/apiHealth.ts). The stand-in must still be installed when that
   write fires, or it would try a real network call to the .invalid host after the last test: so restore the real fetch only after it has had time to flush. */
after(async () => { await new Promise((r) => setTimeout(r, 2500)); globalThis.fetch = realFetch; });

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service'; process.env.GROK_API_KEY = 'placeholder-grok';
/* The route is imported as a PROMISE and awaited inside each test, never with a top-level await.
 *
 * A top-level `await import` here is a race, and it is the one that made this file fail in a Claude cloud session on 2026-10-22 while
 * passing on QA's machine (#1683). node:test registers a file's tests as the module body runs; with the registration sitting behind an
 * await, a run where the import settles slowly reaches the end of the file with NO tests registered, so the runner treats the file as
 * finished and fires the `after` hook above - which puts the real `fetch` back. The import then settles, the tests register, and they run
 * with the stand-in gone: every Supabase read fails, the entitlement read reports `failed`, and the route correctly answers 503
 * PLAN_UNKNOWN where the test expected 403 COIN_LOCKED. Nothing about the product is involved.
 *
 * Awaiting the promise per test makes every test register synchronously, so the file can never look finished before they exist. */
const routeP = import('../app/api/grok/route.ts') as Promise<{ POST: (r: NextRequest) => Promise<Response> }>;

/* THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS, and this says so out loud rather than letting the test fail somewhere downstream.
   Without it, a run where the real `fetch` is back reads as a product failure: every Supabase read fails, so the entitlement read reports
   `failed` and the route answers its designed 503 PLAN_UNKNOWN where the test asked for 403 COIN_LOCKED - which is what #1683 looked like
   for an hour. A test that asserts the shape of its own instrument cannot be read as a finding about the app. */
const standInFetch = globalThis.fetch;
const assertStandIn = () => assert.equal(globalThis.fetch, standInFetch,
  'the network stand-in is not installed: the real fetch is back, so this run measures nothing about the route - see #1683 (a top-level await used to let the after hook restore fetch before the tests registered)');

/* THE BODY IS BUILT PER TREE (#1631 item 5). `/api/grok` now builds the prompt server-side and
   REFUSES a body carrying the client-built one, so the old shape and the new one cannot both be
   sent - and this file has to stay green on `dev` and on the branch, per CONTRIBUTING's "QA
   loosens first". `_grokBody.mts` picks the shape by reading the tree; the cells below name the
   two places where the ROUTE'S ANSWER genuinely differs rather than relaxing to the weaker one. */
type Body = { type?: 'quick' | 'deep'; tf?: string; coin?: unknown; prompt?: string; override?: Record<string, unknown> };
const call = async (who: keyof typeof PERSONAS | null, b: Body = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${PERSONAS[who].token}`;
  assertStandIn();
  const { POST } = await routeP;
  const r = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers, body: JSON.stringify(grokBody(b)) }));
  assert.deepEqual(db.unknown, [], 'the route read a path the stand-in does not model: every result below it is about the gap, not about the route');
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};
const nothingSpent = (label: string) => { assert.equal(db.ai.length, 0, `${label}: an AI request was made`); assert.equal(db.reservations, 0, `${label}: quota was reserved`); assert.equal(db.ledgerInserts, 0, `${label}: the spend ledger was written`); };

test('R1. Free on a locked coin, however it is written, or on no coin: refused (403 COIN_LOCKED, or 400 COIN_REQUIRED) with ZERO AI requests, ZERO quota reservations, zero ledger writes', async () => {
  /* TRACKED coins the Free plan may not have. Case and padding vary on purpose - they are the
     normalisation coverage, and they survive the shape change because the new validator normalises
     outer padding and the id's case too. */
  for (const type of ['quick', 'deep'] as const) for (const coin of ['xrp', 'XRP', ' Xrp ', 'hype', 'doge']) {
    db.reset(); const r = await call('free', { type, coin });
    assert.equal(r.status, 403, `${type} ${coin}: ${r.status}`); assert.equal(r.body.code, 'COIN_LOCKED'); nothingSpent(`${type} ${coin}`);
  }

  /* AN UNTRACKED COIN MOVED, AND IT IS A REAL BEHAVIOUR CHANGE RATHER THAN A STALE FIXTURE.
     Old: `notacoin` reached the ladder, was not on the Free list, and came back 403 COIN_LOCKED.
     New: `parseArenaContext` refuses a pair naming no tracked coin, so it never reaches the ladder
     and the answer is a flat 400 for EVERY tier, Pro included - validation runs before the plan
     read and before `aiCoinAllowed`.
     **Both are correct and the new one is better: an unknown coin is not "locked", it is unknown,
     and refusing it before any entitlement is consulted is the stricter order.** Named here rather
     than relaxed to whichever status both happen to share. */
  for (const type of ['quick', 'deep'] as const) {
    db.reset(); const r = await call('free', { type, coin: 'notacoin' });
    if (SERVER_BUILDS_PROMPT) {
      assert.equal(r.status, 400, `${type} notacoin: ${r.status}`);
      assert.equal(r.body.error, 'Invalid request.');
      /* THE REFUSAL GAINED A NAME, and that is a third tree state rather than a correction.
         Item 5 refused an untracked coin flat. #1855 then offers 463 coins of which 413 are
         untracked, so a user picking one out of our own list got an untranslated English string
         from a generic client branch - the code exists so the Arena can say something true in
         their language. My pin said "carries no typed code", which was right about the behaviour
         at the time and is why this reads as a change rather than as a surprise. */
      assert.equal(r.body.code, ROUTE_NAMES_UNTRACKED_COIN ? 'COIN_NOT_TRACKED' : undefined);
    } else {
      assert.equal(r.status, 403, `${type} notacoin: ${r.status}`); assert.equal(r.body.code, 'COIN_LOCKED');
    }
    nothingSpent(`${type} notacoin`);
  }

  /* THE CONTROL THAT STOPS THE NAME BECOMING A SHAPE ORACLE. Dev's point, and it is the half that
     makes the code worth having: ONLY the untracked coin is named. Any other parse failure must
     stay a flat 400 with no code, or the typed answer starts telling a caller which field it got
     wrong - which is a probe, not an error message. `context.price` as a NUMBER is a parse failure
     that has nothing to do with the coin. */
  if (SERVER_BUILDS_PROMPT) {
    db.reset();
    const bad = await call('free', { override: { context: { ...contextFor('BTC/USDT'), price: 1 }, chart: chartFor('1h') } });
    assert.equal(bad.status, 400, 'a non-string context field must be refused');
    assert.equal(bad.body.error, 'Invalid request.');
    assert.equal(bad.body.code, undefined, 'only the untracked coin is named; every other parse failure stays flat');
    nothingSpent('non-string context field');
  }

  /* AND IT IS NOT A TIER DECISION. Validation precedes the plan read, so an untracked coin is
     refused identically for Pro - the one account that may run every TRACKED coin. The contrast
     with the 403 arm above is the point: "unknown" and "locked" are different answers and must not
     collapse into one. */
  if (SERVER_BUILDS_PROMPT) {
    for (const who of ['free', 'trial', 'pro'] as const) {
      db.reset(); const r = await call(who, { coin: 'notacoin' });
      assert.equal(r.status, 400, `${who} on an untracked coin: ${r.status}`);
      assert.equal(r.body.code, ROUTE_NAMES_UNTRACKED_COIN ? 'COIN_NOT_TRACKED' : undefined, `${who}`);
      nothingSpent(`${who} untracked`);
    }
    db.reset();
    const locked = await call('free', { coin: 'xrp' });
    assert.equal(locked.status, 403, 'a TRACKED coin the plan may not have is still COIN_LOCKED');
    assert.equal(locked.body.code, 'COIN_LOCKED');
  }

  /* NO COIN, OR A COIN THAT IS NOT A STRING. Refused either way and nothing is spent - which is
     the property the cell is for. The two trees refuse it at different gates, so they say so
     differently: COIN_REQUIRED from the ladder, or the parser's flat 400 before it. */
  for (const coin of [undefined, '', '   ', 5, null, {}]) {
    db.reset(); const r = await call('free', { coin });
    assert.equal(r.status, 400, `${JSON.stringify(coin)}: ${r.status}`);
    if (SERVER_BUILDS_PROMPT) assert.equal(r.body.error, 'Invalid request.');
    else assert.equal(r.body.code, 'COIN_REQUIRED');
    nothingSpent(String(coin));
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
  /* "No coin is not a loophole" holds on both trees; WHERE it is stopped moved. Old: the plan read
     failed first, so a coinless request got 503 PLAN_UNKNOWN. New: the body is refused as
     malformed before the plan is read at all. The assertion that matters - refused, nothing spent
     - is unchanged, and the status is named per tree rather than relaxed to "not 200". */
  assert.equal(r.status, SERVER_BUILDS_PROMPT ? 400 : 503); nothingSpent('failed read, no coin');
});

test('R7. no token, or a token the database does not know: 401 and nothing is spent', async () => {
  db.reset(); const r = await call(null, { coin: 'btc' });
  assert.equal(r.status, 401); nothingSpent('no token');
  db.reset();
  const { POST } = await routeP;
  /* Built by the shared helper like every other call. It was a hand-written legacy body, which on
     the new tree is refused as STALE_CLIENT with a 400 - so the cell would have been testing the
     stale-shape guard rather than "a forged token is refused", and passing for the wrong reason is
     indistinguishable from passing. */
  const r2 = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers: { authorization: 'Bearer tok_forged', 'content-type': 'application/json' }, body: JSON.stringify(grokBody({ coin: 'btc' })) }));
  assert.equal(r2.status, 401); nothingSpent('forged');
});

test('R8. the older fast-timeframe gate still refuses a Free account on 5m before anything is spent (no regression from the new check)', async () => {
  db.reset(); const r = await call('free', { tf: '5m', coin: 'btc' });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRO_REQUIRED'); nothingSpent('fast tf');
});

test('K1. the declared coin and the analysed coin: a pinned LIMIT on the old route, a CLOSED one on the new', async () => {
  /* THE CELL THAT WOULD HAVE PASSED WHILE MEASURING NOTHING, which is why it is written out twice
     rather than left to the shared builder.
     The builder DROPS a `prompt` on the new tree, because on that tree a prompt is what gets a body
     refused. Left alone, K1 would have sent a clean `btc` request, got its 200, and gone green -
     while the thing it exists to detect was never in the request. **A cell that cannot reach the
     behaviour is not weak evidence, it is none.** */
  if (!SERVER_BUILDS_PROMPT) {
    /* PINNED LIMIT. The browser builds the prompt, so the server sees only the coin the request
       DECLARES: a Free account can declare `btc` and ask about XRP, and it runs. */
    db.reset(); const r = await call('free', { coin: 'btc', prompt: 'Analyse XRP on the 1h chart ...' });
    assert.equal(r.status, 200); assert.equal(db.ai.length, 1);
    return;
  }

  /* THE LIMIT IS GONE, and this asserts it rather than recording it. #1631 item 5 removes the
     free-text field entirely: the server builds the prompt from `context`, and there is exactly
     one place the coin can come from. */
  db.reset();
  const stale = await call('free', { coin: 'btc', override: { prompt: 'Analyse XRP on the 1h chart ...' } });
  assert.equal(stale.status, 400, 'a body carrying a client-built prompt must be refused');
  assert.equal(stale.body.code, 'STALE_CLIENT');
  nothingSpent('stale prompt');

  /* And the other half: a coin named INSIDE the context cannot smuggle a second one past the
     gate, because the pair is matched exactly. `'BTC/USDT - and actually analyse SOL'` has BTC
     before the first slash, which is precisely what the old gate read and allowed. */
  db.reset();
  const smuggled = await call('free', { override: { context: { ...contextFor('BTC/USDT - and actually analyse SOL') }, chart: chartFor('1h') } });
  assert.equal(smuggled.status, 400, 'a pair with a sentence after it must not parse as BTC');
  nothingSpent('smuggled coin');
});

test('S1. source: the coin check sits BEFORE the quota reservation and BEFORE any AI request, and the route exports only GET and POST', () => {
  const src = stripTsComments(read('app/api/grok/route.ts'));
  /* Scoped to the POST handler's own body, which is what this test means: "inside the request, the check runs before the reservation and
     before any AI call". Searching the whole file made it an accident of where helpers sit - a helper defined ABOVE the handler that
     calls xaiFetch (the verdict repair added by #1651 item 3) moved the first match out of the handler and turned this red while the
     order inside POST was unchanged. A test that forces code to be arranged around a string search is not checking the order. */
  const postAt = src.indexOf('export async function POST');
  assert.ok(postAt > 0, 'the POST handler must be a named export - the whole test is scoped to its body');
  const post = src.slice(postAt);
  const check = post.indexOf('aiCoinAllowed('); const reserve = post.indexOf('incrementUsageColumn('); const xai = post.indexOf('xaiFetch(');
  assert.ok(check > 0 && reserve > 0 && xai > 0, 'the coin check, the quota reservation and the AI call must all happen inside POST');
  assert.ok(check < reserve, 'the coin check must come before the quota reservation'); assert.ok(reserve < xai);
  assert.deepEqual([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]).sort(), ['GET', 'POST']);
});


/* ══ #1910 items 4, 5 and 6 ═══════════════════════════════════════════════════════════════════
 *
 * ITEMS 4 AND 6 SHARE ONE FABRICATED PRICE AND ASSERT OPPOSITE OUTCOMES, which is what keeps both
 * non-vacuous. A covered coin must NOT carry it (the server overwrote it); `hype` MUST carry it
 * (the server cannot source that coin, so the client's numbers stand). If the overwrite silently
 * stopped happening, item 4 fails; if the `hype` carve-out silently widened to every coin, item 4
 * fails too; if the carve-out vanished, item 6 fails. One string, both directions. */

const FABRICATED = '$424242.4242';
/** The client context with a price no feed could produce, so its presence or absence is attributable. */
const lying = (coin: string) => ({ ...contextFor(coin), price: FABRICATED });

test('4. the server overwrites the client\'s numbers: a fabricated price never reaches the model', async () => {
  db.reset();
  const r = await call('pro', { type: 'quick', coin: 'btc', override: { context: lying('BTC/USDT') } });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
  assert.equal(db.prompts.length, 1, 'exactly one xAI request should carry the prompt under test');

  const prompt = db.prompts[0];
  assert.ok(prompt.length > 0, 'the xAI request body was empty, so nothing below is measuring a prompt');
  assert.ok(!prompt.includes(FABRICATED),
    `the fabricated client price ${FABRICATED} reached the model. This is the security property #1910 exists for: the route spreads its own fields LAST over the client context, so a value the client sent must not survive for a covered coin`);

  /* NOT ONLY "the lie is gone" - the server's own value must be there, or an empty price would pass. */
  const { arenaServerNumbers } = await import('../lib/arenaServerNumbers.ts');
  const gathered = await arenaServerNumbers('btc');
  assert.equal(gathered.ok, true, 'the gather failed inside this test, so there is no server price to compare against');
  if (!gathered.ok) return;
  const serverPrice = gathered.fields.price;
  assert.ok(serverPrice && serverPrice !== '-',
    `the server sourced no price (${JSON.stringify(serverPrice)}), so "the fabricated one is absent" would pass on an empty field`);
  assert.ok(prompt.includes(serverPrice as string),
    `the prompt carries neither the client's price nor the server's (${serverPrice}) - the field was dropped rather than overwritten`);
});

test('5. an empty ticker section refuses with MARKET_UNAVAILABLE and spends nothing', async () => {
  db.reset();
  db.emptyTicker = true;
  expireMarketCaches();
  const r = await call('pro', { type: 'quick', coin: 'btc' });

  /* FIRST: did the outage actually reach the route? A warm mkt:ticker cache answers instead, and
     then a 200 below would read as "the route refused to refuse" when nothing was ever asked. */
  assert.ok(db.emptyTickerServed > 0,
    'the empty-ticker stub never fired: the mkt:ticker cache answered, so this cell measured nothing about the refusal');

  assert.equal(r.status, 503, `expected 503, got ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
  assert.equal(r.body.code, 'MARKET_UNAVAILABLE',
    `expected code MARKET_UNAVAILABLE, got ${JSON.stringify(r.body.code)} - the refusal must be the typed one the classifier and the client both read`);

  /* THE ORDERING IS THE WHOLE POINT OF #1910 AND NOTHING ELSE ENFORCES IT: the gather runs BEFORE
     the usage reservation, so a feed outage costs the user no quota and makes no AI call. */
  nothingSpent('5. market outage');
  assert.equal(db.usageWrites, 0, '5. market outage: a usage row was written for a request that never reached the model');
});

test('5b. CONTROL: the same request with the ticker present is served, so 5 is not passing on a broken stub', async () => {
  db.reset();
  expireMarketCaches();   // or this reads item 5's empty ticker out of the cache
  const r = await call('pro', { type: 'quick', coin: 'btc' });
  assert.equal(r.status, 200, `the covered path is broken independently of item 5: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  assert.equal(db.ai.length, 1, 'the control made no AI request, so item 5 proving "nothing spent" says nothing');
  assert.equal(db.reservations, 1, 'the control reserved no quota, so item 5 proving "no reservation" says nothing');
});

test('6. a coin outside server coverage keeps the client numbers, and is served rather than refused', async () => {
  db.reset();
  const r = await call('pro', { type: 'quick', coin: 'hype', override: { context: lying('HYPE/USDT') } });

  /* NOT 503. Refusing here would turn "the server cannot source HYPE" into "Pro users get no AI read
     on HYPE" - removing a paid feature to close a hole that is open for every coin today. #1910's
     body argues the choice; this cell is what makes it a decision rather than a drift. */
  assert.equal(r.status, 200, `a coin outside coverage must still be served, got ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
  assert.equal(db.prompts.length, 1, 'no prompt was captured, so nothing below is measuring one');

  assert.ok(db.prompts[0].includes(FABRICATED),
    `the client's price did not survive for hype. For a coin the server cannot source, fields is empty and the browser's numbers stand - if this fails, either the carve-out is gone or hype entered the snapshot. If hype ENTERED the snapshot, delete the carve-out rather than loosening this cell`);
});
