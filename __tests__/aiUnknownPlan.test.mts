/* #2437 (U7): an UNKNOWN plan (the plan read failed) is never billed against the Free cap. The rule is #2412's (POST /api/grok): a request every plan may make proceeds against the PRO count cap with the dollar cap
 * failing CLOSED; a Pro-only feature answers 503 UNAVAILABLE (a confirmed non-Pro is still 403 PRO_REQUIRED). The REAL routes run with the stand-in network, whose subscription read can fail and whose reservation RPC records the limit it was given.
 *   P1  grok-chat: plan known Free -> reserved against the FREE chat limit; Pro -> the Pro limit; UNKNOWN -> the PRO limit (never the Free 5)
 *   P2  grok-chat, UNKNOWN plan and an unreadable spend ledger -> the dollar cap fails CLOSED (503, no xAI call); a KNOWN Pro with the same unreadable ledger fails open (200)
 *   P3  shadow-account and behavioral-bias: UNKNOWN plan -> 503 UNAVAILABLE with nothing reserved and no xAI call; Free -> 403 PRO_REQUIRED; Pro -> proceeds
 *   P4  requireProPlan itself and its use: one plan read answers the gate AND the tier (the two-read fold-to-free is gone) across all eleven Pro-only routes
 *   P5  source: briefing and grok-chat take the tier from getUsageTierStatus; GET /api/grok shows the Pro numbers for an unknown plan
 * WHAT IT CANNOT PROVE: each remaining tool route end to end (their source shape is pinned by P4); the usage display rendering. */
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
let ledger: 'ok' | 'fail' = 'ok'; let lastLimit: number | null = null;
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
  if (p === '/rest/v1/rpc/increment_ai_usage') { net.usageRpc++; try { lastLimit = (JSON.parse(await req.clone().text()) as { p_limit?: number }).p_limit ?? null; } catch { lastLimit = null; } if (incMode === 'error') return json(500, { code: 'XX000', message: 'stand-in: db down', details: '', hint: '' }); if (incMode === 'cap') return json(200, null); return json(200, net.usageRpc); }
  if (p === '/rest/v1/rpc/refund_ai_usage') { net.refunds++; return json(200, Math.max(0, net.usageRpc - net.refunds)); }
  if (p.endsWith('trades') && req.method === 'GET') return json(200, trades);
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return ledger === 'fail' ? json(500, { code: 'XX000', message: 'stand-in: ledger down', details: '', hint: '' }) : json(200, []);
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
beforeEach(() => { net.xai = []; net.usageRpc = 0; net.refunds = 0; trades = []; incMode = 'ok'; ledger = 'ok'; lastLimit = null; net.stray = []; xaiAnswer = xaiOk; plan = 'free'; });
afterEach(() => _resetApiHealthQueue());

const TOK = await token();
const FOUR = 'SMA, Parabolic SAR, MACD, Bollinger Bands';
const CTX = { coin: 'xrp', price: 2.3456, change: -1.2, selection: FOUR };
const ASK = [{ role: 'user', content: 'Trend direction?' }];
const call = (body: unknown) => POST(new NextRequest('http://localhost/api/grok-chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const systemOf = (body: Record<string, unknown>) => ((body.messages ?? body.input) as { role: string; content: string }[])[0];



const { AI_LIMITS } = await import('../lib/limits.ts');
const toolCall = (POSTFN: (r: NextRequest) => Promise<Response>, path: string) => POSTFN(new NextRequest(`http://localhost${path}`, {
  method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const five = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, exit_price: 101, leverage: 5, created_at: `2026-11-0${i + 1}T10:00:00Z`, setup_type: 'b', session: 'ny', notes: '' }));
const CHAT = { mode: 'chat', context: { coin: 'xrp', price: 2.3 }, messages: [{ role: 'user', content: 'Trend direction?' }] };

test('P1. grok-chat: the reservation limit is the FREE limit for a known Free plan, the PRO limit for Pro, and the PRO limit (never the Free 5) for an UNKNOWN plan', async () => {
  plan = 'free'; let r = await call(CHAT);
  assert.equal(r.status, 200); assert.equal(lastLimit, AI_LIMITS.free.chat, 'a known Free account was not billed against the Free limit');
  plan = 'pro'; await call(CHAT); assert.equal(lastLimit, AI_LIMITS.pro.chat);
  plan = 'unknown'; r = await call(CHAT);
  assert.equal(r.status, 200, 'an unknown plan could not chat'); assert.equal(lastLimit, AI_LIMITS.pro.chat, `an unknown plan was billed against limit ${lastLimit} (the Free cap is ${AI_LIMITS.free.chat})`);
  assert.ok(AI_LIMITS.pro.chat > AI_LIMITS.free.chat, 'CONTROL: the Pro and Free chat limits no longer differ, so this cell measures nothing');
});
test('P2. grok-chat, UNKNOWN plan + an unreadable spend ledger: the dollar cap fails CLOSED (503, no xAI call); a KNOWN Pro with the same ledger fails open', async () => {
  plan = 'unknown'; ledger = 'fail';
  let r = await call(CHAT);
  assert.equal(r.status, 503, `an unknown plan with an unreadable ledger answered ${r.status}: it spent unmeasured`); assert.equal(net.xai.length, 0);
  net.xai = []; plan = 'pro'; r = await call(CHAT);
  assert.equal(r.status, 200, 'a known Pro account was blocked by an unreadable ledger (Pro fails open)');
});
for (const [name, fn, path] of [['shadow-account', SHADOW, '/api/shadow-account'], ['behavioral-bias', BIAS, '/api/behavioral-bias']] as const) {
  test(`P3. ${name}: UNKNOWN plan -> 503 UNAVAILABLE (nothing reserved, no xAI call); a known Free -> 403 PRO_REQUIRED; Pro proceeds`, async () => {
    trades = five;
    plan = 'unknown'; let r = await toolCall(fn, path); let b = await r.json() as { code?: string; error?: string };
    assert.equal(r.status, 503, `${name}: an unknown plan answered ${r.status}`); assert.equal(b.code, 'UNAVAILABLE'); assert.doesNotMatch(String(b.error), /Pro feature|limit of 0/i, 'the unknown plan was told it is not Pro or hit a limit of 0');
    assert.equal(net.usageRpc, 0, 'a use was reserved for an unknown plan'); assert.equal(net.xai.length, 0);
    plan = 'free'; r = await toolCall(fn, path); b = await r.json() as { error?: string };
    assert.equal(r.status, 403); assert.equal(b.error, 'PRO_REQUIRED'); assert.equal(net.usageRpc, 0);
    plan = 'pro'; r = await toolCall(fn, path); assert.equal(r.status, 200, `${name}: a Pro account answered ${r.status}`);
    assert.equal(lastLimit, AI_LIMITS.pro[name === 'shadow-account' ? 'shadowAccount' : 'behavioralBias'], `${name}: a confirmed Pro was billed against limit ${lastLimit} (a folded-to-free tier reads 0)`); assert.ok((lastLimit ?? 0) > 0);
  });
}

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => code(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const PRO_ONLY = ['token-unlock', 'smc-snapshot', 'strategy-research', 'pine-script', 'thesis-check', 'shadow-account', 'behavioral-bias', 'hypotheses/[id]/analyze', 'draw-structure', 'macro-context', 'onchain'];
test('P4. all eleven Pro-only routes use requireProPlan (one read answers the gate and the tier); none still reads the plan twice', () => {
  for (const r of PRO_ONLY) {
    const s = read(`app/api/${r}/route.ts`);
    assert.ok(s.includes('requireProPlan('), `${r}: does not use requireProPlan`);
    assert.equal(/\bhasProFeatures\(token/.test(s), false, `${r}: reads hasProFeatures too (the two-read fold-to-free is back: a Pro user on a transient error is told it is not Pro)`);
  }
  const e = read('lib/entitlements.ts');
  const at = e.indexOf('export async function requireProPlan('); assert.ok(at > 0, 'CONTROL: requireProPlan not found');
  const body = e.slice(at, e.indexOf('\n}\n', at));
  assert.equal(body.split('getPlanSnapshot(').length - 1, 1, 'requireProPlan reads the plan more than once');
  assert.ok(body.indexOf('plan.failed') < body.indexOf("plan.status !== 'entitled'"), 'the unknown-plan check is not ahead of the not-Pro check (an unknown plan would read as 403 Not Pro)');
  assert.ok(body.includes("code: 'UNAVAILABLE' }, { status: 503 }") && body.includes("{ status: 403 }"), 'the 503 / 403 answers changed');
});
test('P5. briefing and grok-chat take the tier from getUsageTierStatus (unknown = Pro count cap, dollar cap closed); GET /api/grok shows the Pro numbers for an unknown plan', () => {
  for (const r of ['grok-chat', 'briefing']) { const s = read(`app/api/${r}/route.ts`); assert.ok(s.includes('getUsageTierStatus(token, userId)') && s.includes("plan.failed ? 'pro' : plan.tier"), `${r}: an unknown plan is not served the Pro cap`); }
  for (const r of ['grok-chat', 'grok']) assert.equal(read(`app/api/${r}/route.ts`).split("const role: UsageTier = plan.failed ? 'pro' : plan.tier;").length - 1, 2, `${r}: the unknown-plan rule must hold in BOTH the usage display (GET) and the reservation (POST)`);
  assert.ok(read('app/api/grok-chat/route.ts').includes('incrementUsageColumn(userId, role, column, limit, null, plan.failed)'), 'grok-chat does not pass unknownPlan to the reservation: the dollar cap would fail open');
  const g = read('app/api/grok/route.ts'); assert.ok(g.includes("const role: UsageTier = plan.failed ? 'pro' : plan.tier;"), 'the usage display shows the Free numbers for an unknown plan again (5/3 disables the Arena buttons)');
});
