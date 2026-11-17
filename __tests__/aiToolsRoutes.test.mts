/* #2455 (AI tools, B7 / B9 / B10): the REAL routes run with the stand-in network, which records every write and every read query.
 *   V1  hypotheses/[id]/analyze: the verdict is the FIRST WORD of the VERDICT section: "UNCLEAR (CONFIRMED would need X)" is UNCLEAR, "**VERDICT:** CONFIRMED" (markdown emphasis) is read, garbage is UNCLEAR
 *   V2  the section boundary survives markdown headers (a confidence value does not carry the next section's reasoning)
 *   Y1  B9: the analysis is stored but the STATUS only follows it while the hypothesis is 'active'; a status the user set by hand (confirmed / expired / disconfirmed) is left alone, even on an UNCLEAR run
 *   N1  B7: shadow-account and behavioral-bias read the NEWEST 500 trades (created_at descending, limit 500, then put back in time order) and their prompts say "your last 500 trades at most"
 * WHAT IT CANNOT PROVE: the model's own wording. */
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
let hypStatus = 'active'; const patches: Record<string, unknown>[] = []; const tradeQueries: string[] = [];
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
  if (p.endsWith('trades') && req.method === 'GET') { tradeQueries.push(decodeURIComponent(url.search)); return json(200, trades); }
  if (p.endsWith('hypotheses') && req.method === 'GET') return one({ id: 'h1', user_id: UID, title: 'BTC to 100k', thesis: 'x', status: hypStatus, coin: 'BTC', acceptance_criteria: ['c1'], created_at: '2026-11-01T00:00:00Z' });
  if (p.endsWith('hypotheses') && req.method === 'PATCH') { patches.push(JSON.parse(await req.text())); return new Response(null, { status: 204 }); }
  if (p.endsWith('hypothesis_evidence') && req.method === 'GET') return json(200, []);
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
const { POST: ANALYZE } = await import('../app/api/hypotheses/[id]/analyze/route.ts');
const { POST: BIAS } = await import('../app/api/behavioral-bias/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.usageRpc = 0; net.refunds = 0; trades = []; incMode = 'ok'; ledger = 'ok'; lastLimit = null; hypStatus = 'active'; patches.length = 0; tradeQueries.length = 0; net.stray = []; xaiAnswer = xaiOk; plan = 'free'; });
afterEach(() => _resetApiHealthQueue());

const TOK = await token();
const FOUR = 'SMA, Parabolic SAR, MACD, Bollinger Bands';
const CTX = { coin: 'xrp', price: 2.3456, change: -1.2, selection: FOUR };
const ASK = [{ role: 'user', content: 'Trend direction?' }];
const call = (body: unknown) => POST(new NextRequest('http://localhost/api/grok-chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const systemOf = (body: Record<string, unknown>) => ((body.messages ?? body.input) as { role: string; content: string }[])[0];



const analyze = () => ANALYZE(new NextRequest('http://localhost/api/hypotheses/h1/analyze', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` } }), { params: Promise.resolve({ id: 'h1' }) });
const withAnswer = (text: string) => { xaiAnswer = () => json(200, { ...RAW, choices: [{ message: { role: 'assistant', content: text } }] }); };
const ans = (verdict: string, extra = '') => `EVIDENCE_ASSESSMENT:\n1. MET - ok.\n\nVERDICT:\n${verdict}\n\nCONFIDENCE:\nStrong - all evidence aligns\n\nKEY_INSIGHT:\nIt held.\n\nNEXT_CHECK:\nWatch the weekly close.${extra}`;
const stored = () => patches.at(-1) as { grok_verdict?: string; status?: string; grok_confidence?: string } | undefined;

test('V1. THE DEFECT: the verdict is the FIRST WORD of its section: "UNCLEAR (CONFIRMED would need X)" is UNCLEAR; plain words and markdown-emphasised headers are read; garbage is UNCLEAR', async () => {
  plan = 'pro';
  const cases: [string, string][] = [['CONFIRMED', 'CONFIRMED'], ['DISCONFIRMED', 'DISCONFIRMED'], ['UNCLEAR', 'UNCLEAR'], ['confirmed - all criteria met', 'CONFIRMED'], ['UNCLEAR (CONFIRMED would need X)', 'UNCLEAR'], ['UNCLEAR, not DISCONFIRMED', 'UNCLEAR'], ['It might be CONFIRMED', 'UNCLEAR'], ['', 'UNCLEAR'], ['maybe', 'UNCLEAR'], ['**CONFIRMED**', 'CONFIRMED'], ['- DISCONFIRMED', 'DISCONFIRMED']];
  for (const [v, want] of cases) {
    patches.length = 0; withAnswer(ans(v)); const r = await analyze(); const b = await r.json() as { verdict?: string };
    assert.equal(r.status, 200, `"${v}": status ${r.status}`); assert.equal(b.verdict, want, `"${v}" read ${b.verdict}`); assert.equal(stored()?.grok_verdict, want, `"${v}": stored ${stored()?.grok_verdict}`);
  }
});
test('V2. markdown headers (**VERDICT:**) are read, and a section does not run into the next: the confidence carries only its own text', async () => {
  plan = 'pro';
  withAnswer('**EVIDENCE_ASSESSMENT:**\n1. MET - ok.\n\n**VERDICT:** CONFIRMED\n\n**CONFIDENCE:** Strong - all evidence aligns\n\n**KEY_INSIGHT:** It held.\n\n**NEXT_CHECK:** Watch the weekly close.');
  const r = await analyze(); const b = await r.json() as { verdict?: string; confidence?: string; key_insight?: string; next_check?: string };
  assert.equal(b.verdict, 'CONFIRMED', 'a markdown-emphasised verdict header was not read'); assert.equal(b.confidence, 'Strong - all evidence aligns', 'the confidence ran into the next section: ' + b.confidence);
  assert.equal(b.key_insight, 'It held.'); assert.equal(b.next_check, 'Watch the weekly close.');
});

test('Y1. B9: while the hypothesis is ACTIVE the status follows a conclusive verdict (confirmed / disconfirmed) and stays active on UNCLEAR', async () => {
  plan = 'pro';
  for (const [v, want] of [['CONFIRMED', 'confirmed'], ['DISCONFIRMED', 'disconfirmed'], ['UNCLEAR', 'active']] as const) { patches.length = 0; hypStatus = 'active'; withAnswer(ans(v)); await analyze(); assert.equal(stored()?.status, want, `active + ${v} -> ${stored()?.status}`); }
});
test('Y1b. B9: a status the USER set (confirmed, disconfirmed, expired) is never overwritten, on any verdict; the analysis itself is still stored', async () => {
  plan = 'pro';
  for (const st of ['confirmed', 'disconfirmed', 'expired']) for (const v of ['CONFIRMED', 'DISCONFIRMED', 'UNCLEAR']) {
    patches.length = 0; hypStatus = st; withAnswer(ans(v)); await analyze();
    assert.equal(stored()?.status, st, `a hand-set '${st}' became '${stored()?.status}' on a ${v} run (an UNCLEAR run used to write 'active' over it)`); assert.equal(stored()?.grok_verdict, v, 'the analysis was not stored');
  }
});

const shadowOrBias = (fn: (r: NextRequest) => Promise<Response>, path: string) => fn(new NextRequest(`http://localhost${path}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` } }));
for (const [name, fn, path] of [['shadow-account', SHADOW, '/api/shadow-account'], ['behavioral-bias', BIAS, '/api/behavioral-bias']] as const) {
  test(`N1. ${name}: reads the NEWEST 500 trades (created_at descending, limit 500), uses them oldest-to-newest in the prompt, and tells the user it is "your last 500 trades at most"`, async () => {
    plan = 'pro';
    trades = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, exit_price: 101, leverage: 5, created_at: `2026-11-0${6 - i}T10:00:00Z`, setup_type: 'b', session: 'ny', notes: '' }));   // newest first, as the database returns them
    const r = await shadowOrBias(fn, path); assert.equal(r.status, 200, `${name}: status ${r.status}`);
    const q = tradeQueries.at(-1) ?? ''; assert.match(q, /order=created_at\.desc/, `${name}: the oldest 500 are read (query: ${q})`); assert.match(q, /limit=500/);
    const prompt = JSON.stringify(net.xai[0].body); assert.match(prompt, /last 500 trades at most/, `${name}: the prompt does not say how many trades it covers`);
    const order = [...prompt.matchAll(/2026-11-0(\d)/g)].map((m) => Number(m[1])); assert.ok(order.length >= 2, 'CONTROL: no trade dates found in the prompt');
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${name}: the trades are in the prompt newest-first (the analysis reads them as a time series, oldest to newest)`);
  });
}
