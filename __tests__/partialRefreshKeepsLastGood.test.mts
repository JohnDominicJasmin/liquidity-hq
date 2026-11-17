/* #2506: a partial refresh must not replace the last good entry, and a cached answer carries its own time.
 *   Q1  the REAL symbolFanout: a good fan-out is cached; after its TTL a refresh that brings back less than half the symbols FAILS, so the previous entry keeps serving (all its symbols), and the entry's time stays the time of the GOOD fetch
 *   Q2  with NO earlier entry a partial result is still returned (some cells beat none), as before
 *   Q3  the line is "fewer than half": exactly half replaces the entry
 *   Q4  rsiCachedAt(): the OLDER of the two RSI groups, null when neither is cached
 *   Q5  the snapshot is too old after 10 minutes (was 30): the constant and every place the old number was written in a comment-free assertion
 *   Q6  source pins: /api/cmc allows 120 a minute and holds a failure 60 s then answers 502 "unavailable" (no upstream body); /hours is a data-free route; kline-batch answers the cache time as ts
 * WHAT IT CANNOT PROVE: the live Bybit / Binance behaviour, or that no screen still reads a number from a stale entry (the browser cells in qa/e2e do that). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { symbolFanout } from '../lib/bybitFanout.ts';
import { cached, cachedAt } from '../lib/apiCache.ts';
import { rsiCachedAt } from '../lib/marketRsi.ts';
import { SNAPSHOT_TOO_OLD_MS } from '../lib/marketSnapshot.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SYMS = Array.from({ length: 10 }, (_, i) => `COIN${i}USDT`);
const realFetch = globalThis.fetch;
let answerOnly: Set<string> | null = null;   // null = answer every symbol
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const sym = new URL(String(input instanceof Request ? input.url : input)).searchParams.get('symbol') ?? '';
  if (answerOnly && !answerOnly.has(sym)) return new Response(JSON.stringify({ error: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ v: sym }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

const build = (s: string) => `https://api.bybit.com/v5/market/x?symbol=${s}`;
const pick = (b: unknown) => (b as { v?: string }).v;
const settle = () => new Promise((r) => setTimeout(r, 60));
let n = 0; const key = () => `qa:partial:${++n}`;

test('Q1. after the TTL a refresh that brings back < half the symbols keeps the last good entry serving, with its own time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 }); answerOnly = null;
  const k = key(); const first = await symbolFanout(SYMS, k, 1_000, build, pick);
  assert.equal(Object.keys(first.data).length, 10, 'the first fan-out should be complete'); const goodAt = cachedAt(k); assert.equal(goodAt, 1_000_000);
  t.mock.timers.tick(1_500);   // past the TTL, inside the stale window
  answerOnly = new Set(SYMS.slice(0, 3));   // 3 of 10 answer
  const served = await symbolFanout(SYMS, k, 1_000, build, pick); await settle();
  assert.equal(Object.keys(served.data).length, 10, 'the stale-while-refresh call must serve the old complete entry');
  const later = await symbolFanout(SYMS, k, 1_000, build, pick);
  assert.equal(Object.keys(later.data).length, 10, 'the partial refresh replaced the good entry: the page would blank 7 of 10 cells');
  assert.equal(cachedAt(k), goodAt, 'the entry time moved to "now" although its content is the old fetch: the response would say fresh');
});

test('Q2. with no earlier entry a partial result is still returned', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 }); answerOnly = new Set(SYMS.slice(0, 3));
  const r = await symbolFanout(SYMS, key(), 1_000, build, pick);
  assert.equal(Object.keys(r.data).length, 3, 'some cells beat none'); assert.equal(r.total, 10);
});

test('Q3. exactly half replaces the entry (the rule is "fewer than half")', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 3_000_000 }); answerOnly = null;
  const k = key(); await symbolFanout(SYMS, k, 1_000, build, pick);
  t.mock.timers.tick(1_500); answerOnly = new Set(SYMS.slice(0, 5));   // 5 of 10
  await symbolFanout(SYMS, k, 1_000, build, pick); await settle();
  const after = await symbolFanout(SYMS, k, 1_000, build, pick);
  assert.equal(Object.keys(after.data).length, 5, 'a half-coverage refresh is allowed to replace the entry'); assert.equal(cachedAt(k), 3_001_500);
});

test('Q4. rsiCachedAt() is the older of the two groups, null when neither is cached', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 4_000_000 });
  assert.equal(rsiCachedAt(), null, 'nothing cached yet');
  await cached('market-rsi:slow', 10_000, async () => 'slow'); t.mock.timers.tick(5_000); await cached('market-rsi:fast', 10_000, async () => 'fast');
  assert.equal(rsiCachedAt(), 4_000_000, 'must be the OLDER group, 4,000,000, not the newer');
});

test('Q5. the snapshot is too old after ten minutes', () => {
  assert.equal(SNAPSHOT_TOO_OLD_MS, 10 * 60_000);
  assert.doesNotMatch(read('lib/marketSnapshot.ts'), /SNAPSHOT_TOO_OLD_MS = 30 \* 60_000/);
});

test('Q6. source pins: cmc limit and failure hold, /hours is data-free, kline-batch answers the cache time', () => {
  const cmc = read('app/api/cmc/route.ts');
  assert.match(cmc, /rateLimit\(`cmc:\$\{ip\}`, 120, 60_000\)/, 'the /api/cmc limit is not 120 a minute');
  assert.match(cmc, /const CMC_FAIL_HOLD = 60_000;/); assert.match(cmc, /failTtlMs: CMC_FAIL_HOLD/);
  assert.match(cmc, /NextResponse\.json\(\{ error: 'unavailable' \}, \{ status: 502 \}\)/, 'a CoinMarketCap failure must answer 502 "unavailable"');
  assert.doesNotMatch(cmc, /return e\.body/, 'the upstream error body is passed to the visitor again');
  assert.match(read('components/AppShell.tsx'), /DATA_FREE_ROUTES = \[[^\]]*'\/hours'/, '/hours is not a data-free route');
  assert.match(read('app/api/market/kline-batch/route.ts'), /ts: cachedAt\(`bybit:kline-batch:\$\{interval\}:\$\{limit\}`\) \?\? Date\.now\(\)/, 'kline-batch answers "now" instead of the cache time');
});
