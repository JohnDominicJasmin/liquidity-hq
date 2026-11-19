/* #1651 L128 (#2614): TWO READS OF ONE COIN AND TIMEFRAME QUOTE THE SAME LEVELS. PM, 2026-11-19: two BTC reads three minutes apart said "cancels above $64,800" and "$65,500", with taker thresholds of 55% and 60%.
 * THE REAL ROUTE RUNS (app/api/grok/route.ts POST, in-process; the harness is arenaReadLanguage's): Supabase, the market feeds and xAI are stand-ins, the model's request body is RECORDED and its answer is chosen by the test. Nothing leaves the machine and nothing is billed.
 *   F1 a Quick and a Deep read of the same coin and timeframe carry the FIXED WATCH LEVELS block, and the three numbers and the threshold are identical in both
 *   F2 two reads a minute apart inside one candle are identical (nothing live in the levels); the block says the model must quote them
 *   F3 the numbers in the block are the chart's own nearest levels to the last close of the stand-in candles (oracle: QA's copy of the S/R computation), above > close > below, and the threshold is 60%
 * Expected values are literals or QA's fixtures, not output of the code under test. */
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
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

type CombinedResult = import('../lib/grok.ts').CombinedResult;
type Notes = import('../lib/grok.ts').ReadNotes;

/* ── the answers ───────────────────────────────────────────────────────────── */

/* English field names, enums and direction tags; free text in the user's language: exactly what the language block asks the model for. */
const answerIn = (t: { why: [string, string, string]; level: string; trig: string; claim: string; src: string; chart: string; pat: string; reasoning: string }) => [
  'SIGNAL: LEAN BULLISH', 'BIAS_LEAN: BULLISH', 'CONFIDENCE: 64',
  'COUNTED: bullish 2 (RSI, funding) | bearish 1 (OI)',
  'SIDES: EMA9 ABOVE | SMA200 ABOVE | VWAP BELOW',
  'WHY:', `- ${t.why[0]}`, `- ${t.why[1]}`, `- ${t.why[2]}`,
  'RAID_SETUP: SHORT SQUEEZE', 'RAID_TARGET: $1.62', `RAID_TRIGGER: ${t.trig}`,
  'LEVELS:', `- $0.90: ${t.level} | support`, '- $1.71: R1 | resistance',
  'CATALYSTS:', `- ${t.claim} | ${t.src} | 2026-11-18 03:00 UTC`,
  `CHART_ANALYSIS: ${t.chart}`, 'PATTERNS:', `- ${t.pat} | BULLISH`, '- NONE', 'WAIT_FOR: NONE', `REASONING: ${t.reasoning}`,
].join('\n');
const LANG_ANSWERS: Record<string, string> = {
  ru: answerIn({ why: ['Фандинг низкий, шорты платят', 'RSI растёт от перепроданности', 'Открытый интерес падает'], level: 'Поддержка у скользящей', trig: 'Закрепление выше 1.62', claim: 'ETF-приток вырос', src: 'Reuters', chart: 'Цена держится выше локальной поддержки.', pat: 'Бычья дивергенция', reasoning: 'Импульс разворачивается вверх.' }),
  ko: answerIn({ why: ['펀딩비가 낮고 숏이 비용을 낸다', 'RSI가 과매도에서 회복 중', '미결제약정 감소'], level: '이동평균 지지', trig: '1.62 위에서 안착', claim: 'ETF 유입 증가', src: 'Reuters', chart: '가격이 지지선 위를 유지한다.', pat: '강세 다이버전스', reasoning: '모멘텀이 상승으로 전환 중이다.' }),
  zh: answerIn({ why: ['资金费率偏低，空头付费', 'RSI从超卖回升', '未平仓合约下降'], level: '均线支撑', trig: '站稳1.62上方', claim: 'ETF资金流入增加', src: 'Reuters', chart: '价格守住局部支撑之上。', pat: '看涨背离', reasoning: '动能正在转向上行。' }),
  ar: answerIn({ why: ['التمويل منخفض والبائعون يدفعون', 'RSI يتعافى من التشبع البيعي', 'الفائدة المفتوحة تنخفض'], level: 'دعم عند المتوسط', trig: 'الثبات فوق 1.62', claim: 'ارتفاع تدفقات ETF', src: 'Reuters', chart: 'السعر يحافظ على الدعم المحلي.', pat: 'تباعد صعودي', reasoning: 'الزخم ينعطف صعودًا.' }),
};
const EN_ANSWER = answerIn({ why: ['Funding is low, shorts pay', 'RSI rising from oversold', 'Open interest is falling'], level: 'Support at the moving average', trig: 'Hold above 1.62', claim: 'ETF inflow grew', src: 'Reuters', chart: 'Price holds above local support.', pat: 'Bullish divergence', reasoning: 'Momentum is turning up.' });

/* ── the network stand-in ──────────────────────────────────────────────────── */

type XaiCall = { path: string; raw: string; prompt: string; cap: unknown };
const net = { xai: [] as XaiCall[], stray: [] as string[], market: [] as string[], increments: 0, refunds: 0, answers: [] as string[], logs: [] as string[], labels: null as null | Array<{ key: string; locale: string; value: string }>, labelReads: 0 };
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
    /* The xaiFetch guardrail puts a SYSTEM message first, so the read's own prompt is the USER message. */
    try { const b = JSON.parse(raw); const m = (b.messages ?? b.input ?? []) as Array<{ role?: string; content?: unknown }>; prompt = String(m.find((x) => x.role === 'user')?.content ?? ''); cap = b.max_tokens ?? b.max_output_tokens ?? null; } catch { /* not json */ }
    net.xai.push({ path: url.pathname, raw, prompt, cap });
    const text = net.answers.length ? net.answers.shift()! : EN_ANSWER;
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
  if (p.endsWith('labels')) {
    net.labelReads++;
    const rows = net.labels ?? [];
    return json(200, rows, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
  }
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const standInFetch = globalThis.fetch;

const { __labelsTestSeam } = await import('../lib/labelsServer.ts');
const origLog = console.log, origWarn = console.warn, origErr = console.error;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run would reach the real network (#1683)');
  net.xai = []; net.stray = []; net.market = []; net.increments = 0; net.refunds = 0; net.answers = []; net.logs = []; net.labels = null; net.labelReads = 0;
  __labelsTestSeam(); // empties the server's label cache, so each test decides what the label table holds
  const grab = (...a: unknown[]) => { net.logs.push(a.map(String).join(' ')); };
  console.log = grab; console.warn = grab; console.error = grab;
});
const { grokBody, contextFor } = await import('./_grokBody.mts');
const { POST } = await import('../app/api/grok/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
afterEach(() => { console.log = origLog; console.warn = origWarn; console.error = origErr; _resetApiHealthQueue(); });

/** `locale` is OMITTED when `opts` has no `locale` key (an older tab sends none). */
async function post(opts: { type?: 'quick' | 'deep'; locale?: unknown; answer?: string[] } = {}) {
  net.xai = []; net.increments = 0; net.refunds = 0; if (opts.answer) net.answers = [...opts.answer];
  const body: Record<string, unknown> = grokBody({ type: opts.type ?? 'quick', coin: 'xrp', tf: '1h', override: { context: { ...contextFor('XRP/USDT'), clusters: 'Not available' } } });
  if ('locale' in opts) body.locale = opts.locale;
  const r = await POST(new NextRequest('http://localhost/api/grok', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as { result?: CombinedResult; code?: string; error?: string }, calls: net.xai, prompt: net.xai[0]?.prompt ?? '', cap: net.xai[0]?.cap };
}

/* the stand-in's candles, as _marketStandIn.mts generates them (121 closed rows, oldest first): the oracle for the levels */
const ORACLE_CANDLES = Array.from({ length: 121 }, (_, i) => { const open = 100 + (i % 7); return { time: 1_700_000_000_000 + i * 900_000, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 10 }; });
const { srLevels } = await import('../qa/fixtures/strategyFixtures.ts');
const { priceText } = await import('../lib/numberFormat.ts');
const blockOf = (prompt: string) => { const i = prompt.indexOf('FIXED WATCH LEVELS'); return i < 0 ? '' : prompt.slice(i); };
const lineOf = (block: string, label: string) => block.split('\n').find((l) => l.startsWith(`- ${label}`)) ?? '';
const nums = (block: string) => ({ close: lineOf(block, 'Last close'), above: lineOf(block, 'Nearest resistance above').replace(/ \(.*$/, ''), below: lineOf(block, 'Nearest support below').replace(/ \(.*$/, ''), taker: lineOf(block, 'Taker-ratio threshold') });

test('F1. a Quick and a Deep read of one coin and timeframe carry the FIXED WATCH LEVELS block with the same numbers and the same threshold', async () => {
  const q = await post({ type: 'quick' }); const d = await post({ type: 'deep' });
  assert.equal(q.status, 200, JSON.stringify(q.body).slice(0, 200)); assert.equal(d.status, 200, JSON.stringify(d.body).slice(0, 200)); assert.deepEqual(net.stray, []);
  assert.ok(q.prompt.length > 3000 && d.prompt.length > 3000, 'CONTROL: the recorder is not seeing the prompts');
  const bq = blockOf(q.prompt), bd = blockOf(d.prompt); assert.ok(bq && bd, 'a read carries no FIXED WATCH LEVELS block');
  assert.deepEqual(nums(bq), nums(bd), 'Quick and Deep carry different levels');
  assert.match(nums(bq).taker, /: 60% of taker volume/, 'the taker threshold is not the fixed 60%');
  assert.equal((q.prompt.match(/FIXED WATCH LEVELS/g) ?? []).length, 1); assert.equal((d.prompt.match(/FIXED WATCH LEVELS/g) ?? []).length, 1);
});
test('F2. two reads a minute apart inside one candle are identical, and the prompt tells the model to quote the numbers', async () => {
  const a = await post({ type: 'quick' }); await new Promise((r) => setTimeout(r, 1_100)); const b = await post({ type: 'deep' });
  assert.deepEqual(nums(blockOf(a.prompt)), nums(blockOf(b.prompt)));
  const block = blockOf(a.prompt); assert.match(block, /Quote these exact numbers wherever you name a price to watch, a confirmation or a cancellation/, 'the prompt no longer tells the model to quote the numbers'); assert.match(block, /do not choose other/i);
});
test('F3. the numbers are the chart\'s own nearest levels to the last closed close; above > close > below; a side with none says so', async () => {
  const close = ORACLE_CANDLES[ORACLE_CANDLES.length - 1].close; const chart = srLevels(ORACLE_CANDLES, close).map((l) => l.price);
  const up = chart.filter((p) => p > close), dn = chart.filter((p) => p < close);
  const n = nums(blockOf((await post({ type: 'deep' })).prompt));
  assert.equal(n.close, `- Last close: ${priceText(close)}`, 'the last close is not the last CLOSED candle close');
  assert.equal(n.above, up.length ? `- Nearest resistance above: ${priceText(Math.min(...up))}` : '- Nearest resistance above: none on the chart', 'the resistance is not the nearest chart level above the close');
  assert.equal(n.below, dn.length ? `- Nearest support below: ${priceText(Math.max(...dn))}` : '- Nearest support below: none on the chart', 'the support is not the nearest chart level below the close');
  console.log(`[L128] oracle: close ${close} · levels above ${up.length} below ${dn.length} · block ${JSON.stringify(n)}`);
});
