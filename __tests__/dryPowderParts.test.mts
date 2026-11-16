/* #2419: the Stablecoin card shows its numbers first and the AI text after, with an honest failure for the text.
 *   N1-N4  lib/dryPowderSeries (REAL code, DeFi Llama stood in): the figures (current, 30 d, 90 d, the 30-day series), a too-short series throws, the series is cached a day, a failure is held a minute (not hammered, not for ever), warm never throws
 *   R1-R4  app/api/dry-powder/route.ts, source anchors (the route cannot be imported by the unit runner: its RateLimitError uses a TypeScript parameter property, which node's strip-only mode rejects; the same limit
 *          applies on dev). Pinned: the numbers part returns before the reservation and after the Pro gate, the AI step has its 25 s bound, the reservation is refunded unless billed, billed is set only after a 2xx
 * WHAT IT CANNOT PROVE: the route's behaviour end to end and the card's order of rendering (skeleton, figures, summary, unavailable line): the browser cell in the group run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDryPowderNumbers, warmDryPowderSeries, DRY_POWDER_SERIES_TTL_MS } from '../lib/dryPowderSeries.ts';

const realFetch = globalThis.fetch; let llamaReads = 0; let mode: 'ok' | 'short' | 'down' = 'ok';
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input);
  if (!u.includes('stablecoins.llama.fi')) throw new Error('stray request ' + u);
  llamaReads++;
  if (mode === 'down') return new Response('{}', { status: 500 });
  const n = mode === 'short' ? 10 : 120;
  return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ date: String(1_700_000_000 + i * 86400), totalCirculatingUSD: { peggedUSD: 150e9 + i * 1e9 } }))), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
import { after } from 'node:test';
after(() => { globalThis.fetch = realFetch; });

let epoch = 0; const BASE = 1_800_000_000_000;
/* each test starts its mocked clock 100 h after the last, so the module's caches (24 h series, 1 min failure hold) are expired */
const start = (t: { mock: { timers: { enable(o: object): void; tick(ms: number): void } } }) => { llamaReads = 0; t.mock.timers.enable({ apis: ['Date'], now: BASE + (++epoch) * 100 * 3_600_000 }); };

test('N1. the figures are the last, 30-days-ago and 90-days-ago totals and the last 30 daily points', async (t) => {
  start(t); mode = 'ok';
  const n = await getDryPowderNumbers();
  assert.equal(n.current, 150e9 + 119e9); assert.equal(n.prev30, 150e9 + 89e9); assert.equal(n.prev90, 150e9 + 29e9);
  assert.equal(n.series.length, 30); assert.equal(n.series.at(-1), n.current);
});
test('N2. a series too short to read a 30-day change throws "Insufficient stablecoin data"', async (t) => {
  start(t); mode = 'short';
  await assert.rejects(getDryPowderNumbers(), /Insufficient stablecoin data/);
});
test('N3. the series is cached for a DAY: a second read an hour later does not fetch; one 25 h later does', async (t) => {
  start(t); mode = 'ok';
  await getDryPowderNumbers(); assert.equal(llamaReads, 1);
  t.mock.timers.tick(3_600_000); await getDryPowderNumbers(); assert.equal(llamaReads, 1, 'the series was refetched inside its 24 h cache');
  t.mock.timers.tick(25 * 3_600_000); await getDryPowderNumbers(); assert.equal(llamaReads, 2, 'the series was never refreshed after a day');
  assert.equal(DRY_POWDER_SERIES_TTL_MS, 24 * 60 * 60_000);
});
test('N4. a DeFi Llama failure is held for about a minute (not refetched on every card) and then retried; warm never throws', async (t) => {
  start(t); mode = 'down';
  await assert.rejects(getDryPowderNumbers()); assert.equal(llamaReads, 1);
  await assert.rejects(getDryPowderNumbers()); assert.equal(llamaReads, 1, 'a failing read was repeated on every call');
  t.mock.timers.tick(61_000); mode = 'ok';
  const n = await getDryPowderNumbers(); assert.ok(n.current > 0, 'a read after the hold did not recover'); assert.equal(llamaReads, 2);
  mode = 'down'; t.mock.timers.tick(25 * 3_600_000);
  assert.doesNotThrow(() => warmDryPowderSeries());
  await new Promise((r) => setImmediate(r));
});

const route = readFileSync(new URL('../app/api/dry-powder/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const at = (needle: string) => { const i = route.indexOf(needle); assert.ok(i > 0, `CONTROL: "${needle.slice(0, 60)}" not found in the route`); return i; };
test('R1. the numbers part returns BEFORE any reservation and AFTER the Pro gate and the auth checks, with no AI call in it', () => {
  const part = at("searchParams.get('part') === 'numbers'");
  assert.ok(at("PRO_REQUIRED") < part, 'the numbers part is reachable by a Free caller (the Pro gate is after it)');
  assert.ok(at("getUserCompatForBilledCall(token)") < part, 'the numbers part is ahead of the auth check');
  assert.ok(part < at("incrementToolUsage(authData.user.id, 'dryPowder'"), 'the numbers part spends a use');
  const branch = route.slice(part, route.indexOf('return NextResponse.json(await getDryPowderNumbers());', part) + 70);
  assert.equal(/xaiFetch|incrementToolUsage/.test(branch), false, 'the numbers branch calls xAI or reserves');
});
test('R2. the AI step has its own 25 s bound, and the figures come from the shared series (no second DeFi Llama read in the route)', () => {
  assert.ok(route.includes('const ANALYSIS_TIMEOUT_MS = 25_000;') && route.includes('signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),'), 'the AI step lost its bound');
  assert.equal(route.includes('stablecoins.llama.fi'), false, 'the route reads DeFi Llama itself again (the one-hour cache chain)');
});
test('R3. a reservation that was never billed goes back; billed is set only after the 2xx check', () => {
  assert.ok(route.includes("if (r && !billed) await refundToolUsage(authData.user.id, 'dryPowder', r.on);"), 'the refund path changed');
  assert.ok(at('billed = true;') > at('if (!aiRes.ok) {'), 'billed is set before the non-2xx check (a failed call would not be refunded)');
  assert.ok(at('reserved = { on };') > at("incrementToolUsage(authData.user.id, 'dryPowder'") && at('reserved = { on };') < at('await getDryPowderNumbers();'), 'the refund date is not captured at the reservation, before the series read');
});
test('R4. the AI text is cached an hour and only the cache-miss path reserves (a hit is free)', () => {
  assert.ok(route.includes('const CACHE_TTL = 60 * 60_000;'));
  assert.ok(at("cached('dry-powder', CACHE_TTL, async () => {") < at("incrementToolUsage(authData.user.id, 'dryPowder'"), 'the reservation is outside the cache miss: a cache hit would spend a use');
});
