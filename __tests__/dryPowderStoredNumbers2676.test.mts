import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2676 (#1651 L103): THE STABLECOIN NUMBERS ARE STORED BY THE SCHEDULED INGEST, SO A PRO VISIT DOES NOT FETCH THEM. QA's measurement (qa 0e4c6d5, 4 Pro first visits): the AI text lands 0-1.7 s after the numbers and the numbers (a live DeFi Llama read, 4.7-10.2 s) are the slow part. Written rule (PR + PM):
 * the ingest refreshes the numbers hourly into lhq_market_snapshot under key "dry-powder-numbers" as { numbers, at }; getDryPowderNumbers answers from that row when it is at most 36 hours old (one fast read, no DeFi Llama call) and falls back to the live read when nothing usable is stored (no row, unreadable shape, too old); ensureDryPowderNumbers (called by the ingest, NOT awaited) is a cheap read when the row is under an hour old, refreshes when it is missing or older, never throws, waits 30 minutes after a failure before asking the source again, and shares one in-flight refresh; no AI call is involved.
 * THE REAL lib/dryPowderSeries.ts RUNS with DeFi Llama and the Supabase REST table stood in (nothing leaves the machine).
 *   S1 a fresh stored row is served with NO source call   S2 no row / too old / unreadable shapes read live   S3 ensure: fresh = nothing, stale or missing = one read + one write of { numbers, at } under the key, failure = no write and no throw, then held 30 min, one in-flight refresh
 *   S4 the constants and the ingest wiring (not awaited)   S5 the live path is unchanged (the dryPowderParts N1-N4 file is carried by the head) */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service'; process.env.NEXT_PUBLIC_APP_ENV = 'dev';
const lib = await import('../lib/dryPowderSeries.ts');
const { getDryPowderNumbers, ensureDryPowderNumbers, readStoredDryPowderNumbers, DRY_POWDER_NUMBERS_KEY, DRY_POWDER_NUMBERS_REFRESH_MS, DRY_POWDER_NUMBERS_MAX_AGE_MS } = lib;

const realFetch = globalThis.fetch;
const net = { llama: 0, mode: 'ok' as 'ok' | 'down', row: null as null | { payload: unknown; source: string | null; updated_at: string }, writes: [] as Array<Record<string, unknown>>, reads: 0, stray: [] as string[] };
const series = (n = 120) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ date: String(1_700_000_000 + i * 86400), totalCirculatingUSD: { peggedUSD: 150e9 + i * 1e9 } })));
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init); const u = req.url;
  if (u.includes('stablecoins.llama.fi')) { net.llama++; return net.mode === 'down' ? new Response('{}', { status: 500 }) : new Response(series(), { status: 200, headers: { 'content-type': 'application/json' } }); }
  if (u.includes('supabase.invalid') && u.includes('market_snapshot')) {
    if (req.method === 'GET') { net.reads++; const one = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object'); return net.row ? new Response(JSON.stringify(one ? net.row : [net.row]), { status: 200, headers: { 'content-type': 'application/json' } }) : (one ? new Response(JSON.stringify({ code: 'PGRST116', message: 'no rows', details: '', hint: '' }), { status: 406, headers: { 'content-type': 'application/json' } }) : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })); }
    const body = await req.json().catch(() => null); net.writes.push(Array.isArray(body) ? body[0] : body); return new Response(null, { status: 201 });
  }
  net.stray.push(u); throw new Error('stray request ' + u);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

let epoch = 0; const BASE = 1_800_000_000_000;
const start = (t: TestContext) => { net.llama = 0; net.mode = 'ok'; net.row = null; net.writes = []; net.reads = 0; const now = BASE + (++epoch) * 100 * 3_600_000; try { t.mock.timers.reset(); } catch { /* not enabled yet */ } t.mock.timers.enable({ apis: ['Date'], now }); return now; };
const numbers = { current: 285.2e9, prev30: 301.6e9, prev90: 298.4e9, series: [301e9, 295e9, 285.2e9] };
const row = (at: number, n: unknown = numbers) => ({ payload: { numbers: n, at }, source: 'defillama', updated_at: new Date(at).toISOString() });

test('S1. a fresh stored row is served with NO DeFi Llama call (at 1 h, 20 h and exactly 36 h old)', async (t) => {
  for (const ageH of [0.01, 1, 20, 36]) { const now = start(t); net.row = row(now - ageH * 3_600_000); const n = await getDryPowderNumbers(); assert.deepEqual(n, numbers, `age ${ageH} h: not the stored numbers`); assert.equal(net.llama, 0, `age ${ageH} h: the source was called`); assert.equal(net.stray.length, 0, net.stray.join(',')); }
  const now = start(t); net.row = row(now - 3_600_000); const stored = await readStoredDryPowderNumbers(); assert.deepEqual(stored, { numbers, at: now - 3_600_000 });
});
test('S2. no row, a row older than 36 h, or an unreadable / implausible one: the live read answers (one call)', async (t) => {
  const cases: Array<[string, (now: number) => typeof net.row]> = [['no row', () => null], ['36 h and one minute old', (now) => row(now - 36 * 3_600_000 - 60_000)], ['no numbers', (now) => ({ payload: { at: now }, source: 'x', updated_at: new Date(now).toISOString() })], ['current zero', (now) => row(now, { ...numbers, current: 0 })], ['current NaN-like string', (now) => row(now, { ...numbers, current: 'x' })], ['empty series', (now) => row(now, { ...numbers, series: [] })], ['negative prev90', (now) => row(now, { ...numbers, prev90: -1 })], ['payload is a string', (now) => ({ payload: 'oops', source: 'x', updated_at: new Date(now).toISOString() })], ['at missing', (now) => ({ payload: { numbers }, source: 'x', updated_at: new Date(now).toISOString() })]];
  for (const [name, mk] of cases) { const now = start(t); net.row = mk(now); const n = await getDryPowderNumbers(); assert.equal(net.llama, 1, `${name}: expected one live read, got ${net.llama}`); assert.equal(n.current, 150e9 + 119e9, `${name}: not the live numbers`); }
});
test('S3a. ensure: a row under an hour old is left alone (a cheap read, no source call, no write)', async (t) => {
  const now = start(t); net.row = row(now - 59 * 60_000); assert.equal(await ensureDryPowderNumbers(now), 'fresh'); assert.equal(net.llama, 0); assert.equal(net.writes.length, 0);
});
test('S3b. ensure: a row over an hour old, or none, is refreshed with ONE source read and ONE write of { numbers, at } under dry-powder-numbers', async (t) => {
  for (const ageMin of [61, 600, null] as const) {
    const now = start(t); net.row = ageMin === null ? null : row(now - ageMin * 60_000); assert.equal(await ensureDryPowderNumbers(now), 'refreshed', `age ${ageMin}`); assert.equal(net.llama, 1, `age ${ageMin}: source reads`); assert.equal(net.writes.length, 1, `age ${ageMin}: writes`);
    const w = net.writes[0] as { key: string; payload: { numbers: { current: number; series: unknown[] }; at: number }; source: string }; assert.equal(w.key, DRY_POWDER_NUMBERS_KEY); assert.equal(w.key, 'dry-powder-numbers'); assert.equal(w.payload.at, now); assert.equal(w.payload.numbers.current, 150e9 + 119e9); assert.equal(w.payload.numbers.series.length, 30); assert.equal(w.source, 'defillama');
  }
});
test('S3c. ensure: a failing source writes nothing, never throws, is not asked again for 30 minutes, then retries; two parallel calls share one refresh', async (t) => {
  let now = start(t); net.row = null; net.mode = 'down';
  assert.equal(await ensureDryPowderNumbers(now), 'failed'); assert.equal(net.llama >= 1, true); assert.equal(net.writes.length, 0, 'a failed read must not write'); const reads1 = net.llama;
  now += 10 * 60_000; t.mock.timers.tick(10 * 60_000); assert.equal(await ensureDryPowderNumbers(now), 'skipped', 'asked the source again 10 minutes after a failure'); assert.equal(net.llama, reads1);
  now += 25 * 60_000; t.mock.timers.tick(25 * 60_000); net.mode = 'ok'; assert.equal(await ensureDryPowderNumbers(now), 'refreshed', 'did not retry after the 30 minute wait'); assert.equal(net.writes.length, 1);
  now = start(t); net.row = null; net.mode = 'ok'; const [a, b] = await Promise.all([ensureDryPowderNumbers(now), ensureDryPowderNumbers(now)]); assert.equal(a, b, 'two parallel calls must share one result'); assert.equal(net.llama, 1, 'two parallel calls fetched twice'); assert.equal(net.writes.length, 1);
});
test('S4. constants and the ingest wiring: key, one hour, 36 hours; the ingest does not await it', () => {
  assert.equal(DRY_POWDER_NUMBERS_KEY, 'dry-powder-numbers'); assert.equal(DRY_POWDER_NUMBERS_REFRESH_MS, 3_600_000); assert.equal(DRY_POWDER_NUMBERS_MAX_AGE_MS, 36 * 3_600_000);
  const ing = readFileSync(new URL('../app/api/market/ingest/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(ing, /import \{ ensureDryPowderNumbers \} from '@\/lib\/dryPowderSeries';/); assert.equal((ing.match(/ensureDryPowderNumbers\(/g) ?? []).length, 1, 'exactly one call'); assert.match(ing, /\bvoid ensureDryPowderNumbers\(\);/, 'the ingest must not await the refresh (it takes 5-10 s once an hour)'); assert.equal(/await ensureDryPowderNumbers/.test(ing), false);
  const lib2 = readFileSync(new URL('../lib/dryPowderSeries.ts', import.meta.url), 'utf8'); assert.equal(/\bxai\b|grok|anthropic/i.test(lib2.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'an AI call in the numbers path');
});

/* #2820 (#1651 owner item 56): the last saved read, dated, when nothing fresh is stored and the live read fails. */
test('S6. a failed live read answers the saved figures with their UTC day, whatever their age; with none saved the error stands; a fresh row or a working source carries no day', async (t) => {
  const orSaved = lib.getDryPowderNumbersOrSaved;
  let now = start(t); const at = now - 100 * 3_600_000; net.row = row(at); net.mode = 'down';
  assert.deepEqual(await orSaved(now), { numbers, savedDay: new Date(at).toISOString().slice(0, 10) });
  now = start(t); net.row = null; net.mode = 'down'; await assert.rejects(orSaved(now));
  now = start(t); net.row = { payload: { at: now, numbers: 'bad' }, source: 'x', updated_at: new Date(now).toISOString() }; net.mode = 'down'; await assert.rejects(orSaved(now), 'an unreadable row is not served');
  now = start(t); net.row = row(now - 3_600_000); net.mode = 'down'; assert.deepEqual(await orSaved(now), { numbers }); assert.equal(net.llama, 0);
  now = start(t); net.row = row(now - 100 * 3_600_000); net.mode = 'ok'; const live = await orSaved(now); assert.equal(live.savedDay, undefined); assert.equal(live.numbers.current, 150e9 + 119e9);
});
