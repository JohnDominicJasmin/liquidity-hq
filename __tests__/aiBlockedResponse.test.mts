/* #2436 (U8): a block that is OUR state answers 503 UNAVAILABLE, a real cap answers 429 RATE_LIMIT. The rate-limit message names a reset time, so a database blip, an unapplied migration or the admin kill switch told a paying
 * user they had used up an allowance they had not touched.
 *   B1  isOurFaultBlock: error / not_enabled / disabled are ours; user, global, pool and the four dollar-cap reasons are real caps
 *   B2  blockedResponse: the status and code, the message kept, extra fields (a route's usage object) merged, and code never overridden by extra
 *   B3  the REAL grok-chat, shadow-account and behavioral-bias routes: the reservation RPC FAILING -> 503 UNAVAILABLE with no 'Resets' text; a real cap (RPC answers null) -> 429 RATE_LIMIT
 *   B4  all 12 routes the PR names (13 until #2628 took dry-powder off the per-visitor path: it reads a stored text now and reserves nothing) answer a block through blockedResponse (none builds its own 429), and the four RateLimitError routes carry the reason
 * WHAT IT CANNOT PROVE: the client text ("Resets at"); that is lib/grok.ts reading the code, pinned in the browser run. */
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
let incMode: 'ok' | 'error' | 'cap' = 'ok';
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
  if (p === '/rest/v1/rpc/increment_ai_usage') { net.usageRpc++; if (incMode === 'error') return json(500, { code: 'XX000', message: 'stand-in: db down', details: '', hint: '' }); if (incMode === 'cap') return json(200, null); return json(200, net.usageRpc); }
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
beforeEach(() => { net.xai = []; net.usageRpc = 0; net.refunds = 0; trades = []; incMode = 'ok'; net.stray = []; xaiAnswer = xaiOk; plan = 'free'; });
afterEach(() => _resetApiHealthQueue());

const TOK = await token();
const FOUR = 'SMA, Parabolic SAR, MACD, Bollinger Bands';
const CTX = { coin: 'xrp', price: 2.3456, change: -1.2, selection: FOUR };
const ASK = [{ role: 'user', content: 'Trend direction?' }];
const call = (body: unknown) => POST(new NextRequest('http://localhost/api/grok-chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const systemOf = (body: Record<string, unknown>) => ((body.messages ?? body.input) as { role: string; content: string }[])[0];



const { isOurFaultBlock, blockedResponse } = await import('../lib/aiUsage.ts');

const toolCall = (POSTFN: (r: NextRequest) => Promise<Response>, path: string) => POSTFN(new NextRequest(`http://localhost${path}`, {
  method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const five = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, exit_price: 101, leverage: 5, created_at: `2026-11-0${i + 1}T10:00:00Z`, setup_type: 'b', session: 'ny', notes: '' }));
const CHAT = { mode: 'chat', context: { coin: 'xrp', price: 2.3 }, messages: [{ role: 'user', content: 'Trend direction?' }] };

test('B1. isOurFaultBlock: error, not_enabled and disabled are OUR state; user, global, pool and the four dollar-cap reasons are real caps', () => {
  for (const r of ['error', 'not_enabled', 'disabled'] as const) assert.equal(isOurFaultBlock(r), true, `${r} is ours`);
  for (const r of ['user', 'global', 'pool', 'pro_daily', 'pro_monthly', 'free_daily', 'fuse'] as const) assert.equal(isOurFaultBlock(r), false, `${r} is a real cap: it must stay a 429 with the reset time`);
});
test('B2. blockedResponse: ours -> 503 UNAVAILABLE, a cap -> 429 RATE_LIMIT; the message is kept, extra fields are merged, and extra can never override the code', async () => {
  const ours = blockedResponse('error', 'try again', { usage: { used: 3 } }); const b1 = await ours.json();
  assert.equal(ours.status, 503); assert.deepEqual(b1, { error: 'try again', usage: { used: 3 }, code: 'UNAVAILABLE' });
  const cap = blockedResponse('free_daily', 'limit reached', { usage: { used: 9 } }); const b2 = await cap.json();
  assert.equal(cap.status, 429); assert.deepEqual(b2, { error: 'limit reached', usage: { used: 9 }, code: 'RATE_LIMIT' });
  const sneaky = await blockedResponse('error', 'x', { code: 'RATE_LIMIT' } as Record<string, unknown>).json() as { code: string };
  assert.equal(sneaky.code, 'UNAVAILABLE', 'a route\'s extra fields overrode the code');
});

for (const [name, run] of [
  ['grok-chat', () => call(CHAT)],
  ['shadow-account', () => toolCall(SHADOW, '/api/shadow-account')],
  ['behavioral-bias', () => toolCall(BIAS, '/api/behavioral-bias')],
] as const) {
  test(`B3. ${name}: the reservation RPC FAILING is a 503 UNAVAILABLE with no reset time; a real cap (RPC answers null) is still a 429 RATE_LIMIT; a good reservation is neither`, async () => {
    plan = 'pro'; trades = five;
    incMode = 'error';
    let r = await run(); let b = await r.json() as { code?: string; error?: string };
    assert.equal(r.status, 503, `${name}: a database failure answered ${r.status}`); assert.equal(b.code, 'UNAVAILABLE');
    assert.doesNotMatch(String(b.error), /reset/i, 'our own failure named a reset time');
    assert.equal(net.xai.length, 0, 'xAI was called after a failed reservation');
    incMode = 'cap'; net.xai = [];
    r = await run(); b = await r.json() as { code?: string };
    assert.equal(r.status, 429, `${name}: a real cap answered ${r.status}`); assert.equal(b.code, 'RATE_LIMIT'); assert.equal(net.xai.length, 0);
    incMode = 'ok'; net.xai = [];
    r = await run(); assert.equal(r.status, 200, `${name}: a good reservation answered ${r.status}`);
  });
}

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const ROUTES = ['behavioral-bias', 'briefing', 'grok-chat', 'hypotheses/[id]/analyze', 'macro-context', 'onchain', 'pine-script', 'shadow-account', 'smc-snapshot', 'strategy-research', 'thesis-check', 'token-unlock'];
test('B4. all 12 routes answer a blocked reservation through blockedResponse, none builds its own 429 / RATE_LIMIT, and the cached-loader routes carry the reason in their RateLimitError', () => {
  for (const r of ROUTES) {
    const s = code(readFileSync(new URL(`../app/api/${r}/route.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(s.includes('blockedResponse('), `${r}: does not use blockedResponse`);
    assert.equal(/code:\s*'RATE_LIMIT'/.test(s), false, `${r}: builds its own RATE_LIMIT answer again (a database blip would read as a used-up allowance)`);
    assert.equal(/status:\s*429/.test(s), false, `${r}: builds its own 429`);
  }
  for (const r of ['macro-context', 'onchain', 'smc-snapshot', 'token-unlock']) {
    const s = code(readFileSync(new URL(`../app/api/${r}/route.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(/new RateLimitError\([^)]*usageResult\.reason/.test(s), `${r}: its RateLimitError no longer carries the block reason, so the handler cannot tell ours from a cap`);
  }
});
