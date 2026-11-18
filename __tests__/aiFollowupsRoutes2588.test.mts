/* QA BEHAVIOURAL PINS for PR #2588 items 2 and 3 (#1631 follow-ups). The REAL route handlers run in-process against a stand-in network
 * (pattern of aiTrackerRoutes1631.test.mts). No paid call is ever made: api.x.ai, Supabase and everything else is answered by the stand-in.
 * Expectations are hand-derived from the PR body, not copied from a run.
 *   R1  pine-script / thesis-check / strategy-research, an EMPTY or CUT-OFF answer:
 *         refund lands     -> 502 AI_INCOMPLETE, refunded:true,  error says "Nothing was charged"
 *         refund null/500/throw -> 502 AI_INCOMPLETE, refunded:false, error is exactly "... Try again." and says nothing about charging
 *   R2  the reserve was never made (cap hit): no AI call, no refund, no `refunded` key, no "charged" claim
 *   R3  a good answer: 200, no refund; reserved once, refunded at most once on every path
 *   R4  no provider text leaks (a provider error body, the half answer of a cut-off one, a thrown error)
 *   R5  the incomplete body has exactly {error, code, refunded}
 *   C1  stripCodeFence table   C2  stripCodeFence cannot be made to run for seconds   C3  Pine route: a stripped-to-nothing answer is AI_INCOMPLETE + refund
 *   H1  shadow-account prompt still holds the fallback sentence the page compares against */
import test, { after, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
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

const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: now - 30, exp: now + 3600 }));
  return `${h}.${p}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}

/* ---- the stand-in network ---- */
type RefundMode = 'lands' | 'null' | 'http500' | 'throws';
let trades: Record<string, unknown>[] = [];
const net = { xai: [] as { body: Record<string, unknown> }[], inc: [] as { column: string }[], refunds: [] as { column: string }[], stray: [] as string[] };
let refundMode: RefundMode = 'lands'; let refundValue = 1;
let incrementBlocked = false;
let xaiAnswer: () => Response = () => chatOk('A fine answer.');
const chatOk = (content: unknown, extra: Record<string, unknown> = {}) => json(200, { model: 'grok-4.3', usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ message: { role: 'assistant', content }, ...extra }] });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') { net.xai.push({ body: JSON.parse(await req.text()) }); return xaiAnswer(); }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  const p = url.pathname;
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') { const b = JSON.parse(await req.text()); net.inc.push({ column: b.p_column }); return json(200, incrementBlocked ? null : net.inc.length); }
  if (p === '/rest/v1/rpc/refund_ai_usage') {
    const b = JSON.parse(await req.text()); net.refunds.push({ column: b.p_column });
    if (refundMode === 'throws') throw new TypeError('fetch failed REFUND-SECRET');
    if (refundMode === 'http500') return json(500, { message: 'refund exploded', code: 'XX000' });
    return json(200, refundMode === 'lands' ? refundValue : null);
  }
  if (p.endsWith('trades') && req.method === 'GET') return json(200, trades);
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) return one({ role: 'pro', trial_ends_at: null, current_period_end: '2099-01-01T00:00:00.000Z' });
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const standInFetch = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run would reach the real network'); });

const { POST: PINE } = await import('../app/api/pine-script/route.ts');
const { POST: THESIS } = await import('../app/api/thesis-check/route.ts');
const { POST: STRAT } = await import('../app/api/strategy-research/route.ts');
const { POST: SHADOW } = await import('../app/api/shadow-account/route.ts');
const { stripCodeFence } = await import('../lib/codeFence.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.inc = []; net.refunds = []; net.stray = []; trades = []; refundMode = 'lands'; refundValue = 1; incrementBlocked = false; xaiAnswer = () => chatOk('A fine answer.'); _resetApiHealthQueue(); });

const TOK = await token();
const call = (fn: (r: NextRequest) => Promise<Response>, path: string, body: unknown = {}) => fn(new NextRequest(`http://localhost${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
}));
type Body = { error?: string; code?: string; refunded?: boolean; analysis?: string; [k: string]: unknown };
const ROUTES = [
  { name: 'pine-script', fn: PINE, path: '/api/pine-script', body: { description: 'ema cross with an rsi filter', analysisText: 'analysis' }, col: 'pine_script_count', good: '//@version=6\nindicator("x")', okKey: 'code' },
  { name: 'thesis-check', fn: THESIS, path: '/api/thesis-check', body: { symbol: 'BTC', direction: 'LONG', entryDate: '2026-11-01', thesisText: 'BTC breaks 70k on ETF flows', assumptions: ['ETF flows stay positive'] }, col: 'thesis_check_count', good: 'ASSUMPTION_CHECK:\nHOLDS: ok', okKey: 'analysis' },
  { name: 'strategy-research', fn: STRAT, path: '/api/strategy-research', body: { description: 'buy dips on btc when RSI is below thirty' }, col: 'strategy_research_count', good: 'THEORETICAL_EDGE:\nsomething', okKey: 'analysis' },
] as const;
const run = async (r: (typeof ROUTES)[number]) => { const res = await call(r.fn, r.path, r.body); const text = await res.text(); let b: Body = {}; try { b = JSON.parse(text); } catch { /* not json */ } return { status: res.status, b, text }; };

const INCOMPLETE: [string, () => Response][] = [
  ['an empty string', () => chatOk('')],
  ['whitespace only', () => chatOk('   \n\t ')],
  ['null content', () => chatOk(null)],
  ['no choices at all', () => json(200, { model: 'grok-4.3', usage: {}, choices: [] })],
  ['a half answer cut off at the cap (finish_reason length)', () => chatOk('HALF-ANSWER-DO-NOT-SHOW that stops mid-sen', { finish_reason: 'length' })],
];

for (const r of ROUTES) {
  for (const [label, ans] of INCOMPLETE) {
    test(`R1a. ${r.name}: ${label}, refund LANDS -> 502 AI_INCOMPLETE, refunded:true, "Nothing was charged", one reserve, one refund`, async () => {
      xaiAnswer = ans; const o = await run(r);
      assert.equal(o.status, 502, o.text); assert.equal(o.b.code, 'AI_INCOMPLETE'); assert.equal(o.b.refunded, true);
      assert.match(o.b.error ?? '', /Nothing was charged/); assert.equal(o.b.error, 'The AI answer was incomplete. Nothing was charged. Try again.');
      assert.equal(net.inc.length, 1, 'reserved once'); assert.equal(net.refunds.length, 1, 'refunded exactly once');
      assert.equal(net.inc[0].column, r.col, 'reserved the wrong counter'); assert.equal(net.refunds[0].column, r.col, 'refunded a different counter than it reserved');
      assert.ok(!o.text.includes('HALF-ANSWER-DO-NOT-SHOW'), 'the half answer reached the user');
    });
    for (const mode of ['null', 'http500', 'throws'] as const) {
      test(`R1b. ${r.name}: ${label}, refund ${mode} -> 502 AI_INCOMPLETE, refunded:false, exactly "Try again.", NO claim of non-charge`, async () => {
        xaiAnswer = ans; refundMode = mode; const o = await run(r);
        assert.equal(o.status, 502, o.text); assert.equal(o.b.code, 'AI_INCOMPLETE'); assert.equal(o.b.refunded, false);
        assert.equal(o.b.error, 'The AI answer was incomplete. Try again.');
        assert.doesNotMatch(o.b.error ?? '', /charge|refund|free|no cost|not billed|credit/i, 'the message talks about charging although the refund did not land: ' + o.text);
        assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 1, 'the refund must be tried exactly once, never retried');
        assert.ok(!o.text.includes('REFUND-SECRET') && !o.text.includes('refund exploded') && !o.text.includes('HALF-ANSWER-DO-NOT-SHOW'), 'internal text leaked: ' + o.text);
      });
    }
  }

  test(`R2. ${r.name}: the cap is hit (the reserve is never made) -> no AI call, no refund, no "refunded" key, no claim of non-charge`, async () => {
    incrementBlocked = true; const o = await run(r);
    assert.ok(o.status === 429 || o.status === 503, `status ${o.status}: ${o.text}`);
    assert.equal(net.xai.length, 0, 'a paid call was made without a reservation'); assert.equal(net.refunds.length, 0, 'a refund was tried for a reservation that was never made');
    assert.ok(!('refunded' in o.b), o.text); assert.notEqual(o.b.code, 'AI_INCOMPLETE'); assert.doesNotMatch(o.text, /Nothing was charged/);
  });

  test(`R3. ${r.name}: a good answer is 200, reserved once, NOT refunded, and carries no "refunded" key`, async () => {
    xaiAnswer = () => chatOk(r.good); const o = await run(r);
    assert.equal(o.status, 200, o.text); assert.ok(o.b[r.okKey]); assert.ok(!('refunded' in o.b)); assert.equal(net.inc.length, 1); assert.equal(net.refunds.length, 0);
  });
  test(`R3b. ${r.name}: a good answer is not refunded even if the refund path would fail (refund RPC never called)`, async () => {
    xaiAnswer = () => chatOk(r.good); refundMode = 'throws'; const o = await run(r); assert.equal(o.status, 200); assert.equal(net.refunds.length, 0);
  });

  test(`R4. ${r.name}: a provider error body is logged, never shown; refunded once; not labelled AI_INCOMPLETE`, async () => {
    xaiAnswer = () => json(500, { error: 'PROVIDER-BOOM grok-4.3 key sk-123' }); const o = await run(r);
    assert.equal(o.status, 502); assert.ok(o.text.includes('AI service error')); assert.ok(!o.text.includes('PROVIDER-BOOM') && !o.text.includes('sk-123'), o.text);
    assert.notEqual(o.b.code, 'AI_INCOMPLETE'); assert.equal(net.refunds.length, 1); assert.doesNotMatch(o.text, /Nothing was charged/, 'this path never claimed it before this PR; it must not start');
  });
  test(`R4b. ${r.name}: the paid call THROWS -> refunded once, nothing leaked`, async () => {
    xaiAnswer = () => { throw new Error('socket hang up THROWN-SECRET'); };
    let text = ''; let status = 0;
    try { const res = await call(r.fn, r.path, r.body); status = res.status; text = await res.text(); } catch (e) { text = 'THROWN:' + String(e); }
    assert.equal(net.refunds.length, 1, 'a thrown call must give the use back once'); assert.equal(net.inc.length, 1);
    if (status) assert.ok(!text.includes('THROWN-SECRET'), text);
  });
  test(`R5. ${r.name}: the incomplete body has exactly the keys error, code, refunded (nothing else)`, async () => {
    for (const mode of ['lands', 'null'] as const) {
      net.inc = []; net.refunds = []; refundMode = mode; xaiAnswer = () => chatOk('');
      const o = await run(r); assert.deepEqual(Object.keys(o.b).sort(), ['code', 'error', 'refunded'], o.text);
    }
  });
  test(`R6. ${r.name}: refunded is the boolean value of the refund result, never a count or a string`, async () => {
    xaiAnswer = () => chatOk(''); const o = await run(r); assert.strictEqual(o.b.refunded, true);
  });
}

/* ===== source pins: the two bodies are the only places that speak, and each is gated on the refund result ===== */
import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('R7. in each of the three routes "Nothing was charged" occurs once in code and only after the refund result is read', () => {
  for (const f of ['pine-script', 'thesis-check', 'strategy-research']) {
    const s = src(`app/api/${f}/route.ts`);
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((code.match(/Nothing was charged/g) ?? []).length, 1, f);
    assert.ok(code.indexOf('Nothing was charged') > code.indexOf('refundToolUsage(authData.user.id,'), f);
    assert.match(code, /const refunded = \(await refundToolUsage\(authData\.user\.id, '\w+', reservedOn\)\) !== null;/, f + ': refunded is not derived from the refund result');
  }
});

/* ===== H1 ===== */
test('H1. shadow-account prompt still tells the AI to write the fallback sentence the page compares against', async () => {
  trades = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, coin: 'BTC', direction: 'LONG', result: i % 2 ? 'LOSS' : 'WIN', pnl_usd: i % 2 ? -10 : 20, pnl_r: i % 2 ? -1 : 2, entry_price: 100, stop_loss: 95, exit_price: 101, leverage: 5, created_at: `2026-11-0${(i % 9) + 1}T10:00:00Z`, setup_type: 'breakout', session: 'ny', notes: '' }));
  const res = await call(SHADOW, '/api/shadow-account'); assert.equal(res.status, 200);
  const m = net.xai[0].body.messages as { content: string }[]; const p = String(m[m.length - 1].content);
  assert.ok(p.includes('write "Not enough trades per type to compare." and nothing else'), 'the prompt no longer promises the exact fallback sentence');
  assert.ok(p.includes('at least 10 closed trades'));
});

/* ===== C1 stripCodeFence ===== */
const CODE = '//@version=6\nindicator("x")';
const rows: [string, string, string][] = [
  ['closed fence with language tag', '```pinescript\n' + CODE + '\n```', CODE],
  ['closed fence without a tag', '```\n' + CODE + '\n```', CODE],
  ['closed fence, CRLF', '```pinescript\r\n//@version=6\r\nindicator("x")\r\n```', CODE],
  ['closed fence with prose before and after', 'Here is the script:\n```pine\n' + CODE + '\n```\nHope it helps.', CODE],
  ['closed fence, no newline before the closing fence', '```pine\n' + CODE + '```', CODE],
  ['closed fence, trailing blank lines inside are trimmed', '```pine\n' + CODE + '\n\n\n```', CODE],
  ['closed fence, leading blank lines inside are kept (nothing inside is edited)', '```pine\n\n' + CODE + '\n```', '\n' + CODE],
  ['two closed fences: only the first', '```a\nONE\n```\n```b\nTWO\n```', 'ONE'],
  ['open fence at the start', '```pinescript\n' + CODE, CODE],
  ['open fence at the start with leading blank lines (spaces)', '  \n```pinescript\n' + CODE, CODE],
  ['unclosed fence AFTER prose (PR)', 'Here is the script:\n```pine\n' + CODE, CODE],
  ['unclosed fence AFTER prose, CRLF (PR)', 'Here is the script:\r\n```pine\r\n//@version=6\r\nindicator("x")', CODE],
  ['unclosed fence after prose, indented fence line (PR)', 'Intro\n  ```pine\n<code>\n', '<code>'],
  ['unclosed fence after prose, tab-indented fence line', 'Intro\n\t```pine\n<code>', '<code>'],
  ['unclosed fence after SEVERAL prose lines', 'Sure.\nHere you go.\n\n```pinescript\n' + CODE, CODE],
  ['fence line with NO language tag after prose', 'Sure:\n```\n' + CODE, CODE],
  ['a lone fence line at the very end -> empty script (PR)', 'Intro\n```pine', ''],
  ['a lone bare fence at the very end', 'Intro\n```', ''],
  ['a lone fence line at the end with a trailing newline', 'Intro\n```pine\n', ''],
  ['fence at the very start and nothing else', '```', ''],
  ['an empty closed fence', '```\n```', ''],
  ['an empty closed fence with a tag', '```pinescript\n```', ''],
  ['two fences: closed first, then an unclosed one: the closed one wins', '```a\nONE\n```\ntext\n```b\nTWO', 'ONE'],
  ['prose, then an unclosed fence whose code contains a backtick-free line', 'x\n```pine\nplot(close)\nplot(open)', 'plot(close)\nplot(open)'],
  ['4-backtick CLOSED fence: inner code, nothing else of the fence survives but one stray backtick is NOT allowed to lead', '````pine\n' + CODE + '\n````', CODE],
];
test('C1a. stripCodeFence table', () => {
  const bad: string[] = [];
  for (const [label, input, want] of rows) { const got = stripCodeFence(input); if (got !== want) bad.push(`${label}\n    in   ${JSON.stringify(input)}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(got)}`); }
  assert.deepEqual(bad, []);
});
test('C1b. no fence at all -> byte-identical (whitespace, CRLF, backticks mid-line, tildes, one or two backticks, inline code)', () => {
  const same = [
    CODE, '  \n' + CODE + '\n', CODE + '\r\n', '\r\n' + CODE, '', '   ', '\n\n',
    'plot(close) // a ``` in a line\nplot(open)', 'x = "```"\nplot(x)', 'a ``` b', 'text ```pine\ncode',
    '~~~pine\n' + CODE + '\n~~~', 'use `close` and ``open``', 'Intro\n``\nx', 'Intro\n`\nx',
    'plot(1) // ```\nplot(2)', 'Intro\n```pine //x ``` y',
  ];
  for (const s of same) assert.strictEqual(stripCodeFence(s), s, JSON.stringify(s));
});
test('C1c. three backticks in the MIDDLE of a line are left alone (PR)', () => {
  assert.strictEqual(stripCodeFence('plot(close) // a ``` in a line\nplot(open)'), 'plot(close) // a ``` in a line\nplot(open)');
});
test('C1d. backticks INSIDE closed-fence code: stops at the first closing fence (documented first-block rule)', () => {
  assert.equal(stripCodeFence('```pine\nx = "a`b"\ny = `z`\n```'), 'x = "a`b"\ny = `z`');
});
test('C1e. a fence info string with code on the SAME line: the line is the fence line (code on it is dropped), the lines below survive', () => {
  assert.equal(stripCodeFence('```pinescript //@version=6\nindicator("x")\n```'), 'indicator("x")');
  assert.equal(stripCodeFence('Intro\n```pinescript //@version=6\nindicator("x")'), 'indicator("x")');
});
test('C1f. the result never begins with a fence line when a fence existed (idempotent)', () => {
  for (const [, input] of rows) { const once = stripCodeFence(input); assert.equal(stripCodeFence(once), once, 'not idempotent: ' + JSON.stringify(input)); }
});

/* ===== C2 time bounds ===== */
const ms = (f: () => unknown) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };
test('C2. stripCodeFence finishes well under 1 s on 1 MB hostile inputs (no catastrophic backtracking)', () => {
  const MB = 1_000_000;
  const cases: [string, string][] = [
    ['1 MB of backticks', '`'.repeat(MB)],
    ['a`` x 333k', 'a``'.repeat(333_334)],
    ['a``` x 250k', 'a```'.repeat(250_000)],
    ['"```a\\n" x 200k (every line opens)', '```a\n'.repeat(200_000)],
    ['"\\n```" x 250k (every line a bare fence)', '\n```'.repeat(250_000)],
    ['"x\\n  ```p\\n" x 100k', 'x\n  ```p\n'.repeat(100_000)],
    ['1 MB of newlines', '\n'.repeat(MB)],
    ['"\\n" + 1 MB of spaces then x', '\n' + ' '.repeat(MB) + 'x'],
    ['"\\n" + 1 MB of tabs/spaces, no fence', '\n' + ' \t'.repeat(MB / 2)],
    ['prose + "```" + 1 MB of non-backtick, no newline', 'Intro\n```' + 'a'.repeat(MB)],
    ['"``` " x 200k on one line', '``` '.repeat(200_000)],
    ['open fence then 1 MB of code', 'Intro\n```pine\n' + 'plot(close)\n'.repeat(80_000)],
    ['closed fence then 1 MB of backtick-free text', '```a\n' + 'z'.repeat(MB)],
    ['CRLF x 300k', '\r\n'.repeat(300_000)],
  ];
  const slow: string[] = [];
  for (const [label, s] of cases) { const t = ms(() => stripCodeFence(s)); if (t > 1000) slow.push(`${label}: ${t.toFixed(0)} ms`); }
  assert.deepEqual(slow, []);
});

/* ===== C3 Pine route + strip ===== */
const PINE_BODY = ROUTES[0].body;
for (const [label, answer, expectCode] of [
  ['an open fence after prose with no code (lone fence at the end)', 'Here you go:\n```pinescript', null],
  ['a fence that wraps nothing', '```pinescript\n```', null],
  ['a bare fence only', '```', null],
  ['a fenced block of only whitespace', '```pine\n \n\t\n```', null],
  ['an open fence after prose WITH code', 'Here you go:\n```pinescript\n//@version=6\nindicator("x")', '//@version=6\nindicator("x")'],
  ['an open fence after prose with code, CRLF', 'Here you go:\r\n```pinescript\r\n//@version=6\r\nindicator("x")', '//@version=6\nindicator("x")'],
  ['a closed fence after prose', 'Here you go:\n```pinescript\n//@version=6\nindicator("x")\n```\nEnjoy.', '//@version=6\nindicator("x")'],
] as const) {
  test(`C3. pine-script route: ${label}`, async () => {
    xaiAnswer = () => chatOk(answer); const o = await run(ROUTES[0]);
    if (expectCode === null) {
      assert.equal(o.status, 502, o.text); assert.equal(o.b.code, 'AI_INCOMPLETE'); assert.equal(o.b.refunded, true); assert.equal(net.refunds.length, 1);
    } else {
      assert.equal(o.status, 200, o.text); assert.equal(o.b.code, expectCode); assert.equal(net.refunds.length, 0); assert.ok(!/```/.test(String(o.b.code)));
    }
  });
}
test('C3b. pine-script route: stripped to nothing AND the refund does not land -> refunded:false, "Try again." only', async () => {
  xaiAnswer = () => chatOk('Here you go:\n```pinescript'); refundMode = 'null'; const o = await run(ROUTES[0]);
  assert.equal(o.status, 502); assert.equal(o.b.refunded, false); assert.equal(o.b.error, 'The AI answer was incomplete. Try again.'); assert.equal(net.refunds.length, 1);
  void PINE_BODY;
});

/* ===== R8: the refund RPC answers the NEW COUNT, which is 0 when the day's only use is given back, and can be above 1: all of those are "landed" ===== */
for (const r of ROUTES) for (const v of [0, 1, 2, 7]) {
  test(`R8. ${r.name}: a landed refund answering the count ${v} -> refunded:true and "Nothing was charged" (only null means not landed)`, async () => {
    refundValue = v; xaiAnswer = () => chatOk(''); const o = await run(r);
    assert.strictEqual(o.b.refunded, true, o.text); assert.match(o.b.error ?? '', /Nothing was charged/); assert.equal(net.refunds.length, 1);
  });
}
