import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2628 THE DRY-POWDER AI TEXT IS WRITTEN ONCE A DAY BY THE SERVER, NOT BY THE FIRST PRO VISITOR. Rules from the PR text and the module header, as literals (nothing computed from the code under test):
 *   - the visitor route only READS the stored text (lhq_market_snapshot, key `dry-powder-analysis`): 202 `{ pending: true }` when none, no xAI call, no usage reservation; a stored row older than 36 h is not served;
 *   - a refresh is due when none is stored, or today's is not stored AND it is 02:00 UTC or later; yesterday's text before 02:00 UTC stands;
 *   - the scheduled ingest's `ensureDryPowderAnalysis` writes it: nothing is called when today's text is stored; one xAI call otherwise; a CLAIM ROW (key `dry-powder-analysis-lock`, 10 min) is written BEFORE the call and a fresh one makes
 *     a second instance skip; a failed attempt (non-2xx, or an empty text) is not retried by this instance for 30 min; no GROK_API_KEY = no call; it never throws;
 *   - the cost of a 2xx goes to ai_call_log with user_id null and source 'system:dry-powder' (call_type dry_powder), whatever the text turns out to be; a non-2xx is not billed and logs nothing.
 *   D1 refresh-due table   D2 the 36 h read rule   D3 a day's write end to end (order: lock, call, ledger, text)   D4 the claim row   D5 failure and empty answers   D6 no key / read errors / two callers at once   D7 the route, the ingest and the card (source anchors)
 * The real lib code runs against a stand-in database (supabase REST), DeFi Llama and xAI. No billed call. */
const BASE = 'https://fake.supabase.test';
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.GROK_API_KEY = 'grok-key';

const rows = new Map<string, { payload: unknown; source: string | null; updated_at: string }>();
const events: string[] = []; const ledger: Array<Record<string, unknown>> = [];
let xaiCalls = 0, xaiMode: 'ok' | 'fail' | 'empty' = 'ok', restDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input instanceof Request ? input.url : input)); const method = (init?.method ?? 'GET').toUpperCase();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.host === 'stablecoins.llama.fi') return json(Array.from({ length: 120 }, (_, i) => ({ date: String(1_700_000_000 + i * 86400), totalCirculatingUSD: { peggedUSD: 150e9 + i * 1e9 } })));
  if (u.host === 'api.x.ai') {
    xaiCalls++; events.push('xai');
    if (xaiMode === 'fail') return json({ error: 'down' }, 500);
    return json({ model: 'grok-4.3', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, choices: [{ message: { content: xaiMode === 'empty' ? '' : 'SIGNAL: EXPANDING: supply rose 5.0% in 30 days.\nNARRATIVE: ...\nKEY_LEVEL: 30d ago $1.0B, 90d ago $0.9B' } }] });
  }
  if (u.host === 'fake.supabase.test') {
    if (restDown) return json({ message: 'down' }, 500);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname.includes('market_snapshot')) {
      if (method === 'GET') { const key = (u.searchParams.get('key') ?? '').replace(/^eq\./, ''); const r = rows.get(key); return json(r ? [r] : []); }
      const items = Array.isArray(body) ? body : [body]; for (const it of items) { rows.set(it.key, { payload: it.payload, source: it.source ?? null, updated_at: it.updated_at }); events.push(it.key === 'dry-powder-analysis-lock' ? 'lock-write' : `snapshot-write:${it.key}`); }
      return new Response(null, { status: 201 });
    }
    if (u.pathname.includes('ai_call_log')) { const items = Array.isArray(body) ? body : [body]; for (const it of items) ledger.push(it); events.push('ledger'); return new Response(null, { status: 201 }); }
    return method === 'GET' ? json([]) : new Response(null, { status: 201 });   // api_health and anything else
  }
  throw new Error('stray request ' + u.href);
}) as typeof fetch;
const lib = await import('../lib/dryPowderAnalysis.ts');
const { dryPowderRefreshDue, readDryPowderAnalysis, ensureDryPowderAnalysis, buildDryPowderPrompt, DRY_POWDER_MAX_AGE_MS, DRY_POWDER_REFRESH_HOUR_UTC, DRY_POWDER_LOCK_MS } = lib;

const at = (d: number, h: number, mi = 0) => Date.UTC(2026, 10, d, h, mi);
const stored = (day: string, generatedAt: number, analysis = 'SIGNAL: x') => ({ day, analysis, current: 2e11, prev30: 1.9e11, prev90: 1.8e11, generatedAt });
const put = (key: string, payload: unknown) => { rows.set(key, { payload, source: 'xai', updated_at: new Date().toISOString() }); };
const reset = () => { rows.clear(); events.length = 0; ledger.length = 0; xaiCalls = 0; xaiMode = 'ok'; restDown = false; };

test('D1. constants and the refresh-due table: none = due; today stored = not due; yesterday before 02:00 UTC = not due; yesterday at 02:00 or later = due', () => {
  assert.equal(DRY_POWDER_REFRESH_HOUR_UTC, 2); assert.equal(DRY_POWDER_MAX_AGE_MS, 36 * 3_600_000); assert.equal(DRY_POWDER_LOCK_MS, 10 * 60_000);
  assert.equal(dryPowderRefreshDue(null, at(20, 0, 30)), true, 'none stored is due even before 02:00');
  assert.equal(dryPowderRefreshDue(stored('2026-11-20', at(20, 3)), at(20, 23, 59)), false, 'today stored');
  assert.equal(dryPowderRefreshDue(stored('2026-11-19', at(19, 3)), at(20, 1, 59)), false, 'yesterday stands before 02:00 UTC');
  assert.equal(dryPowderRefreshDue(stored('2026-11-19', at(19, 3)), at(20, 2, 0)), true, 'due from 02:00 UTC');
  assert.equal(dryPowderRefreshDue(stored('2026-11-19', at(19, 3)), at(20, 14)), true, 'still due in the afternoon');
  assert.equal(dryPowderRefreshDue(stored('2026-11-18', at(18, 3)), at(20, 1)), false, 'before 02:00 the day is not due even when the text is 2 days old (the 36 h rule stops serving it)');
});
test('D2. a stored row is served up to 36 h old and not a millisecond later; none, an empty analysis or a malformed row is null', async () => {
  reset(); const gen = at(19, 3); assert.equal(await readDryPowderAnalysis(gen), null, 'nothing stored');
  put('dry-powder-analysis', stored('2026-11-19', gen)); assert.equal((await readDryPowderAnalysis(gen + 36 * 3_600_000))?.analysis, 'SIGNAL: x', 'exactly 36 h is still served'); assert.equal(await readDryPowderAnalysis(gen + 36 * 3_600_000 + 1), null, '36 h + 1 ms is not');
  put('dry-powder-analysis', stored('2026-11-19', gen, '   ')); assert.equal(await readDryPowderAnalysis(gen), null, 'an empty analysis is not a text');
  put('dry-powder-analysis', { day: '2026-11-19', analysis: 'x' }); assert.equal(await readDryPowderAnalysis(gen), null, 'a row without generatedAt is not served');
  put('dry-powder-analysis', 'garbage'); assert.equal(await readDryPowderAnalysis(gen), null);
});
test('D3. a day\'s write: nothing stored at 10:00 UTC -> ONE xAI call; the claim row is written first, then the call, then the ledger row (user null, system:dry-powder), then the text; today stored -> no call at all', async () => {
  reset(); const now = at(21, 10); const r = await ensureDryPowderAnalysis(now);
  assert.equal(r, 'generated'); assert.equal(xaiCalls, 1);
  assert.deepEqual(events.filter((e) => ['lock-write', 'xai', 'ledger'].includes(e) || e.startsWith('snapshot-write:dry-powder-analysis')), ['lock-write', 'xai', 'ledger', 'snapshot-write:dry-powder-analysis'], 'the order must be: claim, call, ledger, text');
  assert.equal(ledger.length, 1); assert.equal(ledger[0].user_id, null, 'the ledger row names a user'); assert.equal(ledger[0].source, 'system:dry-powder'); assert.equal(ledger[0].call_type, 'dry_powder'); assert.equal(ledger[0].model, 'grok-4.3');
  assert.equal(ledger[0].prompt_tokens, 100); assert.equal(ledger[0].completion_tokens, 50);
  const row = rows.get('dry-powder-analysis')!.payload as { day: string; analysis: string; generatedAt: number; current: number; prev30: number; prev90: number };
  assert.equal(row.day, '2026-11-21'); assert.equal(row.generatedAt, now); assert.match(row.analysis, /^SIGNAL: EXPANDING/); assert.equal(row.current, 150e9 + 119e9); assert.equal(row.prev30, 150e9 + 89e9); assert.equal(row.prev90, 150e9 + 29e9);
  assert.equal((rows.get('dry-powder-analysis-lock')!.payload as { at: number }).at, now, 'the claim row carries the time of the claim');
  events.length = 0; xaiCalls = 0; ledger.length = 0;
  assert.equal(await ensureDryPowderAnalysis(at(21, 11)), 'fresh'); assert.equal(xaiCalls, 0, 'a second run the same day called xAI'); assert.equal(ledger.length, 0); assert.ok(!events.includes('lock-write'), 'a fresh day wrote a claim row');
  assert.equal(await ensureDryPowderAnalysis(at(21, 23, 55)), 'fresh');
});
test('D3b. yesterday\'s text stands before 02:00 UTC (no call) and is replaced from 02:00 UTC (one call)', async () => {
  reset(); put('dry-powder-analysis', stored('2026-11-21', at(21, 3)));
  assert.equal(await ensureDryPowderAnalysis(at(22, 1, 55)), 'fresh'); assert.equal(xaiCalls, 0);
  assert.equal(await ensureDryPowderAnalysis(at(22, 2, 0)), 'generated'); assert.equal(xaiCalls, 1); assert.equal((rows.get('dry-powder-analysis')!.payload as { day: string }).day, '2026-11-22');
});
test('D4. the claim row: a claim younger than 10 min makes the instance skip (no call, no ledger); an older claim does not', async () => {
  reset(); const now = at(23, 10); put('dry-powder-analysis-lock', { at: now - 9 * 60_000 });
  assert.equal(await ensureDryPowderAnalysis(now), 'skipped'); assert.equal(xaiCalls, 0); assert.equal(ledger.length, 0);
  reset(); put('dry-powder-analysis-lock', { at: at(24, 10) - 11 * 60_000 });
  assert.equal(await ensureDryPowderAnalysis(at(24, 10)), 'generated'); assert.equal(xaiCalls, 1);
});
test('D5. failures: a non-2xx writes no text and no ledger row and is not retried for 30 min (retried after); an EMPTY 2xx is billed (ledger row) but writes no text and also waits 30 min', async () => {
  reset(); xaiMode = 'fail'; const t0 = at(25, 10);
  assert.equal(await ensureDryPowderAnalysis(t0), 'failed'); assert.equal(xaiCalls, 1); assert.equal(rows.has('dry-powder-analysis'), false, 'a failed call stored a text'); assert.equal(ledger.length, 0, 'a non-2xx was billed');
  assert.equal(await ensureDryPowderAnalysis(t0 + 29 * 60_000), 'skipped'); assert.equal(xaiCalls, 1, 'retried inside 30 min');
  xaiMode = 'ok'; assert.equal(await ensureDryPowderAnalysis(t0 + 31 * 60_000), 'generated'); assert.equal(xaiCalls, 2);
  reset(); xaiMode = 'empty'; const t1 = at(26, 10);
  assert.equal(await ensureDryPowderAnalysis(t1), 'failed'); assert.equal(ledger.length, 1, 'a 2xx with an empty text must still be in the ledger (it was billed)'); assert.equal(ledger[0].source, 'system:dry-powder'); assert.equal(rows.has('dry-powder-analysis'), false, 'an empty text was stored');
  assert.equal(await ensureDryPowderAnalysis(t1 + 20 * 60_000), 'skipped'); assert.equal(xaiCalls, 1);
});
test('D6. no GROK_API_KEY = no call; a database that answers 500 never throws; two callers at once make ONE call', async () => {
  reset(); const key = process.env.GROK_API_KEY; delete process.env.GROK_API_KEY; try { assert.equal(await ensureDryPowderAnalysis(at(27, 10)), 'skipped'); assert.equal(xaiCalls, 0); } finally { process.env.GROK_API_KEY = key; }
  reset(); restDown = true; const r = await ensureDryPowderAnalysis(at(28, 10)); assert.ok(['skipped', 'failed', 'generated', 'fresh'].includes(r), `it must always answer a state, got ${String(r)}`);
  reset(); const now = at(29, 10); const [a, b] = await Promise.all([ensureDryPowderAnalysis(now), ensureDryPowderAnalysis(now)]); assert.equal(xaiCalls, 1, 'two concurrent callers in one instance called xAI twice'); assert.equal(a, b);
});
test('D6b. the prompt: states only what the numbers show (no outlook words), carries the three figures and the percentage changes, asks for the three headers', () => {
  const p = buildDryPowderPrompt(200e9, 190e9, 180e9);
  assert.match(p, /write a short factual summary/); assert.match(p, /No price predictions, no advice, no words like bullish or bearish, no "dry powder" framing, no things to watch\./);
  assert.ok(p.includes('$200.0B') && p.includes('$190.0B (5.3% change)') && p.includes('$180.0B (11.1% change)'), p);
  for (const h of ['SIGNAL:', 'NARRATIVE:', 'KEY_LEVEL:']) assert.ok(p.includes(h), `the prompt lost the ${h} header`);
  for (const old of ['next 2-4 weeks', 'traders should watch', '(bullish dry powder)', 'what this trend means for crypto prices']) assert.equal(p.includes(old), false, `the prompt still asks for: ${old}`);
});

const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
test('D7a. the route only READS: it imports readDryPowderAnalysis, answers 202 pending when none, and has no xAI call, no reservation, no refund, no cachedOwn, no per-visitor cost', () => {
  const route = strip(read('app/api/dry-powder/route.ts'));
  assert.ok(/readDryPowderAnalysis\(\)/.test(route), 'the route does not read the stored text');
  assert.ok(/status:\s*202/.test(route) && /pending:\s*true/.test(route), 'no 202 pending answer for an empty store');
  for (const bad of ['xaiFetch', 'api.x.ai', 'incrementToolUsage', 'refundToolUsage', 'cachedOwn', 'recordAiCall', 'RateLimitError', 'blockedResponse']) assert.equal(route.includes(bad), false, `the visitor route still uses ${bad}`);
  const part = route.indexOf("searchParams.get('part') === 'numbers'"); assert.ok(part > 0); assert.ok(route.indexOf('PRO_REQUIRED') < part && route.indexOf('getUserCompatForBilledCall(token)') < part, 'the numbers part is reachable before the auth and Pro checks');
  assert.ok(route.indexOf('PRO_REQUIRED') < route.indexOf('readDryPowderAnalysis()'), 'a Free caller can read the AI text (the Pro gate is after the read)');
});
test('D7b. the scheduled ingest calls ensureDryPowderAnalysis AFTER the exchange feeds and reports it in its answer without changing its own success', () => {
  const ing = strip(read('app/api/market/ingest/route.ts')); const call = ing.indexOf('ensureDryPowderAnalysis()'); assert.ok(call > 0, 'the ingest does not call the daily write');
  assert.ok(call > ing.indexOf('outcomes'), 'the daily write runs before the exchange feeds'); assert.ok(/ok:\s*true,\s*written,\s*feeds:\s*outcomes,\s*dryPowder/.test(ing), 'the ingest answer lost ok / written / feeds or does not carry dryPowder');
});
test('D7c. the card: on a pending answer it keeps its loading state, waits 20 s and asks ONCE more, then says unavailable', () => {
  const card = strip(read('components/DryPowder.tsx')); assert.ok(/ai\?\.json\.pending/.test(card), 'the card does not look at pending'); assert.ok(card.includes('setTimeout(r, 20_000)'), 'no 20 s wait before the second ask');
  assert.equal((card.match(/askAi\(\)/g) ?? []).length, 2, 'the card must ask exactly twice (the first, and one more after a pending answer)');
});
test('D8. the ledger accepts a call with no user: AiCallRecord.userId is nullable and carries a source; the migration drops NOT NULL and adds the column on both environments', () => {
  const log = strip(read('lib/aiCallLog.ts')); assert.ok(/userId:\s*string \| null/.test(log) && /source\?:\s*string/.test(log) && /source:\s*rec\.source \?\? null/.test(log));
  const mig = read('supabase/migrations/20261121a_ai_call_log_system_source.sql');
  for (const t of ['lhq_ai_call_log', 'lhq_dev_ai_call_log']) { assert.ok(mig.includes(`alter table ${t} alter column user_id drop not null;`), `${t}: no DROP NOT NULL`); assert.ok(mig.includes(`alter table ${t} add column if not exists source text;`), `${t}: no source column`); }
});
after(() => { globalThis.fetch = realFetch; });
