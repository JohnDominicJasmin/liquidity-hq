/* #2509: reliability rest. What each change promises, with the real functions where they can run here and source pins where they cannot (the routes import next/server).
 *   D1  dry powder: a day the source left out (or sent as 0) is DROPPED, so no zero lands where a change is computed from (it used to give Infinity% or -100% and a CONTRACTING verdict cached for a day)
 *   F1  FRED: an empty or failed reply never replaces good rows and is never cached as "no data"; a first-ever empty reply returns [] and the NEXT call asks again
 *   B1  fetchWithDeadline: a read that never answers is abandoned at the deadline (TimeoutError); a WRITE is never cut
 *   B2  the deadline is OPT-IN: getSupabaseAdmin() has none; only the config route and the two market-snapshot reads ask for it, so the backup export and the ops reports (whole-table reads) are left alone; the per-request user client has it
 *   B3  /api/backup: the route reads with getSupabaseAdmin() and no deadline, in count mode and in full mode
 *   S1  source pins: briefing stall -> 504 at 45 s (browser gives up at 50), an empty reply -> 502 and the quota is refunded BEFORE answering, funding with BOTH exchanges empty is a failure (not a cached blank), a ticker row with a missing field is skipped on both venues, alt-season with no BTC 90-day change is a failed read
 * WHAT IT CANNOT PROVE: the routes' live behaviour (the browser cells and the staging sweep do that). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDryPowderNumbers } from '../lib/dryPowderSeries.ts';
import { fetchFredRows } from '../lib/fred.ts';
import { fetchWithDeadline } from '../lib/supabase.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
let handler: (url: string, init?: RequestInit) => Promise<Response> = async () => new Response('', { status: 500 });
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input instanceof Request ? input.url : input), init)) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

test('D1. a missing or zero day is dropped; every figure the card computes from the series is finite', async () => {
  const data = Array.from({ length: 100 }, (_, i) => ({ date: String(i), totalCirculatingUSD: { peggedUSD: 1_000 + i } })) as Array<{ date: string; totalCirculatingUSD?: { peggedUSD?: number } }>;
  data[69] = { date: '69', totalCirculatingUSD: { peggedUSD: 0 } };   // lands exactly where the 30-day-ago value is read
  data[80] = { date: '80' };   // a day the source left out
  handler = async (url) => (url.includes('stablecoincharts') ? new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 }));
  const n = await getDryPowderNumbers();
  for (const [k, v] of Object.entries({ current: n.current, prev30: n.prev30, prev90: n.prev90 })) assert.ok(Number.isFinite(v) && v > 0, `${k} is ${v}`);
  assert.ok(n.series.every((v) => Number.isFinite(v) && v > 0), 'a zero or missing day is still in the series');
  const change = ((n.current - n.prev30) / n.prev30) * 100; assert.ok(Number.isFinite(change), `the 30-day change is ${change}`);
  assert.equal(n.current, 1_099, 'the last real day is the current value');
});

const csv = (rows: Array<[string, number]>) => 'DATE,SERIES\n' + rows.map(([d, v]) => `${d},${v}`).join('\n') + '\n';
let sid = 0; const id = () => `QA${++sid}`;

test('F1. FRED: an empty or failed refresh keeps the last good rows and is never cached; a first empty reply is asked again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const s = id(); let calls = 0; let mode: 'good' | 'empty' | '500' | 'throw' = 'good';
  handler = async () => { calls++; if (mode === 'throw') throw new Error('network'); if (mode === '500') return new Response('x', { status: 500 }); return new Response(mode === 'empty' ? '' : csv([['2026-01-01', 1.5], ['2026-02-01', 2.5]]), { status: 200 }); };
  const good = await fetchFredRows(s, 1_000); assert.equal(good.length, 2);
  for (const m of ['empty', '500', 'throw'] as const) { t.mock.timers.tick(1_500); mode = m; const r = await fetchFredRows(s, 1_000); assert.equal(r.length, 2, `a ${m} refresh replaced the good rows (${r.length})`); }
  t.mock.timers.tick(1_500); mode = 'good'; const before = calls; await fetchFredRows(s, 1_000); assert.equal(calls, before + 1, 'after the failures the next call must ask again, not serve a cached blank');
  const s2 = id(); mode = 'empty'; const c0 = calls; const first = await fetchFredRows(s2, 60_000); assert.deepEqual(first, []); const again = await fetchFredRows(s2, 60_000); assert.deepEqual(again, []);
  assert.equal(calls - c0, 2, 'an empty FIRST reply was cached as "no data": the second call did not ask again');
});

test('B1. fetchWithDeadline abandons a read that never answers, and never cuts a write', async () => {
  const never = (_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)); });
  handler = never as typeof handler;
  await assert.rejects(() => fetchWithDeadline('https://x.invalid/rest/v1/t', { method: 'GET' }, 40), (e: unknown) => (e as Error).name === 'TimeoutError', 'a silent GET must be abandoned with a TimeoutError');
  let writeSignal: AbortSignal | null | undefined = undefined; handler = async (_u, init) => { writeSignal = init?.signal; await new Promise((r) => setTimeout(r, 120)); return new Response('{}', { status: 201 }); };
  const res = await fetchWithDeadline('https://x.invalid/rest/v1/t', { method: 'POST', body: '{}' }, 40); assert.equal(res.status, 201, 'a slow write was cut by the read deadline');
  assert.ok(!writeSignal, 'a write must not be handed a deadline signal');
});

test('B2/B3. the deadline is opt-in: only the config read and the two snapshot reads ask for it; backup and ops do not; user clients have it', () => {
  const admin = read('lib/supabase-admin.ts');
  assert.match(admin, /export function getSupabaseAdmin\(opts: \{ deadline\?: boolean \} = \{\}\)/); assert.match(admin, /\.\.\.\(opts\.deadline \? \{ global: \{ fetch:/);
  const users: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && /getSupabaseAdmin\(\{[^)]*deadline:\s*true/.test(readFileSync(p, 'utf8'))) users.push(p.replace(/\\/g, '/')); } };
  for (const d of ['app', 'lib', 'components']) walk(d);
  assert.deepEqual(users.sort(), ['app/api/config/route.ts', 'lib/marketSnapshot.ts'], `the read deadline is asked for by: ${users.join(', ')}`);
  const backup = read('app/api/backup/route.ts'); assert.match(backup, /getSupabaseAdmin\(\)/, 'the backup route no longer reads through the plain admin client'); assert.doesNotMatch(backup, /deadline/, 'the backup export has a read deadline: a whole-table read would be cut');
  assert.match(read('lib/supabase-user.ts'), /global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \}, fetch: serverFetch \}/, 'the per-request user client lost the read deadline');
});

test('S1. source pins: briefing 504 / 502 + refund, funding both-empty, ticker row skip, alt-season failed read', () => {
  const brief = read('app/api/briefing/route.ts');
  assert.match(brief, /signal: AbortSignal\.timeout\(45_000\)/); assert.match(brief, /e\.name === 'TimeoutError' \|\| e\.name === 'AbortError'[\s\S]{0,160}status: 504/);
  const empty = brief.indexOf('if (!briefing) {'); assert.ok(empty > 0, 'the empty-reply branch moved'); const block = brief.slice(empty, empty + 330);
  assert.ok(block.indexOf("refundUsageColumn(userId, 'briefing_count', reservedOn)") > 0 && block.indexOf("refundUsageColumn") < block.indexOf('status: 502'), 'the quota must be handed back BEFORE the 502 answer');
  assert.match(read('components/BriefingTerminal.tsx'), /AbortSignal\.timeout\(50_000\)/, 'the browser must wait longer than the server (45 s) so it never waits on a call that has ended');
  assert.match(read('app/api/funding/route.ts'), /Object\.keys\(bn\.rates\)\.length === 0 && Object\.keys\(bb\.rates\)\.length === 0[\s\S]{0,60}throw new Error/);
  const snap = read('lib/marketSnapshotData.ts'); assert.equal((snap.match(/if \(!tickerEntryFinite\(entry\)\) continue;/g) ?? []).length, 2, 'a ticker row with a missing field must be skipped on BOTH venues'); assert.match(snap, /\[e\.price, e\.change, e\.high, e\.low, e\.vol24\]\.every\(Number\.isFinite\)/);
  assert.match(read('components/MarketProvider.tsx'), /typeof btc90 !== 'number' \|\| !Number\.isFinite\(btc90\)\) \{ markAltFailed\(\); return; \}/);
});
