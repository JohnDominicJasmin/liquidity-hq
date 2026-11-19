/* QA BEHAVIOURAL PINS for PR #2586 (#1631 AI tracker). The REAL route handlers run in-process against a stand-in network (same pattern as aiRefundOnNothingDelivered.test.mts).
 * Expectations are hand-derived from the PR body's "How to test (QA)" list and the code comments, not copied from a run.
 *   P1  isRoundPrice table          P2  stopLossNumber table        P3  stripCodeFence table
 *   B1-B3  behavioral-bias prompt (round stops, 1R losses, no invented dollar figure, no NaN/undefined from a trade with missing numbers)
 *   H1  shadow-account prompt (10-trade floor, not a forecast)       SR1  strategy-research prompt (sample size is zero)
 *   X1-X6  shadow-account AND behavioral-bias: a thrown call, an empty answer, a cut-off answer, a good answer, a provider error body, a refund that does not land
 *   N1  pine-script: a fenced answer is returned without its fence lines; an empty fence is AI_INCOMPLETE and refunded
 *   U9  smc-snapshot and draw-structure: `refunded` true / false in the error body; absent on a rate-limit refusal
 *   U12 the reservation and the refund write the SAME day row when the call straddles 00:00 UTC (clock frozen at 23:59:59.999)
 *   S1  every incrementToolUsage / incrementUsageColumn caller except grok-chat passes the day it will refund against */
import test, { after, afterEach, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/* ---- a clock that can be frozen and moved (Date.now and new Date()) ---- */
const RealDate = Date;
let fixed: number | null = null;
const nowMs = () => fixed ?? RealDate.now();
class FakeDate extends RealDate {
  constructor(...a: unknown[]) { if (a.length === 0) super(nowMs()); else super(...(a as [number])); }
  static now() { return nowMs(); }
}
globalThis.Date = FakeDate as unknown as DateConstructor;
const MIDNIGHT_MINUS = RealDate.UTC(2026, 10, 19, 23, 59, 59, 999);

/* ---- a token, signed here ---- */
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
async function token() {
  const now = Math.floor(nowMs() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: now - 30, exp: now + 3600 }));
  return `${h}.${p}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}

/* ---- the stand-in network ---- */
let trades: Record<string, unknown>[] = [];
type Net = { xai: { path: string; body: Record<string, unknown> }[]; inc: { date: string; column: string }[]; refunds: { date: string; column: string }[]; stray: string[]; paths: string[]; binance: number };
const net: Net = { xai: [], inc: [], refunds: [], stray: [], paths: [], binance: 0 };
let refundLands = true;            // false: refund_ai_usage answers null (the 4th refund of the day / a failed refund)
let incrementBlocked = false;      // true: increment_ai_usage answers null (the user's cap)
let xaiAnswer: () => Response = () => chatOk('A fine report.\nBIAS: ok');
let binanceAnswer: () => Response = () => json(500, { msg: 'nope' });
let onPath: ((p: string) => void) | null = null;   // runs when the stand-in sees this supabase path
const chatOk = (content: string, extra: Record<string, unknown> = {}) => json(200, { model: 'grok-4.3', usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ message: { role: 'assistant', content }, ...extra }] });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') { net.xai.push({ path: url.pathname, body: JSON.parse(await req.text()) }); return xaiAnswer(); }
  if (url.origin === 'https://api.binance.com') { net.binance++; return binanceAnswer(); }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  const p = url.pathname; net.paths.push(p); onPath?.(p);
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') { const b = JSON.parse(await req.text()); net.inc.push({ date: b.p_date, column: b.p_column }); return json(200, incrementBlocked ? null : net.inc.length); }
  if (p === '/rest/v1/rpc/refund_ai_usage') { const b = JSON.parse(await req.text()); net.refunds.push({ date: b.p_date, column: b.p_column }); return json(200, refundLands ? 1 : null); }
  if (p.endsWith('trades') && req.method === 'GET') return json(200, trades);
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) return one({ role: 'pro', trial_ends_at: null, current_period_end: '2099-01-01T00:00:00.000Z' });
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; globalThis.Date = RealDate; });
const standInFetch = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run would reach the real network'); });

const { POST: SHADOW } = await import('../app/api/shadow-account/route.ts');
const { POST: BIAS } = await import('../app/api/behavioral-bias/route.ts');
const { POST: PINE } = await import('../app/api/pine-script/route.ts');
const { POST: STRAT } = await import('../app/api/strategy-research/route.ts');
/* smc-snapshot and draw-structure declare a class with parameter properties, which this Node's type-stripping cannot load: they go through jiti, as qa/harness/aiIncomplete.test.mts does. */
const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() }, interopDefault: true, moduleCache: false });
const SMC = ((await jiti.import(fileURLToPath(new URL('../app/api/smc-snapshot/route.ts', import.meta.url)))) as { POST: (r: NextRequest) => Promise<Response> }).POST;
const DRAW = ((await jiti.import(fileURLToPath(new URL('../app/api/draw-structure/route.ts', import.meta.url)))) as { POST: (r: NextRequest) => Promise<Response> }).POST;
const { isRoundPrice, stopLossNumber } = await import('../lib/roundPrice.ts');
const { stripCodeFence } = await import('../lib/codeFence.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.inc = []; net.refunds = []; net.stray = []; net.paths = []; net.binance = 0; trades = []; refundLands = true; incrementBlocked = false; onPath = null; fixed = null; xaiAnswer = () => chatOk('A fine report.\nBIAS: ok'); binanceAnswer = () => json(500, { msg: 'nope' }); });
afterEach(() => _resetApiHealthQueue());

let TOK = await token();
const call = (fn: (r: NextRequest) => Promise<Response>, path: string, body: unknown = {}) => fn(new NextRequest(`http://localhost${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
const mk = (i: number, over: Record<string, unknown> = {}) => ({ id: `c${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, stop_loss: 95, exit_price: 101, leverage: 5, created_at: `2026-11-0${(i % 9) + 1}T10:00:00Z`, setup_type: 'breakout', session: 'ny', notes: '', ...over });
const five = (over: Record<string, unknown>[] = []) => Array.from({ length: 5 }, (_, i) => mk(i, over[i] ?? {}));
/* xaiFetch puts the guardrail in as messages[0]; the route's own prompt is the last message */
const promptOf = () => { const m = net.xai[0].body.messages as { role: string; content: string }[]; return String(m[m.length - 1].content); };

/* ===== P1-P3 pure ===== */
test('P1. isRoundPrice: <= 2 significant digits is round; zero, negatives, NaN, 3+ significant digits are not', () => {
  const yes = [100, 64000, 3500, 150, 2.5, 0.12, 0.1 + 0.2, 1, 10, 99, 0.5, 70000];
  const no = [0, -100, NaN, Infinity, -Infinity, 64500, 105, 1234, 0.123, 99.5, 3501, 0.1234];
  for (const x of yes) assert.equal(isRoundPrice(x), true, `${x} should be round`);
  for (const x of no) assert.equal(isRoundPrice(x), false, `${x} should not be round`);
  assert.equal(isRoundPrice('100' as unknown as number), false, 'a string is not a number');
  assert.equal(isRoundPrice(undefined as unknown as number), false);
  assert.equal(isRoundPrice(null as unknown as number), false);
});
test('P2. stopLossNumber: missing or non-numeric is null, numeric strings parse', () => {
  assert.equal(stopLossNumber(''), null); assert.equal(stopLossNumber(null), null); assert.equal(stopLossNumber(undefined), null);
  assert.equal(stopLossNumber('abc'), null); assert.equal(stopLossNumber(NaN), null); assert.equal(stopLossNumber(Infinity), null);
  assert.equal(stopLossNumber('2.5'), 2.5); assert.equal(stopLossNumber(64000), 64000); assert.equal(stopLossNumber(0), 0);
  assert.equal(stopLossNumber({}), null); assert.equal(stopLossNumber(true), null);
});
test('P3. stripCodeFence: inside of the first fenced block; CRLF to LF; open fence only; no fence unchanged', () => {
  const code = '//@version=6\nindicator("x")';
  assert.equal(stripCodeFence('```pinescript\n' + code + '\n```'), code);
  assert.equal(stripCodeFence('```\n' + code + '\n```'), code);
  assert.equal(stripCodeFence('Here is the script:\n```pine\n' + code + '\n```\nHope it helps.'), code);
  assert.equal(stripCodeFence('```pinescript\r\n//@version=6\r\nindicator("x")\r\n```'), code);
  assert.equal(stripCodeFence('```pinescript\n' + code), code, 'an opening fence with no closing one gives the text after the opening line');
  assert.equal(stripCodeFence(code), code, 'no fence is unchanged');
  assert.equal(stripCodeFence('  \n' + code + '\n'), '  \n' + code + '\n', 'no fence: byte-identical, whitespace included');
  assert.equal(stripCodeFence('```a\nONE\n```\n```b\nTWO\n```'), 'ONE', 'only the first block');
  assert.equal(stripCodeFence(''), '');
  assert.equal(stripCodeFence('```\n```'), '', 'an empty fence is empty (the route then refuses it)');
  assert.ok(!/```/.test(stripCodeFence('```pinescript\n' + code + '\n```')), 'no fence line survives');
});

/* ===== B / H / SR prompts ===== */
test('B1. behavioral-bias prompt: 5 closed trades, one stop 0, one stop "2.5", rest not round -> exactly 1 round stop; the new rules are in; the old ones are gone', async () => {
  trades = five([{ stop_loss: 0 }, { stop_loss: '2.5' }, { stop_loss: 64500 }, { stop_loss: 1234 }, { stop_loss: null }]);
  const r = await call(BIAS, '/api/behavioral-bias'); assert.equal(r.status, 200);
  const p = promptOf();
  assert.match(p, /Round-number stop losses \([^)]*\): 1 trades/, 'a stop of 0 / missing / 3+ digits was counted, or 2.5 was missed');
  assert.ok(p.includes('Losses larger than 1R'));
  assert.ok(p.includes('Never estimate, project or invent a dollar figure'));
  assert.ok(!p.includes('Estimated bias drag'), 'the old "Estimated bias drag" ask is still there');
  assert.ok(!p.includes('$100 numbers'), 'the old "$100 numbers" test text is still there');
  assert.ok(!p.includes('estimate the dollar P&L drag'));
  assert.ok(p.includes('holding losing trades too long and closing winning trades too early'), 'the disposition definition');
  for (const h of ['DISPOSITION_EFFECT:', 'OVERTRADING:', 'MOMENTUM_CHASING:', 'ANCHORING_BIAS:', 'PNL_IMPACT:', 'PRIORITY_FIX:']) assert.ok(p.includes(h), `the output header ${h} (the page parser) is gone`);
});
test('B2. behavioral-bias: "Losses larger than 1R" counts only losses with pnl_r < -1 (-1 exactly, a win and a missing R do not count)', async () => {
  trades = five([{ result: 'LOSS', pnl_r: -1.5 }, { result: 'LOSS', pnl_r: -1 }, { result: 'WIN', pnl_r: -3 }, { result: 'LOSS', pnl_r: undefined }, { result: 'LOSS', pnl_r: -2.01 }]);
  await call(BIAS, '/api/behavioral-bias');
  assert.match(promptOf(), /Losses larger than 1R \([^)]*\): 2\n/);
});
test('B3. behavioral-bias: trades with missing numbers never put NaN into the prompt', async () => {
  trades = five([{ pnl_usd: undefined, pnl_r: undefined }, { pnl_usd: null, pnl_r: null }, {}, {}, { stop_loss: undefined, entry_price: undefined }]);
  const r = await call(BIAS, '/api/behavioral-bias'); assert.equal(r.status, 200);
  assert.ok(!/NaN/.test(promptOf()), 'NaN in the prompt: ' + (promptOf().match(/.{40}NaN.{20}/)?.[0] ?? ''));
});
test('H1. shadow-account prompt: 10-trade floor and "not a forecast", with the "Not enough trades per type" fallback', async () => {
  trades = five(); const r = await call(SHADOW, '/api/shadow-account'); assert.equal(r.status, 200);
  const p = promptOf();
  assert.ok(p.includes('at least 10 closed trades')); assert.ok(p.includes('it is not a forecast'));
  assert.ok(p.includes('Not enough trades per type to compare.'));
  assert.ok(p.includes('SHADOW_STRATEGY:'), 'the output header the page parses');
});
test('SR1. strategy-research prompt: sample size zero, no measured figures, rating is a judgement', async () => {
  const r = await call(STRAT, '/api/strategy-research', { description: 'buy dips on btc when RSI is below thirty' }); assert.equal(r.status, 200, String(r.status));
  const p = promptOf();
  assert.ok(p.includes('the sample size is zero')); assert.ok(p.includes('Do not state a win rate, expectancy, drawdown'));
  assert.ok(p.includes('is a judgement from general knowledge, not a measurement'));
  for (const h of ['THEORETICAL_EDGE', 'HONEST_ASSESSMENT', 'PARAMETER_SUGGESTIONS']) assert.ok(p.includes(h), h);
});

/* ===== X: shadow + bias failure paths ===== */
for (const [name, fn, path, col] of [['shadow-account', SHADOW, '/api/shadow-account', 'shadow_account_count'], ['behavioral-bias', BIAS, '/api/behavioral-bias', 'behavioral_bias_count']] as const) {
  test(`X1. ${name}: the paid call THROWS -> 502 "AI service error" (not a bare 500), reserved once, refunded once`, async () => {
    trades = five(); xaiAnswer = () => { throw new Error('socket hang up SECRET-DETAIL'); };
    const r = await call(fn, path); const b = await r.json() as { error?: string };
    assert.equal(r.status, 502); assert.equal(b.error, 'AI service error'); assert.ok(!JSON.stringify(b).includes('SECRET-DETAIL'));
    assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 1);
  });
  test(`X2. ${name}: a 200 with EMPTY content -> 502 AI_INCOMPLETE, refunded once, body says refunded:true`, async () => {
    trades = five(); xaiAnswer = () => chatOk('   ');
    const r = await call(fn, path); const b = await r.json() as { code?: string; refunded?: boolean; error?: string };
    assert.equal(r.status, 502); assert.equal(b.code, 'AI_INCOMPLETE'); assert.equal(b.refunded, true); assert.match(b.error ?? '', /Nothing was charged/);
    assert.equal(net.refunds.length, 1);
  });
  test(`X3. ${name}: finish_reason length (cut off) -> 502 AI_INCOMPLETE, refunded once`, async () => {
    trades = five(); xaiAnswer = () => chatOk('A half report that stops mid-sen', { finish_reason: 'length' });
    const r = await call(fn, path); const b = await r.json() as { code?: string };
    assert.equal(r.status, 502); assert.equal(b.code, 'AI_INCOMPLETE'); assert.equal(net.refunds.length, 1);
  });
  test(`X4. ${name}: a good answer is 200 and NOT refunded`, async () => {
    trades = five(); const r = await call(fn, path); const b = await r.json() as { analysis?: string; tradeCount?: number };
    assert.equal(r.status, 200); assert.equal(b.tradeCount, 5); assert.ok(b.analysis); assert.equal(net.refunds.length, 0); assert.equal(net.inc.length, 1);
  });
  test(`X5. ${name}: a provider error body is logged, never shown ("boom" absent, "AI service error" present), refunded once`, async () => {
    trades = five(); xaiAnswer = () => json(500, { error: 'boom' });
    const r = await call(fn, path); const t = await r.text();
    assert.equal(r.status, 502); assert.ok(t.includes('AI service error')); assert.ok(!t.includes('boom'), 'the provider error text reached the user'); assert.equal(net.refunds.length, 1);
  });
  test(`X6. ${name}: the refund does NOT land (answers null) -> AI_INCOMPLETE says refunded:false and does NOT claim "Nothing was charged"`, async () => {
    trades = five(); xaiAnswer = () => chatOk(''); refundLands = false;
    const r = await call(fn, path); const b = await r.json() as { refunded?: boolean; error?: string; code?: string };
    assert.equal(b.code, 'AI_INCOMPLETE'); assert.equal(b.refunded, false); assert.ok(!/Nothing was charged/.test(b.error ?? ''), 'told the user nothing was charged although the refund did not land');
  });
  test(`X7. ${name}: reservation and refund name the same column`, async () => {
    trades = five(); xaiAnswer = () => chatOk('');
    await call(fn, path); assert.equal(net.inc[0].column, col); assert.equal(net.refunds[0].column, col);
  });
}

/* ===== N1 pine ===== */
const PINE_BODY = { description: 'ema cross with an rsi filter', analysisText: 'analysis' };
test('N1. pine-script: a fenced answer returns the script with no fence line; an unfenced one is unchanged; an EMPTY fence is AI_INCOMPLETE and refunded', async () => {
  xaiAnswer = () => chatOk('```pinescript\n//@version=6\nindicator("x")\n```');
  let r = await call(PINE, '/api/pine-script', PINE_BODY); let b = await r.json() as { code?: string };
  assert.equal(r.status, 200); assert.equal(b.code, '//@version=6\nindicator("x")'); assert.equal(net.refunds.length, 0);
  xaiAnswer = () => chatOk('//@version=6\nindicator("y")');
  r = await call(PINE, '/api/pine-script', PINE_BODY); b = await r.json() as { code?: string };
  assert.equal(b.code, '//@version=6\nindicator("y")');
  net.refunds = []; xaiAnswer = () => chatOk('```pinescript\n```');
  r = await call(PINE, '/api/pine-script', PINE_BODY); const e = await r.json() as { code?: string };
  assert.equal(r.status, 502); assert.equal(e.code, 'AI_INCOMPLETE'); assert.equal(net.refunds.length, 1);
});

/* ===== U9 ===== */
const SMC_BODY = { asset: 'BTC', tf: '1h' };
test('U9-smc. smc-snapshot: a failed read whose refund lands -> 502 with refunded:true; a refund that does not land -> refunded:false', async () => {
  let r = await call(SMC, '/api/smc-snapshot', { asset: 'ETH', tf: '1h' }); let b = await r.json() as Record<string, unknown>;
  assert.equal(r.status, 502); assert.equal(b.error, 'Request failed'); assert.equal(b.refunded, true); assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 1);
  net.inc = []; net.refunds = []; refundLands = false;
  r = await call(SMC, '/api/smc-snapshot', { asset: 'SOL', tf: '1h' }); b = await r.json() as Record<string, unknown>;
  assert.equal(r.status, 502); assert.equal(b.refunded, false); assert.equal(net.refunds.length, 1);
});
test('U9-smc-b. smc-snapshot: a rate-limit refusal has NO refunded key and nothing is refunded', async () => {
  incrementBlocked = true;
  const r = await call(SMC, '/api/smc-snapshot', { asset: 'XRP', tf: '1h' }); const b = await r.json() as Record<string, unknown>;
  assert.ok(r.status === 429 || r.status === 503, String(r.status)); assert.ok(!('refunded' in b), JSON.stringify(b)); assert.equal(net.refunds.length, 0);
});
const candles = (n: number, intervalMs: number) => { const end = Math.floor(nowMs() / intervalMs) * intervalMs - intervalMs * 2; return Array.from({ length: n }, (_, i) => { const t = end - (n - 1 - i) * intervalMs; const p = 100 + (i % 7); return { timestamp: t, open: p, high: p + 2, low: p - 2, close: p + 1 }; }); };
const H4 = 4 * 3_600_000;
let drawN = 0;
const drawBody = () => ({ coin: 'btc', tf: '4h', candles: candles(80, H4).map((c) => ({ ...c, open: c.open + (drawN % 1000) * 1e-6 })) });
const draw = () => { drawN++; return call(DRAW, '/api/draw-structure', drawBody()); };
test('U9-draw. draw-structure: BAD_ANSWER, UNDRAWABLE and an unclassified failure each carry refunded:true when the refund lands and refunded:false when not', async () => {
  const cases: [string, () => Response][] = [
    ['BAD_ANSWER', () => chatOk('I cannot draw anything here.')],
    ['UNDRAWABLE', () => chatOk('{"structures":[{"type":"not-a-real-type","points":[{"i":1,"price":1}]}]}')],
    ['(non-2xx)', () => json(500, { error: 'upstream' })],
  ];
  for (const [code, ans] of cases) for (const lands of [true, false]) {
    net.inc = []; net.refunds = []; refundLands = lands; xaiAnswer = ans;
    const r = await draw(); const b = await r.json() as Record<string, unknown>;
    assert.equal(r.status, 502, `${code}: status`);
    if (code !== '(non-2xx)') assert.equal(b.code, code);
    assert.equal(b.refunded, lands, `${code} lands=${lands}: body ${JSON.stringify(b)}`);
    assert.equal(net.refunds.length, 1, `${code}: refund tried once`);
  }
});
test('U9-draw-b. draw-structure: a rate-limit refusal has no refunded key, and a 2xx-then-unclassified failure is NOT refunded and carries no refunded key', async () => {
  incrementBlocked = true;
  let r = await draw(); let b = await r.json() as Record<string, unknown>;
  assert.ok(r.status === 429 || r.status === 503, String(r.status)); assert.ok(!('refunded' in b)); assert.equal(net.refunds.length, 0);
  incrementBlocked = false; net.inc = [];
  xaiAnswer = () => new Response('not json at all', { status: 200, headers: { 'content-type': 'application/json' } });
  r = await draw(); b = await r.json() as Record<string, unknown>;
  assert.equal(r.status, 502); assert.equal(net.refunds.length, 0, 'a billed 2xx was refunded'); assert.ok(!('refunded' in b));
});

/* ===== U12: the clock crosses 00:00 UTC between capturing the day and the reservation ===== */
async function straddle(run: () => Promise<Response>, hookPathIncludes: string) {
  fixed = MIDNIGHT_MINUS; TOK = await token();
  let moved = false;
  onPath = (p) => { if (!moved && p.includes(hookPathIncludes)) { moved = true; fixed = (fixed ?? 0) + 5; } };
  const r = await run(); await r.text();
  assert.ok(moved, `the clock never moved: the hook path "${hookPathIncludes}" was not hit; paths seen: ${net.paths.join(' ')}`);
  assert.equal(net.inc.length, 1, 'reserved once'); assert.equal(net.refunds.length, 1, 'refunded once');
  assert.equal(net.refunds[0].date, net.inc[0].date, `reservation wrote ${net.inc[0].date} but the refund hit ${net.refunds[0].date}`);
  assert.equal(net.inc[0].date, '2026-11-19', 'the reservation is on the day the request began');
}
const ONE_ARG = [
  ['behavioral-bias', () => { trades = five(); xaiAnswer = () => json(500, { error: 'x' }); return call(BIAS, '/api/behavioral-bias'); }],
  ['shadow-account', () => { trades = five(); xaiAnswer = () => json(500, { error: 'x' }); return call(SHADOW, '/api/shadow-account'); }],
  ['pine-script', () => { xaiAnswer = () => json(500, { error: 'x' }); return call(PINE, '/api/pine-script', PINE_BODY); }],
  ['strategy-research', () => { xaiAnswer = () => json(500, { error: 'x' }); return call(STRAT, '/api/strategy-research', { description: 'buy dips on btc when RSI is below thirty' }); }],
] as const;
for (const [name, run] of ONE_ARG) {
  test(`U12-${name}. clock crosses midnight after the day is captured and before the reserve RPC: increment and refund name the same day`, async () => {
    await straddle(run, 'lhq_ai_spend_');
  });
}
test('U12-smc. smc-snapshot: midnight passes DURING the reserve RPC: increment and refund name the same day', async () => {
  fixed = MIDNIGHT_MINUS; TOK = await token();
  let moved = false; onPath = (p) => { if (!moved && p === '/rest/v1/rpc/increment_ai_usage') { moved = true; fixed = (fixed ?? 0) + 5; } };
  const r = await call(SMC, '/api/smc-snapshot', { asset: 'ADA', tf: '1h' }); await r.text();
  assert.ok(moved); assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 1);
  assert.equal(net.refunds[0].date, net.inc[0].date, `reservation wrote ${net.inc[0].date} but the refund hit ${net.refunds[0].date}`);
});
test('U12-draw. draw-structure: midnight passes DURING the reserve RPC: increment and refund name the same day', async () => {
  fixed = MIDNIGHT_MINUS; TOK = await token();
  xaiAnswer = () => chatOk('no json here');
  let moved = false; onPath = (p) => { if (!moved && p === '/rest/v1/rpc/increment_ai_usage') { moved = true; fixed = (fixed ?? 0) + 5; } };
  const r = await call(DRAW, '/api/draw-structure', { coin: 'btc', tf: '4h', candles: candles(80, H4) }); await r.text();
  assert.ok(moved); assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 1);
  assert.equal(net.refunds[0].date, net.inc[0].date, `reservation wrote ${net.inc[0].date} but the refund hit ${net.refunds[0].date}`);
});

/* ===== S1 source pin: every caller passes the day ===== */
test('S1. every incrementToolUsage / incrementUsageColumn caller passes the day it refunds against, except grok-chat (the documented exception)', () => {
  const root = new URL('../app/api/', import.meta.url);
  const files: string[] = [];
  const walk = (d: URL) => { for (const e of readdirSync(d, { withFileTypes: true })) { const u = new URL(e.name + (e.isDirectory() ? '/' : ''), d); if (e.isDirectory()) walk(u); else if (e.name === 'route.ts') files.push(u.pathname); } };
  walk(root);
  const missing: string[] = [];
  for (const f of files) {
    const s = readFileSync(decodeURIComponent(f.replace(/^\/([A-Za-z]:)/, '$1')), 'utf8').replace(/\r\n/g, '\n');
    for (const m of s.matchAll(/(incrementToolUsage|incrementUsageColumn)\(([^\n]*)\)/g)) {
      const args = m[2];
      const want = m[1] === 'incrementToolUsage' ? 4 : 7;
      const n = args.split(',').length;
      if (n < want && !f.includes('grok-chat')) missing.push(`${f.split('/api/')[1]}: ${m[0].slice(0, 100)}`);
      if (n >= want && f.includes('grok-chat')) missing.push(`grok-chat now passes the day (widen the pin): ${m[0]}`);
    }
  }
  assert.deepEqual(missing, []);
});
