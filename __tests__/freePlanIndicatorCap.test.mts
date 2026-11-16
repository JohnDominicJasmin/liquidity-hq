/* #2466: a Free account with a stale saved list of four indicators must not get four. The cap lives in three places and each is pinned:
 *   P1-P4  lib/strategyRegistry selectionForPlan (the pure rule the Arena page and /api/grok use) and lib/chatPrompt capChatSelection
 *   R1-R4  the REAL /api/grok-chat route: what the system prompt sent to xAI names, for a Free, Pro, plan-unknown and no-selection caller
 *   S1     /api/grok source order: the cap is applied BEFORE the prompt is built (that route's data gather is too heavy for a stand-in)
 * Same stand-in network as grokChatServerPrompt.test.mts; the subscription row is the plan. */
import test, { after, afterEach, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.GROK_API_KEY = 'placeholder-xai';
const UID = '77777777-7777-4777-8777-777777777777'; const EMAIL = 'qa@example.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ---- a token, signed here ---- */
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
const ANSWER = 'XRP holds the $2.30 bid wall.\n- bias: neutral\nFOLLOW-UPS:\n1. Where is the next ask wall?\n- What does funding say now?\n• Is volume confirming the bounce?';
const RAW = { model: 'grok-4.3-RAW-MODEL', system_fingerprint: 'fp_RAW', usage: { prompt_tokens: 10, completion_tokens: 20, cost_in_usd_ticks: 12345 } };
const urls = ['https://a.example/1', 'https://a.example/1', 'javascript:alert(1)', 'ftp://a.example/x', ...Array.from({ length: 12 }, (_, i) => `https://b.example/${i}`)];
const xaiOk = (path: string) => path === '/v1/responses'
  ? json(200, { ...RAW, output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: ANSWER, annotations: urls.map((url) => ({ type: 'url_citation', url })) }] }] })
  : json(200, { ...RAW, choices: [{ message: { role: 'assistant', content: ANSWER, reasoning_content: 'RAW-REASONING' } }] });
let plan: 'free' | 'pro' | 'unknown' = 'free';
const net = { xai: [] as { path: string; body: Record<string, unknown> }[], usageRpc: 0, stray: [] as string[] };
let xaiAnswer: (path: string) => Response = xaiOk;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') { net.xai.push({ path: url.pathname, body: JSON.parse(await req.text()) }); return xaiAnswer(url.pathname); }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  const p = url.pathname;
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') { net.usageRpc++; return json(200, net.usageRpc); }
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) { if (plan === 'unknown') return json(500, { message: 'stand-in: subscription read failed' }); return one(plan === 'free' ? { role: 'free', trial_ends_at: null, current_period_end: null } : { role: 'pro', trial_ends_at: null, current_period_end: '2099-01-01T00:00:00.000Z' }); }
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/* #1683: THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS. The after() above restores the real fetch, and a top-level
   `await import` SUSPENDS this module - so if any test group has not registered by then, the runner thinks the file is done,
   fires after(), and every later test silently talks to the real internet. That happened in aiFeedsUnknownNotEmpty: one test
   took 26 seconds, called sosovalue for real, got a 403 in the container, and the route correctly answered null - which read as
   a product defect. This guard makes the recurrence name itself instead of presenting as a wrong value. */
const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

const { POST } = await import('../app/api/grok-chat/route.ts');
const { capChatSelection } = await import('../lib/chatPrompt.ts');
const { selectionForPlan } = await import('../lib/strategyRegistry.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.usageRpc = 0; net.stray = []; xaiAnswer = xaiOk; plan = 'free'; });
afterEach(() => _resetApiHealthQueue());

const TOK = await token();
const FOUR = 'SMA, Parabolic SAR, MACD, Bollinger Bands';
const CTX = { coin: 'xrp', price: 2.3456, change: -1.2, selection: FOUR };
const ASK = [{ role: 'user', content: 'Trend direction?' }];
const call = (body: unknown) => POST(new NextRequest('http://localhost/api/grok-chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const systemOf = (body: Record<string, unknown>) => ((body.messages ?? body.input) as { role: string; content: string }[])[0];


const weighing = (b: Record<string, unknown>) => /weighing these indicators: (.+?)\. Give them more weight/.exec(systemOf(b).content)?.[1] ?? null;

test('P1. selectionForPlan: a plan KNOWN not entitled keeps only the first indicator; any other answer passes the list through untouched (same array)', () => {
  const four = ['SMA', 'SAR', 'MACD', 'BOLL'];
  assert.deepEqual(selectionForPlan(four, true), ['SMA'], 'Free kept more than one indicator');
  assert.equal(selectionForPlan(four, false), four, 'an entitled or unknown plan was cut');
});
test('P2. selectionForPlan: one or none is unchanged for Free; a chart overlay does not use the slot (EMA_RIBBON + SMA + RSI keeps exactly one slotted indicator)', () => {
  assert.deepEqual(selectionForPlan(['SMA'], true), ['SMA']); assert.deepEqual(selectionForPlan([], true), []);
  const kept = selectionForPlan(['EMA_RIBBON', 'SMA', 'RSI'], true);
  assert.equal(kept.filter((x) => x !== 'EMA_RIBBON').length, 1, 'Free kept two slotted indicators: ' + kept.join(','));
});
test('P3. selectionForPlan does not rewrite the saved list: the input array is untouched (an upgrade restores it)', () => {
  const saved = ['SMA', 'SAR', 'MACD', 'BOLL']; const copy = [...saved];
  selectionForPlan(saved, true); assert.deepEqual(saved, copy);
});
test('P4. capChatSelection: not entitled keeps the first named indicator; entitled/unknown, empty and undefined pass through', () => {
  assert.equal(capChatSelection(FOUR, true), 'SMA');
  assert.equal(capChatSelection(FOUR, false), FOUR);
  assert.equal(capChatSelection(undefined, true), undefined); assert.equal(capChatSelection('', true), '');
  assert.equal(capChatSelection('Bollinger Bands', true), 'Bollinger Bands');
});

test('R1. /api/grok-chat, a FREE caller sending four indicators: the system prompt sent to xAI names ONE', async () => {
  plan = 'free';
  const r = await call({ mode: 'chat', context: CTX, messages: ASK });
  assert.equal(r.status, 200); assert.equal(net.xai.length, 1);
  assert.equal(weighing(net.xai[0].body), 'SMA', 'a Free caller reached xAI with: ' + weighing(net.xai[0].body));
  for (const x of ['Parabolic SAR', 'MACD', 'Bollinger']) assert.ok(!systemOf(net.xai[0].body).content.includes(x), `${x} reached the prompt of a Free caller`);
});
test('R2. /api/grok-chat, a PRO caller sending four: all four reach the prompt', async () => {
  plan = 'pro';
  const r = await call({ mode: 'chat', context: CTX, messages: ASK });
  assert.equal(r.status, 200); assert.equal(weighing(net.xai[0].body), FOUR);
});
test('R3. /api/grok-chat, the plan read FAILS: the list is as sent, never cut (#1119: a paying user is not downgraded by an outage)', async () => {
  plan = 'unknown';
  const r = await call({ mode: 'chat', context: CTX, messages: ASK });
  assert.equal(r.status, 200, 'a failed plan read must not stop the chat'); assert.equal(weighing(net.xai[0].body), FOUR);
});
test('R4. /api/grok-chat, a FREE caller with no selection or one indicator: nothing added, nothing lost', async () => {
  plan = 'free';
  await call({ mode: 'chat', context: { ...CTX, selection: undefined }, messages: ASK });
  assert.doesNotMatch(systemOf(net.xai[0].body).content, /weighing these indicators/);
  net.xai = []; await call({ mode: 'chat', context: { ...CTX, selection: 'RSI' }, messages: ASK });
  assert.equal(weighing(net.xai[0].body), 'RSI');
});

test('S1. /api/grok applies selectionForPlan from its own plan read BEFORE building the prompt (source order)', () => {
  const src = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const cap = src.indexOf("selectionForPlan(selection, plan.status === 'not_entitled')");
  const build = src.indexOf('buildArenaPrompt({ ...ctx, ...gathered.fields }, promptChart, type, ');
  assert.ok(cap > 0 && build > cap, 'the cap is missing or runs after the prompt is built');
  assert.ok(src.slice(build, build + 140).startsWith('buildArenaPrompt({ ...ctx, ...gathered.fields }, promptChart, type, planSelection)'), 'the prompt is built from the UNCAPPED selection');
});
