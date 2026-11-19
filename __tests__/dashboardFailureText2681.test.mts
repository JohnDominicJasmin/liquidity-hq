import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMarketRead } from '../lib/marketRead.ts';
import { defaultStore, type CoinData, type MarketStore } from '../lib/marketStore.ts';
import { ageLabel } from '../lib/ageLabel.ts';
import { readPerpSpot, perpSpotFetchedAt } from '../lib/usePerpSpot.ts';

/* #2681 (#1185 audit D1 D3 D5 D13-D18 D22, owner's feature-freeze order): THE DASHBOARD KEEPS WHAT IT HAD AND RETRIES, INSTEAD OF SHOWING FAILURE TEXT. Written rule (PR body), pinned where it is pure code:
 *   M  Market read (D1/D5): once the dashboard's wait is over (partial mode) a coin with no funding rate is scored WITHOUT funding (the maximum drops by the funding share, like missing walls) and shows no funding factor; a missing Fear & Greed still has no read (global, recovers); without partial the read still waits for funding (#1494)
 *   A  age label: just now under 60 s, N min ago under an hour, else N h ago, clamped at 0, reusing the Arena freshness labels (no new copy)
 *   P  Perps vs spot (D22): a TRANSIENT failure (network, timeout, 408, 429, 5xx) is never cached for the hour: it returns the last good reading (up to 6 h old) or "no reading", and the next try is allowed after a minute; a 4xx other than 408/429 (no such market) IS an answer and is kept for the hour; a good read replaces everything and clears the retry hold
 *   G  the grace hook restarts its wait when the key changes (a coin switch), and the panel components use it
 * THE REAL lib code runs (the klines route stood in). NOT covered here (browser cells / needs the DOM): the Macro and Econ widgets' retries and the right-rail spacing when a card hides. */
const realFetch = globalThis.fetch;
const net = { calls: 0, mode: 'ok' as 'ok' | 'http500' | 'http429' | 'http408' | 'http404' | 'throws' };
const HOUR = 3_600_000;
const bars = (nowMs: number) => Array.from({ length: 168 }, (_, i) => { const t = Math.floor(nowMs / HOUR) * HOUR - (168 - i) * HOUR; return [t, '1', '1', '1', '1', '0', t + HOUR - 1, String(10_000_000), 1, '0', String(5_000_000), '0']; });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input); if (!u.includes('/api/market/klines')) throw new Error('stray request ' + u);
  net.calls++; if (net.mode === 'throws') throw new Error('network down');
  if (net.mode !== 'ok') return new Response('{}', { status: Number(net.mode.replace('http', '')) });
  const perp = u.includes('source=binance-futures'); const now = Date.now(); const rows = bars(now).map((r) => (perp ? [...r.slice(0, 7), String(10_000_000 * 7.8), ...r.slice(8)] : r));
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

let epoch = 0; const BASE = 1_800_000_000_000;
const start = (t: TestContext) => { net.calls = 0; net.mode = 'ok'; try { t.mock.timers.reset(); } catch { /* none */ } const now = BASE + (++epoch) * 1000 * HOUR + 30 * 60_000; t.mock.timers.enable({ apis: ['Date'], now }); return now; };
const coinN = (n: number) => ['btc', 'eth', 'sol', 'xrp', 'bnb', 'doge', 'ada', 'avax'][n];
let coinIdx = 0; const fresh = () => coinN(coinIdx++ % 8);

test('A. ageLabel: just now, N min ago, N h ago, clamped at 0', () => {
  const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}:${v.n}` : k);
  for (const [ms, want] of [[-5_000, 'ARENA_FRESHNESS_JUST_NOW'], [0, 'ARENA_FRESHNESS_JUST_NOW'], [59_999, 'ARENA_FRESHNESS_JUST_NOW'], [60_000, 'ARENA_FRESHNESS_MINUTES_AGO:1'], [12 * 60_000, 'ARENA_FRESHNESS_MINUTES_AGO:12'], [3_599_999, 'ARENA_FRESHNESS_MINUTES_AGO:59'], [3_600_000, 'ARENA_FRESHNESS_HOURS_AGO:1'], [3 * 3_600_000 + 5, 'ARENA_FRESHNESS_HOURS_AGO:3'], [30 * 3_600_000, 'ARENA_FRESHNESS_HOURS_AGO:30']] as const) assert.equal(ageLabel(ms, t as never), want, `${ms} ms`);
});

function coin(o: Partial<CoinData> = {}): CoinData { return { price: 100, change: 0, high: 100, low: 100, fundingRate: null, oi: null, vol24: null, volRatio: null, longRatio: null, shortRatio: null, bnLongRatio: null, bnShortRatio: null, bnWhaleLongRatio: null, bnWhaleShortRatio: null, rsi14: null, ma20: null, perpPrice: null, rsi5m: null, rsi1h: null, rsi4h: null, rsi1d: null, rsiDaily: null, rsiWeekly: null, rsiMonthly: null, cvd: null, cvdDivergence: null, poc: null, vah: null, val: null, orderBidWalls: null, orderAskWalls: null, vwap: null, oiTrend: null, takerBuyRatio: null, chartPattern: null, nextFrEstimate: null, nextFundingTime: null, liqDelta: null, liqLongUsd: null, liqShortUsd: null, ...o } as CoinData; }
const store = (fng: number | null, btc: CoinData): MarketStore => ({ ...defaultStore, selectedCoin: 'btc', fng, coins: { btc } });
test('M. computeMarketRead partial: no funding left out of the score, no funding factor; Fear & Greed still required; default unchanged', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 8, 30, 12, 0, 0) });   // Wednesday noon UTC: time 10 + day 10
  const noFund = store(62, coin({ fundingRate: null })), withFund = store(62, coin({ fundingRate: 0.0003 }));
  const def = computeMarketRead(noFund); assert.equal(def.pending, true, 'without partial the read still waits for funding'); assert.deepEqual(def.missing, ['funding']); assert.equal(def.score, null);
  const part = computeMarketRead(noFund, null, { partial: true }); assert.equal(part.pending, false, 'partial: funding left out, not waited on'); assert.deepEqual(part.missing, []);
  assert.equal(part.score, Math.round(((10 + 10 + 18) / (30 + 15 + 25)) * 100), 'the score is (time + day + F&G) over the maximum WITHOUT the funding 30'); assert.equal(part.factors.some((f) => f.key === 'fund'), false, 'no funding factor when it is left out'); assert.ok(part.band);
  const full = computeMarketRead(withFund), fullPartial = computeMarketRead(withFund, null, { partial: true }); assert.deepEqual(fullPartial, full, 'with funding present partial changes nothing'); assert.equal(full.factors.some((f) => f.key === 'fund'), true);
  const noFng = computeMarketRead(store(null, coin({ fundingRate: null })), null, { partial: true }); assert.equal(noFng.pending, true, 'a missing Fear & Greed still has no read'); assert.deepEqual(noFng.missing, ['fng'], 'funding is not listed as missing when it is left out'); assert.match(noFng.sub, /^Waiting for Fear & Greed data before giving a read\.$/);
  const bothMissing = computeMarketRead(store(null, coin({ fundingRate: null }))); assert.deepEqual([...bothMissing.missing].sort(), ['fng', 'funding'], 'default lists everything that is missing'); assert.equal(bothMissing.pending, true);
  assert.equal(computeMarketRead(store(null, coin({ fundingRate: 0.0003 })), null, { partial: true }).pending, true);
});

test('P1. a good read is cached for the hour (one fetch pair), and perpSpotFetchedAt says when', async (t) => {
  const now = start(t); const c = fresh(); const a = await readPerpSpot(c); assert.equal(a.lean, 'normal'); const calls = net.calls; assert.ok(calls >= 2, 'spot and perp are both read');
  t.mock.timers.tick(20 * 60_000); const b = await readPerpSpot(c); assert.equal(net.calls, calls, 'a second read inside the hour fetched again'); assert.deepEqual(b, a); assert.ok(perpSpotFetchedAt(c)! >= now);
});
test('P2. a transient failure with nothing earlier is NOT cached: no reading now, no fetch for a minute, then a retry that heals', async (t) => {
  for (const mode of ['http500', 'http429', 'http408', 'throws'] as const) {
    const now = start(t); void now; const c = fresh(); net.mode = mode; const r = await readPerpSpot(c); assert.equal(r.lean, 'unknown', `${mode}: no reading`); assert.equal(perpSpotFetchedAt(c), null, `${mode}: a failed read must not be cached for the hour`);
    const calls = net.calls; t.mock.timers.tick(30_000); await readPerpSpot(c); assert.equal(net.calls, calls, `${mode}: asked the source again inside the minute`);
    t.mock.timers.tick(31_000); net.mode = 'ok'; const healed = await readPerpSpot(c); assert.equal(healed.lean, 'normal', `${mode}: did not heal after the minute`); assert.ok(perpSpotFetchedAt(c) !== null);
  }
});
test('P3. a 4xx (no such market) IS an answer: cached "no reading" for the hour, not retried every minute', async (t) => {
  start(t); const c = fresh(); net.mode = 'http404'; const r = await readPerpSpot(c); assert.equal(r.lean, 'unknown'); assert.ok(perpSpotFetchedAt(c) !== null, 'the "no market" answer must be kept'); const calls = net.calls;
  t.mock.timers.tick(10 * 60_000); net.mode = 'ok'; const again = await readPerpSpot(c); assert.equal(net.calls, calls, 'a no-market coin was re-read inside the hour'); assert.equal(again.lean, 'unknown');
});
test('P4. an earlier good reading survives later transient failures up to 6 hours; past that "no reading" is more honest', async (t) => {
  start(t); const c = fresh(); const good = await readPerpSpot(c); assert.equal(good.lean, 'normal'); net.mode = 'http500';
  t.mock.timers.tick(HOUR + 60_000); const next = await readPerpSpot(c); assert.deepEqual(next, good, 'the last good reading was replaced by the failure (the old behaviour)');
  t.mock.timers.tick(4 * HOUR); const stillGood = await readPerpSpot(c); assert.deepEqual(stillGood, good, '5 hours old: still kept');
  t.mock.timers.tick(2 * HOUR); const tooOld = await readPerpSpot(c); assert.equal(tooOld.lean, 'unknown', 'older than 6 hours must not be served as current');
  net.mode = 'ok'; t.mock.timers.tick(61_000); assert.equal((await readPerpSpot(c)).lean, 'normal', 'a later success replaces everything');
});
test('P5. a coin with no Binance symbol is "no reading", cached, with no request', async (t) => {
  start(t); const r = await readPerpSpot('zzz-not-a-coin'); assert.equal(r.lean, 'unknown'); assert.equal(net.calls, 0); assert.ok(perpSpotFetchedAt('zzz-not-a-coin') !== null);
});

test('G. the grace hook restarts its wait on a key change, and the panels pass the coin as the key', () => {
  const g = readFileSync(new URL('../lib/useGrace.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); assert.match(g, /export function useGraceElapsed\(ms = 15_000, resetKey\?: unknown\): boolean \{/); assert.match(g, /setDoneFor\(\{ key: resetKey \}\)/); assert.match(g, /return doneFor !== null && Object\.is\(doneFor\.key, resetKey\);/); assert.match(g, /\}, \[ms, resetKey\]\);/);
  const dash = readFileSync(new URL('../components/DashboardTerminal.tsx', import.meta.url), 'utf8'); assert.match(dash, /useGraceElapsed\([^)]*\)/); assert.match(readFileSync(new URL('../components/MarketRead.tsx', import.meta.url), 'utf8'), /partial: true|\{ partial/, 'the Market Read card turns partial mode on after its wait');
});
