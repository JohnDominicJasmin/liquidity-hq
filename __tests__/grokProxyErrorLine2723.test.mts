/* A failed AI read names its route and status in the console (PR #2723, #1651).
 *
 * THE RULE (written by the PR owner, and every expectation below is written from it, never copied from the code's output):
 *   - On a 5xx answer from POST /api/grok the CLIENT writes exactly ONE console.error line:
 *         [read] POST /api/grok <status> <quick|deep> <CODE|none>
 *   - CODE is the JSON body's error code only if it matches /^[A-Z_]{1,32}$/, otherwise the word `none`.
 *   - The line carries the PATH only: no query string, token, header, request body or user data.
 *   - The thrown error also carries `status`.
 *   - A non-5xx answer (400, 403, 429, ...) writes nothing, and so does a 200.
 *
 * WHAT RUNS. `callGrokViaProxy` is imported and run for real. Only `fetch` is a stub (it answers a fixed status and body
 * and records what was sent) and `console` is a recorder. The auth token is a REAL session put into the supabase client,
 * so the Authorization header the function builds contains a fake token whose absence from the line is then checkable.
 * CONTROL T1 proves that header was actually sent; without it "the token is not in the line" would be vacuously true.
 *
 * MUTATIONS, each MEASURED on the PR head (the scratch-copy runner turns each red; restored run is 68/68 green):
 *   M1  log on every non-ok answer (>= 400)             -> every N-<mode>-4xx cell, N-499-599
 *   M2  the line written twice                          -> O1, O2, O3, O4 and every exact-line cell
 *   M3  a query string in the path                      -> S1, S3, S4 and every exact-line cell
 *   M4  the token appended to the line                  -> S1, S2, S3 and every exact-line cell
 *   M5  any code accepted (regex check dropped)         -> C-invalid-1..10, 16..20, O4, S3
 *   M6  `status` dropped from the thrown error          -> E1, E2, E3
 *   M7  the mode tag always `quick`                     -> L3, S1 and every deep exact-line cell
 *   M8  the error object passed as a 2nd argument       -> O2, O3, S2
 *   M9  the regex loses its end anchor                  -> C-invalid-2..9, 17, 20, O4, S3
 *   M10 `> 500` instead of `>= 500`                     -> L1, L1-500, L6, O1, S1
 *   M11 regex limit 64 instead of 32                    -> C-invalid-3
 *   M12 regex case-insensitive                          -> C-invalid-1, 2, 20
 *   M13 the Authorization header named in the line      -> S1, S3 and every exact-line cell
 *   M14 the request body passed as a 2nd argument       -> O2, O3
 *   M15 typeof guard dropped (a number is stringified)  -> C-invalid-14 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';

const { callGrokViaProxy } = await import('../lib/grok.ts');
const { getSupabase } = await import('../lib/supabase.ts');

/* ══ A REAL SESSION WITH A FAKE TOKEN ══════════════════════════════════════════════════════════════════
 * getAuthToken() reads the supabase client's session. An unexpired, unsigned JWT is accepted by setSession without a
 * network call, so callGrokViaProxy builds `Authorization: Bearer <FAKE_TOKEN>` exactly as in the browser. */
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_SIG = 'SIGMARKERq7Zk2xW9a';
const FAKE_TOKEN = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'user-uuid-4f3a', email: 'trader.fake@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.${FAKE_SIG}`;
const sb = getSupabase();
assert.ok(sb, 'the supabase client was not created - the env stand-ins above must be set before the import');
/* setSession verifies the user once; that one call is answered by a stand-in so nothing leaves the machine. */
const fetchBeforeSeed = globalThis.fetch;
globalThis.fetch = (async () => Response.json({ id: 'user-uuid-4f3a', aud: 'authenticated', role: 'authenticated', email: 'trader.fake@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' })) as typeof fetch;
const set = await sb.auth.setSession({ access_token: FAKE_TOKEN, refresh_token: 'refresh-fake-xyz' }).finally(() => { globalThis.fetch = fetchBeforeSeed; });
assert.equal(set.error, null, `could not seed the fake session: ${set.error?.message}`);

/* ══ THE CALL, WITH IDENTIFIABLE REQUEST DATA ══════════════════════════════════════════════════════════ */
const CTX_MARK = 'CTXSESSIONMARK_77aa';
const SEL_MARK = 'SELECTIONMARK_88bb';
const STRAT_MARK = 'STRATEGYMARK_99cc';
const CTX = { coin: 'btc', session: CTX_MARK, tf: '1h', email: 'owner.private@example.test' };
const CHART = { tf: '1h' };
const REQUEST_MARKS = [CTX_MARK, SEL_MARK, STRAT_MARK, 'owner.private', 'user-uuid-4f3a', FAKE_TOKEN, FAKE_SIG, 'refresh-fake-xyz'];

type Mode = 'quick' | 'deep';
type ThrownErr = Error & { code?: unknown; status?: unknown; refunded?: unknown; usage?: unknown };

interface Run {
  threw: ThrownErr | null;
  resolved: unknown;
  errorLines: unknown[][];
  otherLines: { channel: string; args: unknown[] }[];
  sent: { url: string; headers: Record<string, string>; body: string } | null;
  fetchCalls: number;
}

/* Runs one real call. `raw` is the exact response body text; null means an empty body. */
async function run(mode: Mode, status: number, raw: string | null, contentType = 'application/json'): Promise<Run> {
  const realFetch = globalThis.fetch;
  const saved = { error: console.error, warn: console.warn, log: console.log, info: console.info, debug: console.debug };
  const out: Run = { threw: null, resolved: undefined, errorLines: [], otherLines: [], sent: null, fetchCalls: 0 };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    out.fetchCalls++;
    const h = (init?.headers ?? {}) as Record<string, string>;
    out.sent = { url: String(input), headers: { ...h }, body: String(init?.body ?? '') };
    return new Response(raw, { status, headers: contentType ? { 'content-type': contentType } : {} });
  }) as typeof fetch;
  console.error = (...a: unknown[]) => { out.errorLines.push(a); };
  for (const ch of ['warn', 'log', 'info', 'debug'] as const) console[ch] = (...a: unknown[]) => { out.otherLines.push({ channel: ch, args: a }); };
  try {
    out.resolved = await callGrokViaProxy(CTX as never, CHART as never, mode, [SEL_MARK], 'en', STRAT_MARK);
  } catch (e) {
    out.threw = e as ThrownErr;
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, saved);
  }
  return out;
}

const json = (o: unknown) => JSON.stringify(o);
const lineOf = (r: Run) => String(r.errorLines[0]?.[0]);
const MODES: Mode[] = ['quick', 'deep'];
const SERVER_STATUSES = [500, 502, 503, 504];

/* The result a real 200 carries, for the control (the proxy boundary refuses an answer with no real signal, #1583). */
const OK_RESULT = { signal: 'FLAT', confidence: 40, levels: [], chartAnalysis: '', patterns: [], reasoning: '', catalysts: [], waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: 1, tf: '1h', session: 'london' };

/* ══ T. CONTROLS ═════════════════════════════════════════════════════════════════════════════════════ */

test('T1. CONTROL: the call posts to /api/grok with the fake token in Authorization and the marked request body, so the absence cells below can fail', async () => {
  const r = await run('deep', 502, json({ error: 'x', code: 'BAD_ANSWER' }));
  assert.equal(r.fetchCalls, 1);
  assert.ok(r.sent);
  assert.equal(r.sent.url, '/api/grok');
  assert.equal(r.sent.headers.Authorization, `Bearer ${FAKE_TOKEN}`, 'the fake session did not reach the Authorization header; the token-absence cells would be vacuous');
  for (const m of [CTX_MARK, SEL_MARK, STRAT_MARK, 'owner.private@example.test']) {
    assert.ok(r.sent.body.includes(m), `the request body does not carry ${m}; the body-absence cells would be vacuous`);
  }
});

test('T2. CONTROL: a 200 resolves with the result and writes nothing to any console channel', async () => {
  const r = await run('quick', 200, json({ result: OK_RESULT, usage: null }));
  assert.equal(r.threw, null, `a 200 threw: ${r.threw?.message}`);
  assert.ok(r.resolved);
  assert.deepEqual(r.errorLines, []);
  assert.deepEqual(r.otherLines, []);
});

test('T3. CONTROL: the recorder sees a console.error (it is what the cells below read)', () => {
  const saved = console.error;
  const seen: unknown[][] = [];
  console.error = (...a: unknown[]) => { seen.push(a); };
  try { console.error('probe'); } finally { console.error = saved; }
  assert.deepEqual(seen, [['probe']]);
});

/* ══ L. THE LINE, EXACT ══════════════════════════════════════════════════════════════════════════════ */

test('L1. a JSON 5xx with code BAD_ANSWER writes exactly the owner\'s example line, for 500/502/503/504 (deep)', async () => {
  const want: Record<number, string> = {
    500: '[read] POST /api/grok 500 deep BAD_ANSWER',
    502: '[read] POST /api/grok 502 deep BAD_ANSWER',
    503: '[read] POST /api/grok 503 deep BAD_ANSWER',
    504: '[read] POST /api/grok 504 deep BAD_ANSWER',
  };
  for (const s of SERVER_STATUSES) {
    const r = await run('deep', s, json({ error: 'The AI answer did not give a clear verdict.', code: 'BAD_ANSWER', refunded: true, usage: null }));
    assert.equal(r.errorLines.length, 1, `status ${s}: ${r.errorLines.length} console.error calls, expected 1`);
    assert.equal(lineOf(r), want[s], `status ${s}`);
  }
});

for (const s of SERVER_STATUSES) {
  test(`L1-${s}. status ${s} writes one line carrying ${s}`, async () => {
    const r = await run('deep', s, json({ code: 'BAD_ANSWER' }));
    assert.equal(r.errorLines.length, 1);
    assert.equal(lineOf(r), `[read] POST /api/grok ${s} deep BAD_ANSWER`);
  });
}

test('L2. the quick read is tagged quick', async () => {
  const r = await run('quick', 502, json({ error: 'x', code: 'BAD_ANSWER' }));
  assert.equal(r.errorLines.length, 1);
  assert.equal(lineOf(r), '[read] POST /api/grok 502 quick BAD_ANSWER');
});

test('L3. the deep read is tagged deep, and the two tags are not interchangeable', async () => {
  const q = await run('quick', 503, json({ code: 'PLAN_UNKNOWN' }));
  const d = await run('deep', 503, json({ code: 'PLAN_UNKNOWN' }));
  assert.equal(lineOf(q), '[read] POST /api/grok 503 quick PLAN_UNKNOWN');
  assert.equal(lineOf(d), '[read] POST /api/grok 503 deep PLAN_UNKNOWN');
});

test('L4. an HTML body (a proxy error page) gives code none, for both modes', async () => {
  const html = '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>trader@example.com?x=1</p></body></html>';
  const d = await run('deep', 502, html, 'text/html');
  assert.equal(d.errorLines.length, 1);
  assert.equal(lineOf(d), '[read] POST /api/grok 502 deep none');
  const q = await run('quick', 502, html, 'text/html');
  assert.equal(q.errorLines.length, 1);
  assert.equal(lineOf(q), '[read] POST /api/grok 502 quick none');
});

test('L5. an empty body gives code none', async () => {
  const r = await run('deep', 504, null, '');
  assert.equal(r.errorLines.length, 1);
  assert.equal(lineOf(r), '[read] POST /api/grok 504 deep none');
});

test('L6. a JSON body with no code field gives none', async () => {
  const r = await run('quick', 500, json({ error: 'Internal error' }));
  assert.equal(r.errorLines.length, 1);
  assert.equal(lineOf(r), '[read] POST /api/grok 500 quick none');
});

for (const code of ['BAD_ANSWER', 'FEATURE_DISABLED', 'PLAN_UNKNOWN', 'UNAVAILABLE', 'X', '_', 'A'.repeat(32)]) {
  test(`C-valid-${code.length > 20 ? 'A x32' : code}. code ${code.length > 20 ? 'of 32 capital letters (the longest allowed)' : code} is written as it is`, async () => {
    const r = await run('deep', 502, json({ error: 'e', code }));
    assert.equal(r.errorLines.length, 1);
    assert.equal(lineOf(r), `[read] POST /api/grok 502 deep ${code}`);
  });
}

/* Anything that is not a closed upper-case word becomes `none`. Each cell is a different way to fail the rule. */
const INVALID: [string, unknown][] = [
  ['lowercase', 'bad_answer'],
  ['mixed case', 'Bad_Answer'],
  ['33 letters (one over the limit)', 'A'.repeat(33)],
  ['a 200-letter value', 'A'.repeat(200)],
  ['contains a digit', 'ERR_502'],
  ['contains a hyphen', 'BAD-ANSWER'],
  ['contains a space', 'BAD ANSWER'],
  ['a valid word then a newline (log injection)', 'BAD_ANSWER\n[read] POST /api/grok 200 deep FORGED'],
  ['a trailing newline only', 'BAD_ANSWER\n'],
  ['empty string', ''],
  ['a number', 502],
  ['null', null],
  ['an object', { x: 'BAD_ANSWER' }],
  ['an array of strings', ['BAD_ANSWER']],
  ['a boolean', true],
  ['an email address', 'trader@example.com'],
  ['a query string', 'BAD?x=1'],
  ['the bearer token itself', FAKE_TOKEN],
  ['a lowercase jwt-looking word', 'eyJhbGciOiJIUzI1NiJ9'],
  ['an upper-case word followed by lowercase', 'BAD_ANSWERx'],
];
INVALID.forEach(([name, code], i) => {
  test(`C-invalid-${i + 1}. code that is ${name} gives none`, async () => {
    const r = await run('deep', 502, json({ error: 'e', code }));
    assert.equal(r.errorLines.length, 1, 'a 5xx still writes its one line');
    assert.equal(lineOf(r), '[read] POST /api/grok 502 deep none');
  });
});

/* ══ N. NOTHING ══════════════════════════════════════════════════════════════════════════════════════ */

const NON_5XX: [number, unknown][] = [
  [400, { error: 'Invalid request.' }],
  [401, { error: 'Sign in.' }],
  [403, { error: 'PRO_REQUIRED', message: 'Fast timeframes are part of Pro.' }],
  [403, { error: 'Forbidden', code: 'COIN_LOCKED' }],
  [404, { error: 'Not found' }],
  [429, { error: 'Rate limit reached.', code: 'RATE_LIMIT' }],
  [499, { error: 'Client closed', code: 'BAD_ANSWER' }],
];
for (const mode of MODES) {
  NON_5XX.forEach(([status, body], i) => {
    test(`N-${mode}-${status}-${i + 1}. a ${status} (${mode}) writes nothing to any console channel and still throws`, async () => {
      const r = await run(mode, status, json(body));
      assert.deepEqual(r.errorLines, [], `a ${status} wrote console.error: ${JSON.stringify(r.errorLines)}`);
      assert.deepEqual(r.otherLines, []);
      assert.ok(r.threw, `a ${status} did not throw`);
    });
  });
}

test('N-200. a 200 writes nothing (both modes)', async () => {
  for (const mode of MODES) {
    const r = await run(mode, 200, json({ result: OK_RESULT, usage: null }));
    assert.deepEqual(r.errorLines, []);
    assert.deepEqual(r.otherLines, []);
  }
});

test('N-499-599. the boundary: 499 writes nothing, 599 is a 5xx and writes its line', async () => {
  const a = await run('deep', 499, json({ code: 'BAD_ANSWER' }));
  assert.deepEqual(a.errorLines, []);
  const b = await run('deep', 599, json({ code: 'BAD_ANSWER' }));
  assert.equal(b.errorLines.length, 1);
  assert.equal(lineOf(b), '[read] POST /api/grok 599 deep BAD_ANSWER');
});

/* ══ O. ONE LINE ═════════════════════════════════════════════════════════════════════════════════════ */

test('O1. exactly ONE console.error call per failed call, over every 5xx status, mode and body kind', async () => {
  const bodies: [string, string | null, string][] = [
    ['json code', json({ error: 'e', code: 'BAD_ANSWER' }), 'application/json'],
    ['json no code', json({ error: 'e' }), 'application/json'],
    ['html', '<h1>Bad gateway</h1>', 'text/html'],
    ['empty', null, ''],
  ];
  for (const mode of MODES) for (const s of SERVER_STATUSES) for (const [name, raw, ct] of bodies) {
    const r = await run(mode, s, raw, ct);
    assert.equal(r.errorLines.length, 1, `${mode} ${s} ${name}: ${r.errorLines.length} console.error calls`);
    assert.deepEqual(r.otherLines, [], `${mode} ${s} ${name}: wrote to another console channel`);
  }
});

test('O2. two failed calls write two lines, one each (no state carried between calls)', async () => {
  const saved = console.error;
  const seen: unknown[][] = [];
  const realFetch = globalThis.fetch;
  console.error = (...a: unknown[]) => { seen.push(a); };
  globalThis.fetch = (async () => new Response(json({ code: 'BAD_ANSWER' }), { status: 502 })) as typeof fetch;
  try {
    for (let i = 0; i < 2; i++) await callGrokViaProxy(CTX as never, CHART as never, 'deep', [], 'en', null).catch(() => undefined);
  } finally { console.error = saved; globalThis.fetch = realFetch; }
  assert.equal(seen.length, 2);
  assert.deepEqual(seen, [['[read] POST /api/grok 502 deep BAD_ANSWER'], ['[read] POST /api/grok 502 deep BAD_ANSWER']]);
});

test('O3. the call has a single argument, one string: no error object, body or header rides along as a second argument', async () => {
  const r = await run('deep', 502, json({ error: 'e', code: 'BAD_ANSWER', usage: { deep_used: 1 } }));
  assert.equal(r.errorLines.length, 1);
  assert.equal(r.errorLines[0].length, 1, `console.error got ${r.errorLines[0].length} arguments`);
  assert.equal(typeof r.errorLines[0][0], 'string');
});

test('O4. the line is a single physical line', async () => {
  const r = await run('deep', 502, json({ error: 'e\nsecond', code: 'BAD_ANSWER\nFORGED' }));
  assert.equal(r.errorLines.length, 1);
  assert.ok(!/[\r\n]/.test(lineOf(r)), 'the line contains a line break');
});

/* ══ S. NOTHING PRIVATE IN THE LINE ═════════════════════════════════════════════════════════════════ */

/* The server answers with every private-looking thing it could echo: the token, an email, a query string. The line must not carry any. */
const HOSTILE_BODY = json({
  error: `see https://example.test/a?token=${FAKE_TOKEN} for trader@example.com with Authorization: Bearer ${FAKE_TOKEN}`,
  code: 'BAD_ANSWER',
  message: `Bearer ${FAKE_TOKEN} ${CTX_MARK} ${SEL_MARK} ${STRAT_MARK}`,
  usage: { email: 'owner.private@example.test' },
});

function assertClean(line: string, label: string) {
  assert.ok(!line.includes('?'), `${label}: line has a '?': ${line}`);
  assert.ok(!line.includes('Bearer'), `${label}: line has 'Bearer': ${line}`);
  assert.ok(!line.includes('eyJ'), `${label}: line has 'eyJ': ${line}`);
  assert.ok(!line.includes('@'), `${label}: line has '@': ${line}`);
  for (const m of REQUEST_MARKS) assert.ok(!line.includes(m), `${label}: line carries request/token data ${m}: ${line}`);
  assert.ok(!/authorization/i.test(line), `${label}: line names the Authorization header: ${line}`);
}

test('S1. with the token, an email, a query string and the request body all available, the line carries none of them', async () => {
  for (const mode of MODES) for (const s of SERVER_STATUSES) {
    const r = await run(mode, s, HOSTILE_BODY);
    assert.equal(r.errorLines.length, 1);
    assertClean(lineOf(r), `${mode} ${s}`);
    assert.equal(lineOf(r), `[read] POST /api/grok ${s} ${mode} BAD_ANSWER`);
  }
});

test('S2. the fake token and its signature appear in no console channel and no argument at all', async () => {
  const r = await run('deep', 502, HOSTILE_BODY);
  const everything = JSON.stringify([r.errorLines, r.otherLines]);
  assert.ok(!everything.includes(FAKE_SIG));
  assert.ok(!everything.includes(FAKE_TOKEN));
  assert.ok(!everything.includes('Bearer'));
});

test('S3. the line is the whole fixed shape and nothing else, whatever the body', async () => {
  const shape = /^\[read\] POST \/api\/grok [0-9]{3} (quick|deep) ([A-Z_]{1,32}|none)$/;
  const bodies: [string | null, string][] = [
    [HOSTILE_BODY, 'application/json'],
    ['<html>?a=b trader@example.com</html>', 'text/html'],
    [null, ''],
    [json({ code: FAKE_TOKEN }), 'application/json'],
    [json({ code: 'BAD?x=1' }), 'application/json'],
  ];
  for (const mode of MODES) for (const [raw, ct] of bodies) {
    const r = await run(mode, 502, raw, ct);
    assert.equal(r.errorLines.length, 1);
    assert.match(lineOf(r), shape);
  }
});

test('S4. the path is the bare path /api/grok: it is followed by a space and the status, never by ? or #', async () => {
  const r = await run('deep', 502, json({ code: 'BAD_ANSWER' }));
  assert.ok(lineOf(r).startsWith('[read] POST /api/grok 502 '), lineOf(r));
});

/* ══ E. THE THROWN ERROR ═════════════════════════════════════════════════════════════════════════════ */

test('E1. the thrown error carries the numeric status for 500/502/503/504, both modes', async () => {
  for (const mode of MODES) for (const s of SERVER_STATUSES) {
    const r = await run(mode, s, json({ error: 'The AI read failed.', code: 'BAD_ANSWER' }));
    assert.ok(r.threw, `${mode} ${s} did not throw`);
    assert.equal(r.threw.status, s, `${mode} ${s}: error.status is ${String(r.threw.status)}`);
  }
});

test('E2. the status is there for an HTML body and an empty body as well, so a proxy page is still identified', async () => {
  const h = await run('deep', 502, '<h1>Bad gateway</h1>', 'text/html');
  assert.equal(h.threw?.status, 502);
  const e = await run('quick', 504, null, '');
  assert.equal(e.threw?.status, 504);
});

test('E3. the thrown error still carries the server sentence, the code and the refund flag (the status is added, nothing replaced)', async () => {
  const usage = { deep_used: 2, deep_limit: 5 };
  const r = await run('deep', 502, json({ error: 'The AI read came back empty.', code: 'BAD_ANSWER', refunded: true, usage }));
  assert.ok(r.threw);
  assert.equal(r.threw.message, 'The AI read came back empty.');
  assert.equal(r.threw.code, 'BAD_ANSWER');
  assert.equal(r.threw.refunded, true);
  assert.deepEqual(r.threw.usage, usage);
  assert.equal(r.threw.status, 502);
});

test('E4. an empty-body 5xx still shows the generic sentence and no vendor name', async () => {
  const r = await run('deep', 502, null, '');
  assert.ok(r.threw);
  assert.equal(r.threw.message, 'The AI read failed. Try again.');
});
