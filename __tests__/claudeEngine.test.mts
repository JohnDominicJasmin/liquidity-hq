/* #2235 (#1631): the per-feature Claude engine for the QUICK read. Inert by default, Grok on any Claude failure, same validation, never on X-needing features.
 *
 * THE REAL ROUTE RUNS (app/api/grok/route.ts POST) with a network stand-in: Supabase (key, ban flag, flags, subscription, spend ledger, usage RPC, call log,
 * app_config), xAI (records which path was called), and ANTHROPIC (the real SDK, whose fetch lands here and is answered with a Messages API body). Nothing is
 * billed and nothing leaves the process: a call that reaches any other host throws, and the stand-in FAILS the test when a call goes to an engine that must
 * not have been asked.
 *
 *   E1  default: no flag row and no key / a key but no row / a row but no key: NO Anthropic request, xAI answers (the Grok path unchanged)
 *   E2  flag + key: Claude answers, xAI is not called, the call is logged under the Claude model with a priced cost (not 'unknown'), same response shape
 *   E3  never on X features: a row naming Claude for Deep is ignored, Deep still calls xAI
 *   E4  a failed Claude call falls back to xAI exactly once, a normal read is returned, and ONE fixed log line carries nothing from the request or the error
 *   E5  same validation: an unreadable Claude answer is restated on CLAUDE (not Grok); a second failure is refused 502 BAD_ANSWER and refunded
 *   E6  allowlist: a model that is not priced leaves the quick read on Grok
 *   E7  no user-visible default label names an AI vendor outside the four legal strings
 *
 * WHAT IT CANNOT PROVE: what a real model writes (no billed call), or that the SDK's wire shape matches the live API (the stand-in is a Messages API body). */
import test, { after, afterEach, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { marketStandIn } from './_marketStandIn.mts';

const sentryStub = 'export const captureException = (...a) => {}; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.GROK_API_KEY = 'placeholder-xai';
const FAKE_ANTHROPIC_KEY = 'sk-ant-qa-standin-not-a-key';
const UID = '77777777-7777-4777-8777-777777777777';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ANSWER = [
  'SIGNAL: BULLISH', 'CONFIDENCE: 82',
  'COUNTED: bullish: 2 (RSI divergence, ETF inflow) | bearish 1 (funding)',
  'CATALYSTS:', '- None in input',
  'CHART_ANALYSIS: higher lows', 'REASONING: momentum turning.',
].join('\n');
const CLAUDE_ANSWER = ANSWER.replace('SIGNAL: BULLISH', 'SIGNAL: BEARISH').replace('CONFIDENCE: 82', 'CONFIDENCE: 71');   // a DIFFERENT verdict, so the response shows which engine wrote it
const UNREADABLE = 'I cannot say which way this goes.';
const REPAIR_OK = 'SIGNAL: BEARISH\nCONFIDENCE: 60';
const SENTINEL = 'QA-SENTINEL-ERRTEXT-4471';

const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
const pl = b64u(JSON.stringify({ sub: UID, email: 'qa@example.test', aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: now, exp: now + 600 }));
const TOK = `${h}.${pl}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${pl}`)))}`;

type Step = { status: number; text?: string };
const net = {
  xai: [] as string[], anthropic: [] as { model: string; max_tokens: number; hasSystem: boolean }[], stray: [] as string[], market: [] as string[],
  rpc: [] as string[], calls: [] as Record<string, unknown>[],
  engines: null as null | Record<string, string>,    // the app_config ai_engines row value, null = no row
  claude: [] as Step[],                               // what Anthropic answers, one entry per request, in order
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') {
    net.xai.push(url.pathname);
    return json(200, url.pathname === '/v1/responses'
      ? { model: 'grok-4.3', output: [{ type: 'message', content: [{ text: ANSWER }] }] }
      : { model: 'grok-4.3', choices: [{ message: { content: ANSWER } }], usage: { prompt_tokens: 1000, completion_tokens: 300 } });
  }
  if (url.origin === 'https://api.anthropic.com') {
    const body = JSON.parse(await req.text()) as { model: string; max_tokens: number; system?: string };
    net.anthropic.push({ model: body.model, max_tokens: body.max_tokens, hasSystem: typeof body.system === 'string' && body.system.length > 0 });
    const step = net.claude.shift() ?? { status: 200, text: CLAUDE_ANSWER };
    if (step.status !== 200) return json(step.status, { type: 'error', error: { type: 'api_error', message: SENTINEL } });
    return json(200, {
      id: 'msg_qa', type: 'message', role: 'assistant', model: body.model + '-20260101', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: step.text ?? CLAUDE_ANSWER }],
      usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
  }
  {
    const answered = marketStandIn(req, url, { seen: (hostAndPath) => net.market.push(hostAndPath) });
    if (answered) return answered;
  }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.url}`); }
  const p = url.pathname;
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') return json(200, 1);
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.startsWith('/rest/v1/rpc/')) { net.rpc.push(p.split('/').pop()!); return json(200, 0); }
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) return one({ role: 'pro', trial_ends_at: null, current_period_end: null });
  if (p.endsWith('app_config') && req.method === 'GET') {
    const key = url.searchParams.get('key') ?? '';
    if (key === 'eq.ai_engines' && net.engines) return one({ value: net.engines });
    return json(200, []);
  }
  if (p.endsWith('ai_call_log') && req.method === 'POST') { net.calls.push(JSON.parse(await req.text())); return new Response(null, { status: 201 }); }
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

const { grokBody, contextFor, SERVER_BUILDS_PROMPT } = await import('./_grokBody.mts');
const { POST } = await import('../app/api/grok/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
const { __resetEngineCache } = await import('../lib/aiEngine.ts');

const errors: string[] = [];
const realError = console.error;
beforeEach(() => {
  net.xai = []; net.anthropic = []; net.stray = []; net.market = []; net.rpc = []; net.calls = []; net.engines = null; net.claude = []; errors.length = 0;
  __resetEngineCache();
  process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
});
afterEach(() => { console.error = realError; _resetApiHealthQueue(); });

const read = async (type: 'quick' | 'deep') => {
  const r = await POST(new NextRequest('http://localhost/api/grok', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
    body: JSON.stringify(grokBody({
      type, coin: 'xrp', tf: '1h',
      prompt: 'analyse XRP\n=== REALIZED LIQUIDATION CLUSTERS (XRP/USDT, last 24h) ===\nNot available\n',
      ...(SERVER_BUILDS_PROMPT ? { override: { context: { ...contextFor('XRP/USDT'), clusters: 'Not available' } } } : {}),
    })),
  }));
  return { status: r.status, body: await r.json() as { result?: { signal?: string; confidence?: number }; code?: string } };
};

test('E1a. DEFAULT: no flag row and no key -> no Anthropic request, xAI answers, the Grok path is unchanged', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await read('quick');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.deepEqual(net.anthropic, [], 'a request went to Anthropic with no flag and no key');
  assert.deepEqual(net.xai, ['/v1/chat/completions']);
  assert.equal(r.body.result!.signal, 'BULLISH', 'the Grok answer was not the one returned');
});
test('E1b. a KEY but no flag row -> still Grok, no Anthropic request', async () => {
  const r = await read('quick');
  assert.equal(r.status, 200); assert.deepEqual(net.anthropic, []); assert.deepEqual(net.xai, ['/v1/chat/completions']);
});
test('E1c. a flag row but NO key -> still Grok, no Anthropic request', async () => {
  delete process.env.ANTHROPIC_API_KEY; net.engines = { quick: 'claude-haiku-5-5' };
  const r = await read('quick');
  assert.equal(r.status, 200); assert.deepEqual(net.anthropic, []); assert.deepEqual(net.xai, ['/v1/chat/completions']);
});

test('E2. FLAG + KEY: Claude answers, xAI is not called, the call is logged under the Claude model with a priced cost, the shape is the same', async () => {
  net.engines = { quick: 'claude-haiku-5-5' };
  const r = await read('quick');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(net.anthropic.length, 1, 'expected exactly one Anthropic request, got ' + net.anthropic.length);
  assert.equal(net.anthropic[0].model, 'claude-haiku-5-5'); assert.equal(net.anthropic[0].hasSystem, true, 'the guardrail system prompt was not sent');
  assert.deepEqual(net.xai, [], 'xAI was called although Claude answered');
  assert.equal(r.body.result!.signal, 'BEARISH', 'the Claude answer was not the one returned');
  const q = net.calls.find(c => c.call_type === 'quick');
  assert.ok(q, 'no quick call was logged: ' + JSON.stringify(net.calls));
  assert.equal(q!.model, 'claude-haiku-5-5', 'logged under the wrong model');
  assert.notEqual(q!.cost_source, 'unknown', 'the call was logged with an unknown cost: ' + JSON.stringify(q));
  assert.ok(typeof q!.cost_usd === 'number' && (q!.cost_usd as number) > 0, 'no priced cost: ' + JSON.stringify(q));
});

test('E3. NEVER ON X FEATURES: a row naming Claude for Deep is ignored; Deep still calls xAI and never Anthropic', async () => {
  net.engines = { deep: 'claude-haiku-5-5' };
  const r = await read('deep');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.deepEqual(net.anthropic, [], 'Deep reached Anthropic');
  assert.ok(net.xai.includes('/v1/responses'), 'Deep did not call xAI: ' + JSON.stringify(net.xai));
});

test('E4. A FAILED Claude call falls back to xAI exactly once, returns a normal read, and logs ONE fixed line with nothing from the error', async () => {
  net.engines = { quick: 'claude-haiku-5-5' }; net.claude = [{ status: 500 }, { status: 500 }];   // the SDK retries a 5xx once
  const r = await read('quick');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.ok(net.anthropic.length >= 1 && net.anthropic.length <= 2, 'Anthropic asked ' + net.anthropic.length + ' times');
  assert.deepEqual(net.xai, ['/v1/chat/completions'], 'xAI must be called exactly once as the fallback');
  assert.equal(r.body.result!.signal, 'BULLISH', 'the fallback did not return the Grok answer');
  const lines = errors.filter(e => /claude quick read failed, falling back to grok/.test(e));
  assert.equal(lines.length, 1, 'expected one fixed fallback line, got: ' + JSON.stringify(errors));
  assert.equal(errors.some(e => e.includes(SENTINEL)), false, 'error text from the Anthropic body reached the log');
  assert.equal(errors.some(e => e.includes('analyse XRP')), false, 'request content reached the log');
});

test('E5a. SAME VALIDATION: an unreadable Claude answer is restated on CLAUDE, and a readable restate is accepted', async () => {
  net.engines = { quick: 'claude-haiku-5-5' }; net.claude = [{ status: 200, text: UNREADABLE }, { status: 200, text: REPAIR_OK }];
  const r = await read('quick');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(net.anthropic.length, 2, 'the restate did not run on Claude: ' + JSON.stringify(net.anthropic));
  assert.equal(net.anthropic[1].max_tokens <= 400, true, 'the repair request is not the short one: ' + net.anthropic[1].max_tokens);
  assert.deepEqual(net.xai, [], 'the restate went to xAI');
  assert.ok(net.calls.some(c => c.call_type === 'verdict_repair' && c.model === 'claude-haiku-5-5'), 'the repair call was not logged under Claude: ' + JSON.stringify(net.calls));
});
test('E5b. SAME VALIDATION: two unreadable Claude answers are refused 502 BAD_ANSWER and the usage is refunded, with xAI never asked', async () => {
  net.engines = { quick: 'claude-haiku-5-5' }; net.claude = [{ status: 200, text: UNREADABLE }, { status: 200, text: UNREADABLE }];
  const r = await read('quick');
  assert.equal(r.status, 502, JSON.stringify(r.body).slice(0, 200)); assert.equal(r.body.code, 'BAD_ANSWER');
  assert.deepEqual(net.xai, [], 'xAI was asked to rescue a Claude read');
  assert.ok(net.rpc.some(n => /refund/.test(n)), 'no refund was made: ' + JSON.stringify(net.rpc));
});

test('E6. ALLOWLIST: a model that is not priced leaves the quick read on Grok', async () => {
  net.engines = { quick: 'claude-unpriced-9-9' };
  const r = await read('quick');
  assert.equal(r.status, 200); assert.deepEqual(net.anthropic, [], 'an unpriced model was called'); assert.deepEqual(net.xai, ['/v1/chat/completions']);
});

test('E7. no default label names an AI vendor except the four legal strings', () => {
  const allowed = new Set(['DISCLAIMER_SECTION_AI_ANALYSIS_BODY', 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY', 'PRIVACY_SECTION_THIRD_PARTY_BODY', 'TERMS_SECTION_THIRD_PARTY_DATA_BODY']);
  const labels = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const hits = Object.entries(labels).filter(([, v]) => typeof v === 'string' && /anthropic|claude|\bgrok\b|\bxai\b/i.test(v)).map(([k]) => k).filter(k => !allowed.has(k));
  assert.deepEqual(hits, [], 'a default label names an AI vendor: ' + hits.join(', '));
});
