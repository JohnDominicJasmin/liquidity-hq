/* #2432 (and #2433's pattern): a USE IS GIVEN BACK WHEN NOTHING REACHED THE USER, and not otherwise.
 * A refund after a delivered answer is free AI; a missing refund is a customer charged for nothing. The REAL routes run (/api/grok-chat, /api/shadow-account, /api/behavioral-bias) with the same stand-in network as
 * grokChatServerPrompt.test.mts; the stand-in counts the reservation RPC (increment_ai_usage) and the refund RPC (refund_ai_usage).
 *   G1-G5  grok-chat: xAI non-2xx, a thrown call, an EMPTY 2xx answer -> refunded; a good 2xx answer -> NOT refunded; the refunded count is what the response reports
 *   T1-T4  shadow-account and behavioral-bias: no trades / fewer than 5 closed trades -> 400 and NOTHING reserved (no use, no pool slot); 5 closed + xAI 502 -> reserved once and refunded; 5 closed + 200 -> kept
 *   S1-S2  hypotheses/[id]/analyze and macro-context: source pins (reserve AFTER the hypothesis exists; refund on non-2xx and throw; macro refunds when the inputs fail)
 * WHAT IT CANNOT PROVE: real xAI behaviour or the refund_ai_usage SQL function itself (its own pins: aiSpendCap / the migration tests). */
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
let trades: Record<string, unknown>[] = [];
const net = { xai: [] as { path: string; body: Record<string, unknown> }[], usageRpc: 0, refunds: 0, stray: [] as string[] };
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
  if (p === '/rest/v1/rpc/refund_ai_usage') { net.refunds++; return json(200, Math.max(0, net.usageRpc - net.refunds)); }
  if (p.endsWith('trades') && req.method === 'GET') return json(200, trades);
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
const { POST: SHADOW } = await import('../app/api/shadow-account/route.ts');
const { POST: BIAS } = await import('../app/api/behavioral-bias/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.usageRpc = 0; net.refunds = 0; trades = []; net.stray = []; xaiAnswer = xaiOk; plan = 'free'; });
afterEach(() => _resetApiHealthQueue());

const TOK = await token();
const FOUR = 'SMA, Parabolic SAR, MACD, Bollinger Bands';
const CTX = { coin: 'xrp', price: 2.3456, change: -1.2, selection: FOUR };
const ASK = [{ role: 'user', content: 'Trend direction?' }];
const call = (body: unknown) => POST(new NextRequest('http://localhost/api/grok-chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const systemOf = (body: Record<string, unknown>) => ((body.messages ?? body.input) as { role: string; content: string }[])[0];



const toolCall = (POSTFN: (r: NextRequest) => Promise<Response>, path: string) => POSTFN(new NextRequest(`http://localhost${path}`, {
  method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const closed = (n: number, open = 0) => [
  ...Array.from({ length: n }, (_, i) => ({ id: `c${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, exit_price: 101, leverage: 5, created_at: `2026-11-0${(i % 9) + 1}T10:00:00Z`, setup_type: 'breakout', session: 'ny', notes: '' })),
  ...Array.from({ length: open }, (_, i) => ({ id: `o${i}`, coin: 'ETH', direction: 'SHORT', result: 'OPEN', created_at: '2026-11-09T10:00:00Z' })),
];
const CHAT = { mode: 'chat', context: { coin: 'xrp', price: 2.3 }, messages: [{ role: 'user', content: 'Trend direction?' }] };

test('G1. grok-chat: xAI answers non-2xx -> the use is GIVEN BACK (reserved once, refunded once) and the caller gets a generic 502', async () => {
  plan = 'pro'; xaiAnswer = () => json(500, { error: 'boom' });
  const r = await call(CHAT);
  assert.equal(r.status, 502); assert.equal(net.usageRpc, 1); assert.equal(net.refunds, 1, 'a failed xAI call kept the use');
});
test('G2. grok-chat: the xAI call THROWS (network error / timeout) -> given back', async () => {
  plan = 'pro'; xaiAnswer = () => { throw new Error('socket hang up'); };
  const r = await call(CHAT);
  assert.ok(r.status >= 500); assert.equal(net.usageRpc, 1); assert.equal(net.refunds, 1, 'a thrown xAI call kept the use');
});
test('G3. grok-chat: a 2xx with an EMPTY answer delivered nothing -> given back, and the usage the response reports is the refunded count', async () => {
  plan = 'pro'; xaiAnswer = (path) => (path === '/v1/responses' ? json(200, { ...RAW, output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }) : json(200, { ...RAW, choices: [{ message: { role: 'assistant', content: '' } }] }));
  const r = await call(CHAT); const b = await r.json() as { _usage?: { chatUsed?: number; chat?: number } };
  assert.equal(r.status, 200); assert.equal(net.refunds, 1, 'an empty answer kept the use');
  assert.ok(JSON.stringify(b).includes('(no response)'), 'the caller was not told there was no answer');
});
test('G4. grok-chat: a good 2xx answer is NOT refunded (the tokens are billed): reserved once, refunded never', async () => {
  plan = 'pro';
  const r = await call(CHAT);
  assert.equal(r.status, 200); assert.equal(net.usageRpc, 1); assert.equal(net.refunds, 0, 'a delivered answer was refunded: free AI');
});
test('G5. grok-chat: a non-JSON error body from xAI is still a failed call and is given back', async () => {
  plan = 'pro'; xaiAnswer = () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  const r = await call(CHAT);
  assert.ok(r.status >= 500); assert.equal(net.refunds, 1);
});

for (const [name, fn, path] of [['shadow-account', SHADOW, '/api/shadow-account'], ['behavioral-bias', BIAS, '/api/behavioral-bias']] as const) {
  test(`T1. ${name}: NO trades -> 400 and nothing reserved (no use, no pool slot)`, async () => {
    plan = 'pro'; trades = [];
    const r = await toolCall(fn, path);
    assert.equal(r.status, 400); assert.equal(net.usageRpc, 0, 'a request with nothing to analyse reserved a use'); assert.equal(net.xai.length, 0);
  });
  test(`T2. ${name}: 4 closed trades (and open ones) -> NEED_MORE_TRADES and nothing reserved`, async () => {
    plan = 'pro'; trades = closed(4, 3);
    const r = await toolCall(fn, path); const b = await r.json() as { error?: string };
    assert.equal(r.status, 400); assert.equal(b.error, 'NEED_MORE_TRADES'); assert.equal(net.usageRpc, 0, 'fewer than 5 closed trades reserved a use');
  });
  test(`T3. ${name}: 5 closed trades and xAI answers 502 -> reserved ONCE and given back`, async () => {
    plan = 'pro'; trades = closed(5); xaiAnswer = () => json(500, { error: 'boom' });
    const r = await toolCall(fn, path);
    assert.equal(r.status, 502); assert.equal(net.usageRpc, 1, 'not reserved'); assert.equal(net.refunds, 1, 'a failed xAI call kept the use');
  });
  test(`T4. ${name}: 5 closed trades and a good answer -> reserved once, NOT refunded`, async () => {
    plan = 'pro'; trades = closed(5);
    const r = await toolCall(fn, path);
    assert.equal(r.status, 200, 'status ' + r.status); assert.equal(net.usageRpc, 1); assert.equal(net.refunds, 0, 'a delivered report was refunded: free AI');
  });
}

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
test('S1. hypotheses/[id]/analyze reserves only AFTER the hypothesis is found, and gives the use back on a non-2xx and on a throw before the 2xx', () => {
  const s = src('app/api/hypotheses/[id]/analyze/route.ts');
  const notFound = s.indexOf("'Hypothesis not found'"), reserve = s.indexOf("incrementToolUsage(authData.user.id, 'hypothesisAnalyze'");
  assert.ok(notFound > 0 && reserve > notFound, 'the use is reserved before the 404 check (a bad id is charged)');
  assert.equal(s.split("refundToolUsage(authData.user.id, 'hypothesisAnalyze', reservedOn)").length - 1, 2, 'expected exactly two refund sites (non-2xx, throw)');
  assert.ok(s.indexOf('billed = true') > s.indexOf('if (!r.ok) {'), 'billed is set before the non-2xx check');
  assert.ok(/if \(!billed\) await refundToolUsage/.test(s), 'the catch refunds unconditionally (a billed answer would be refunded)');
});
test('S2. macro-context gives the reservation back when the market inputs fail, when xAI throws and when xAI answers non-2xx', () => {
  const s = src('app/api/macro-context/route.ts');
  assert.ok(s.includes("const giveBack = () => refundToolUsage(authData.user.id, 'macroContext', reservedOn);"), 'the refund helper is gone');
  assert.ok(s.includes('if (inputs instanceof Error) { await giveBack(); throw inputs; }'), 'a failed market read keeps the use');
  assert.ok(s.includes('} catch (e) { await giveBack(); throw e; }'), 'a thrown xAI call keeps the use');
  assert.ok(/if \(!aiRes\.ok\) \{\s*await giveBack\(\);/.test(s), 'a non-2xx xAI answer keeps the use');
  assert.ok(s.indexOf('const reservedOn = todayUtc();') < s.indexOf("incrementToolUsage(authData.user.id, 'macroContext'"), 'the reservation date is not captured before the reservation (a refund across UTC midnight hits the wrong day)');
});
