/* QA: PR #2661, the AI read's CHART_ANALYSIS and REASONING lines get a length cap in the prompt ("not an essay"): CHART_ANALYSIS one sentence, at most 15 words;
 * REASONING at most 3 short sentences, 45 words in total (was 1-2 and 3-4).
 *
 * THE REAL ROUTE RUNS (app/api/grok/route.ts POST, in-process) with the network stand-in of arenaReadLanguage.test.mts: xAI's request body is RECORDED and the answer is
 * chosen by the test; nothing leaves the machine, nothing is billed (a request to any other host throws and is counted in net.stray).
 *   C1  Quick and Deep (en and ko/zh/ru/ar): the request body carries the two cap lines EXACTLY ONCE each, with the numbers 15 / 3 / 45, and none of the old sentence counts
 *   C2  the constants, read back out of the served prompt: one place per cap; Quick and Deep carry the SAME caps (the PR sets one rule for both; they differ only in the
 *       token ceiling), and the token ceilings are the ones the route sends (800 Quick / 2000 Deep en; 2650 / 5000 translated)
 *   C3  the cap is a PROMPT instruction: an oversized stub answer (60-word chart line, 150-word reasoning) is answered 200, parsed whole and passed on unchanged (the PR says
 *       "the model may sometimes exceed a cap, which costs nothing"); the lengths are printed. Control: a short answer parses to the same fields
 *   C4  nothing else in the prompt moved: WHY line, levels, patterns and WAIT_FOR lines and the language block are still there once each; the new wording carries no forecast or advice
 *   C5  source: lib/grok.ts has no old sentence count left anywhere; buildPrompt's own REASONING line (sliced off before the combined prompt is served) says the same as the served one
 *   C6  (informational) instructions elsewhere in the same prompt that ask REASONING for more than 45 words can hold
 * WHAT THIS CANNOT PROVE: how long a real model's answer is (no paid call was made); that "words" is read the same way in ko / zh / ar. */
import test, { after, afterEach, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { marketStandIn } from './_marketStandIn.mts';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.GROK_API_KEY = 'placeholder-xai';
delete process.env.ANTHROPIC_API_KEY;
const UID = '77777777-7777-4777-8777-777777777777';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

type CombinedResult = import('../lib/grok.ts').CombinedResult;

/* an answer in the exact shape the prompt asks for; the two length-capped fields are the arguments */
const answer = (chart: string, reasoning: string) => [
  'SIGNAL: LEAN BULLISH', 'BIAS_LEAN: BULLISH', 'CONFIDENCE: 64',
  'COUNTED: bullish 2 (RSI, funding) | bearish 1 (OI)',
  'SIDES: EMA9 ABOVE | SMA200 ABOVE | VWAP BELOW',
  'WHY:', '- Funding is low, shorts pay', '- RSI rising from oversold', '- Open interest is falling',
  'RAID_SETUP: SHORT SQUEEZE', 'RAID_TARGET: $1.62', 'RAID_TRIGGER: Hold above 1.62',
  'LEVELS:', '- $0.90: Support at the moving average | support', '- $1.71: R1 | resistance',
  'CATALYSTS:', '- ETF inflow grew | Reuters | 2026-11-18 03:00 UTC',
  `CHART_ANALYSIS: ${chart}`, 'PATTERNS:', '- Higher highs / higher lows | BULLISH', '- NONE', 'WAIT_FOR: Watch $1.62 for a close above', `REASONING: ${reasoning}`,
].join('\n');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const SHORT_CHART = 'Price holds above the 9 EMA on rising volume.';
const SHORT_REASONING = 'Funding is low and shorts pay. RSI is recovering from oversold. Open interest is falling.';
const LONG_CHART = Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(' ') + '.';
const LONG_REASONING = Array.from({ length: 8 }, (_, s) => `Sentence ${s + 1} ` + Array.from({ length: 17 }, (_, i) => `w${s}x${i}`).join(' ') + '.').join(' ');

type XaiCall = { path: string; raw: string; prompt: string; cap: unknown };
const net = { xai: [] as XaiCall[], stray: [] as string[], market: [] as string[], increments: 0, refunds: 0, answers: [] as string[], logs: [] as string[] };
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
const nowS = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
const pl = b64u(JSON.stringify({ sub: UID, email: 'qa@example.test', aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: nowS, exp: nowS + 600 }));
const TOK = `${h}.${pl}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${pl}`)))}`;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') {
    const raw = await req.text();
    let prompt = ''; let cap: unknown = null;
    try { const b = JSON.parse(raw); const m = (b.messages ?? b.input ?? []) as Array<{ role?: string; content?: unknown }>; prompt = String(m.find((x) => x.role === 'user')?.content ?? ''); cap = b.max_tokens ?? b.max_output_tokens ?? null; } catch { /* leave empty */ }
    net.xai.push({ path: url.pathname, raw, prompt, cap });
    const text = net.answers.length ? net.answers.shift()! : answer(SHORT_CHART, SHORT_REASONING);
    return json(200, url.pathname === '/v1/responses'
      ? { model: 'grok-4.3', output: [{ type: 'message', content: [{ text, annotations: [] }] }], citations: [] }
      : { model: 'grok-4.3', choices: [{ message: { content: text } }] });
  }
  { const answered = marketStandIn(req, url, { seen: (hp) => net.market.push(hp) }); if (answered) return answered; }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.url}`); }
  const p = url.pathname;
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') { net.increments++; return json(200, 1); }
  if (p === '/rest/v1/rpc/refund_ai_usage') { net.refunds++; return json(200, 0); }
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) return one({ role: 'pro', trial_ends_at: null, current_period_end: null });
  if (p.endsWith('labels')) return json(200, [], { 'content-range': '*/0' });
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const standInFetch = globalThis.fetch;

const { __labelsTestSeam } = await import('../lib/labelsServer.ts');
const origLog = console.log, origWarn = console.warn, origErr = console.error;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run would reach the real network');
  net.xai = []; net.stray = []; net.market = []; net.increments = 0; net.refunds = 0; net.answers = []; net.logs = [];
  __labelsTestSeam();
  const grab = (...a: unknown[]) => { net.logs.push(a.map(String).join(' ')); };
  console.log = grab; console.warn = grab; console.error = grab;
});
const { grokBody, contextFor } = await import('./_grokBody.mts');
const { POST } = await import('../app/api/grok/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
afterEach(() => { console.log = origLog; console.warn = origWarn; console.error = origErr; _resetApiHealthQueue(); });

async function post(opts: { type: 'quick' | 'deep'; locale?: string; answer?: string[] }) {
  net.xai = []; net.increments = 0; net.refunds = 0; net.answers = opts.answer ? [...opts.answer] : [];
  const body: Record<string, unknown> = grokBody({ type: opts.type, coin: 'xrp', tf: '1h', override: { context: { ...contextFor('XRP/USDT'), clusters: 'Not available' } } });
  if (opts.locale) body.locale = opts.locale;
  const r = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as { result?: CombinedResult; code?: string; error?: string }, prompt: net.xai[0]?.prompt ?? '', cap: net.xai[0]?.cap, path: net.xai[0]?.path ?? '' };
}
const count = (s: string, sub: string) => s.split(sub).length - 1;
const CHART_LINE = /^CHART_ANALYSIS: \[ONE sentence, at most (\d+) words, on candles and indicators only - no mention of macro here\]$/gm;
const REASON_LINE = /^REASONING: \[At most (\d+) short sentences, (\d+) words in total, /gm;
const OLD = [/1-2 sentences/i, /2-4 sentence/i, /3-4 sentences/i, /\b[1-4]-[1-4] sentences?\b/i];

const MODES = [['quick', 'en'], ['deep', 'en'], ['quick', 'ko'], ['deep', 'zh'], ['quick', 'ru'], ['deep', 'ar']] as const;

for (const [type, locale] of MODES) {
  test(`C1. ${type} / ${locale}: the request carries each cap line exactly once with 15 / 3 / 45, and no old sentence count`, async () => {
    const r = await post({ type, locale: locale === 'en' ? undefined : locale });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); assert.equal(net.xai.length, 1); assert.deepEqual(net.stray, []);
    assert.ok(r.prompt.length > 5000, `recorded prompt is ${r.prompt.length} chars: the recorder is not seeing the prompt`);
    assert.equal(r.path, type === 'deep' ? '/v1/responses' : '/v1/chat/completions', 'the stand-in saw the wrong endpoint for this mode');
    const chart = [...r.prompt.matchAll(CHART_LINE)]; const reas = [...r.prompt.matchAll(REASON_LINE)];
    assert.equal(chart.length, 1, `CHART_ANALYSIS cap line appears ${chart.length} times`);
    assert.equal(reas.length, 1, `REASONING cap line appears ${reas.length} times (the combined prompt must not carry two REASONING specs)`);
    assert.equal(Number(chart[0][1]), 15); assert.equal(Number(reas[0][1]), 3); assert.equal(Number(reas[0][2]), 45);
    for (const re of OLD) assert.doesNotMatch(r.prompt, re, `old sentence count still in the prompt: ${re}`);
    assert.equal(count(r.prompt, 'CHART_ANALYSIS: ['), 1); assert.equal(count(r.prompt, 'REASONING: ['), 1);
    assert.equal(count(r.prompt, 'short sentences, 45 words in total'), 1, 'the REASONING cap is stated more than once in the served prompt (a second REASONING spec from buildPrompt leaked in)');
  });
}

test('C2. the caps are one rule for Quick and Deep (read back from the served prompts); only the token ceiling differs, and it is the one the route sends', async () => {
  const q = await post({ type: 'quick' }); const d = await post({ type: 'deep' });
  const lines = (p: string) => [...p.matchAll(/^(CHART_ANALYSIS|REASONING): \[.*$/gm)].map((m) => m[0]);
  assert.deepEqual(lines(q.prompt), lines(d.prompt), 'Quick and Deep carry different CHART_ANALYSIS / REASONING lines');
  assert.equal(lines(q.prompt).length, 2);
  assert.equal(q.cap, 800, 'Quick English token ceiling'); assert.equal(d.cap, 2000, 'Deep English token ceiling');
  const qt = await post({ type: 'quick', locale: 'ru' }); const dt = await post({ type: 'deep', locale: 'ru' });
  assert.equal(qt.cap, 2650); assert.equal(dt.cap, 5000);
  origLog(`[AI-CAPS] CHART_ANALYSIS <= 15 words, REASONING <= 3 sentences / 45 words in BOTH Quick and Deep; token ceilings en ${q.cap}/${d.cap}, translated ${qt.cap}/${dt.cap}`);
});

for (const type of ['quick', 'deep'] as const) {
  test(`C3. ${type}: the cap is an instruction, not a filter: an oversized stub answer is parsed whole and passed on (lengths printed); a short answer is the control`, async () => {
    const ok = await post({ type, answer: [answer(SHORT_CHART, SHORT_REASONING)] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.equal(words(ok.body.result!.chartAnalysis), words(SHORT_CHART), 'control: the short chart line did not come through as sent');
    assert.ok(words(ok.body.result!.reasoning) >= words(SHORT_REASONING), 'control: the short reasoning did not come through');
    const big = await post({ type, answer: [answer(LONG_CHART, LONG_REASONING)] });
    assert.equal(big.status, 200, JSON.stringify(big.body).slice(0, 200));
    assert.equal(net.increments, 1, 'one read is one usage increment'); assert.equal(net.refunds, 0); assert.deepEqual(net.stray, []);
    const r = big.body.result!;
    origLog(`[AI-CAPS-OVERSIZED ${type}] stub chart ${words(LONG_CHART)} words -> returned ${words(r.chartAnalysis)}; stub reasoning ${words(LONG_REASONING)} words / 8 sentences -> returned ${words(r.reasoning)} words (the route does not trim)`);
    assert.ok(words(r.chartAnalysis) > 0 && words(r.reasoning) > 0, 'the oversized answer was dropped');
  });
}

test('C4. nothing else in the prompt moved: WHY, levels, patterns, WAIT_FOR and the language block are there once each; the new wording carries no forecast or advice', async () => {
  const r = await post({ type: 'deep', locale: 'ko' });
  for (const [needle, label] of [['WHY: [UP TO 3 lines', 'WHY line'], ['LEVELS:\n- [price]: [label] | [support or resistance]', 'levels block'], ['PATTERNS:\n- [identify chart patterns', 'patterns block'], ['WAIT_FOR: [REQUIRED when SIGNAL is FLAT', 'WAIT_FOR line'], ['=== LANGUAGE: KOREAN (ko) ===', 'language block']] as const) {
    assert.equal(count(r.prompt, needle), 1, `${label}: expected exactly one occurrence`);
  }
  const newLines = [...r.prompt.matchAll(/^(CHART_ANALYSIS|REASONING): \[.*$/gm)].map((m) => m[0]);
  assert.equal(newLines.length, 2);
  const BANNED = /\bwait for\b|\bstay out\b|\breduce size\b|\bmay push\b|\btends? to\b|\bpump\b|\bdump\b|\bmagnet\b|\bwill (?:rise|fall|drop|pump|dump)\b|\btrade now\b/i;
  for (const l of newLines.map((x) => x.replace(/If FLAT, state whether.*$/, ''))) assert.doesNotMatch(l, BANNED, l);
  assert.doesNotMatch(r.prompt, /\b(grok|xai|openai|chatgpt|claude|anthropic|gemini)\b/i, 'a prompt that names the vendor');
});

test('C5. source: no old sentence count left in lib/grok.ts; buildPrompt\'s own REASONING line says the same as the served one', () => {
  const src = read('lib/grok.ts');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  for (const re of OLD) assert.doesNotMatch(code, re, `old sentence count in lib/grok.ts: ${re}`);
  const served = [...src.matchAll(/REASONING: \[At most (\d+) short sentences, (\d+) words in total/g)].map((m) => `${m[1]}/${m[2]}`);
  const quickLine = /'\[At most (\d+) short sentences, (\d+) words in total, citing/.exec(src);
  assert.ok(quickLine, "buildPrompt's REASONING line is not in the new shape");
  assert.deepEqual(served, [`${quickLine![1]}/${quickLine![2]}`], 'the combined prompt and buildPrompt must carry the same REASONING cap');
  assert.equal(count(src, 'CHART_ANALYSIS: [ONE sentence, at most 15 words'), 1, 'one CHART_ANALYSIS cap in the source');
  /* RE-PINNED for #2721 (2026-11-20): the WAIT_FOR line now carries its own 15-word cap, so the phrase is in the source exactly twice: the CHART_ANALYSIS cap and the WAIT_FOR cap (waitForOneLine2721 pins the second) */
  assert.equal(count(src, 'at most 15 words'), 2, 'the CHART_ANALYSIS cap and the WAIT_FOR cap are the only two 15-word caps in the source');
  /* the combined prompt slices buildPrompt off at its output-format section, so that line is not served: say so in the test, not only in the report */
  assert.match(src, /const splitAt = base\.indexOf\('Output in EXACTLY this format'\);\s*const body = splitAt > -1 \? base\.slice\(0, splitAt\) : base;/);
});

test('C6. informational: other instructions in the served prompt that can ask REASONING for more than the cap allows', async () => {
  const r = await post({ type: 'quick' });
  const hits = [...r.prompt.matchAll(/^.*(?:REASONING must|REASONING, the first sentence).*$/gm)].map((m) => m[0].slice(0, 200));
  origLog(`[AI-CAPS-CONFLICT] ${hits.length} instruction(s) in the Quick prompt direct what REASONING must contain: ${JSON.stringify(hits)}`);
  assert.ok(hits.length >= 1, 'control: the LEAN / FLAT REASONING instruction was not found');
});
