import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fundingClassRelative, fetchFundingHistory, FUNDING_EXTREME_SHARE, FUNDING_MIN_POINTS, type FundingPoint } from '../lib/strategies/liveInputs.ts';
import { detectFundingOiSqueeze, FUNDING_OI_SQUEEZE, MIN_CANDLES } from '../lib/strategies/fundingOiSqueeze.ts';

/* #2686 (QA audit #1263, 2026-11-20: funding_oi_squeeze silent on every timeframe for SOL XRP SUI BNB MSTR TSLA): THE SQUEEZE SAYS WHY IT CANNOT FIRE, AND THE FUNDING HISTORY STOPS ASKING A ROUTE THAT IS REFUSED. Written rule (Dev's finding + PM 2026-11-19): the strict rule is UNCHANGED (extreme = at least 95% of the coin's last-90-day settlements STRICTLY beyond the live rate); a rate that EQUALS the coin's own top (or bottom) value, with so many settlements tied that the strict rule can never hold, is reported as PINNED and the WAIT says so; a tokenized stock whose funding is mostly zero says that instead; otherwise the old "not extreme" line. The Binance funding route that answers 502 from our hosts is skipped for 30 minutes after its first page fails, and the history comes straight from Bybit.
 *   P1 fundingClassRelative: the classes and the pinned flag on tables, the strict rule untouched, no reading with too little history   P2 detectFundingOiSqueeze: which WAIT params and which label key   P3 fetchFundingHistory with the proxy stood in: Binance 502 -> Bybit, blocked 30 min, asked again after   P4 the labels: keys registered, English text in the defaults, migration holds the same text for PROD and DEV in all five locales */
const DAY = 86_400_000, NOW = 1_800_000_000_000;
const hist = (n: number, rate: (i: number) => number, spanDays = 90): FundingPoint[] => Array.from({ length: n }, (_, i) => ({ time: NOW - spanDays * DAY + Math.round((i / (n - 1)) * (spanDays * DAY - 1000)), rate: rate(i) }));
const CEIL = 0.0001;

test('P1. fundingClassRelative: strict extreme unchanged; ties at the top/bottom are PINNED, never extreme; no reading without enough history', () => {
  /* SOL-like: 25% of 300 settlements sit exactly at the ceiling, the rest lower */
  const sol = hist(300, (i) => (i % 4 === 0 ? CEIL : 0.00002 + (i % 7) * 0.000005)); const r = fundingClassRelative(CEIL, sol, NOW)!;
  assert.equal(r.fundingClass, 'none', 'ties at the ceiling must NOT count as strictly lower'); assert.equal(r.fundingPinned, true, 'the ceiling rate with 25% ties is PINNED'); assert.equal(r.fundingPct, 0.01);
  /* a genuinely extreme rate: above 96% of the history */
  const calm = hist(300, (i) => 0.00001 + (i % 10) * 0.000002); const hot = fundingClassRelative(0.0005, calm, NOW)!; assert.equal(hot.fundingClass, 'longs_heavy'); assert.equal(hot.fundingPinned, undefined, 'an extreme rate is not "pinned"');
  const cold = fundingClassRelative(-0.0005, hist(300, (i) => -0.00001 - (i % 10) * 0.000002), NOW)!; assert.equal(cold.fundingClass, 'shorts_heavy'); assert.equal(cold.fundingPinned, undefined);
  /* mid-range: neither extreme nor pinned */
  const mid = fundingClassRelative(0.00003, hist(300, (i) => (i % 2 ? 0.00001 : 0.00006)), NOW)!; assert.deepEqual([mid.fundingClass, mid.fundingPinned], ['none', undefined]);
  /* negative floor pinned: 30% of settlements exactly at the floor, rest higher */
  const floor = hist(300, (i) => (i % 10 < 3 ? -CEIL : -0.00002 + (i % 5) * 0.000004)); const fl = fundingClassRelative(-CEIL, floor, NOW)!; assert.deepEqual([fl.fundingClass, fl.fundingPinned], ['none', true]);
  /* zero is never pinned (a tokenized stock at 0 gets its own sentence) */
  const stock = hist(300, (i) => (i % 2 ? 0 : 0.00001)); const z = fundingClassRelative(0, stock, NOW)!; assert.deepEqual([z.fundingClass, z.fundingPinned], ['none', undefined]);
  /* the 95% boundary: below + tied must reach it, strictly-below alone decides the class */
  const edge = hist(200, (i) => (i < 188 ? 0.00001 : CEIL)); const e = fundingClassRelative(CEIL, edge, NOW)!; assert.equal(e.fundingClass, 'none', '94% strictly lower: not extreme'); assert.equal(e.fundingPinned, true, '94% + 6% tied = 100%: pinned');
  const lowShare = hist(200, (i) => (i < 100 ? 0.00001 : i < 160 ? 0.0002 : CEIL)); const ls = fundingClassRelative(CEIL, lowShare, NOW)!; assert.deepEqual([ls.fundingClass, ls.fundingPinned], ['none', undefined], '50% below + 20% tied = 70% (30% are ABOVE the rate): not pinned');
  assert.equal(FUNDING_EXTREME_SHARE, 0.95, 'the strict rule threshold must stay');
  /* no reading */
  assert.equal(fundingClassRelative(CEIL, hist(FUNDING_MIN_POINTS - 1, () => 0.00001), NOW), null, 'too few settlements'); assert.equal(fundingClassRelative(CEIL, hist(200, () => 0.00001, 10), NOW), null, 'history does not reach back 30 days'); assert.equal(fundingClassRelative(null, sol, NOW), null); assert.equal(fundingClassRelative(CEIL, null, NOW), null);
});

const candles = Array.from({ length: MIN_CANDLES + 10 }, (_, i) => ({ time: NOW + i * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
const ctx = (o: Record<string, unknown>) => ({ coin: 'sol', tf: '1h', tfMs: 3_600_000, fundingClass: 'none', oiExtreme: false, ...o }) as never;
const keyOf = (r: { params: Record<string, unknown> }) => FUNDING_OI_SQUEEZE.reasonKeyFor!(r as never);
test('P2. the squeeze WAIT says why: pinned, tokenized stock, or the old "not extreme"; unchanged for live-missing / OI / trigger', () => {
  const pinned = detectFundingOiSqueeze(candles, ctx({ fundingPinned: true })); assert.equal(keyOf(pinned as never), 'STRAT_SQUEEZE_WAIT_FUNDING_PINNED');
  const stock = detectFundingOiSqueeze(candles, ctx({ coin: 'aapl' })); assert.equal(keyOf(stock as never), 'STRAT_SQUEEZE_WAIT_FUNDING_STOCK', 'a tokenized stock with no pinned flag says its funding is often zero');
  const both = detectFundingOiSqueeze(candles, ctx({ coin: 'aapl', fundingPinned: true })); assert.equal(keyOf(both as never), 'STRAT_SQUEEZE_WAIT_FUNDING_PINNED', 'pinned wins over the stock line');
  const plain = detectFundingOiSqueeze(candles, ctx({})); assert.equal(keyOf(plain as never), 'STRAT_SQUEEZE_WAIT_FUNDING', 'a crypto coin with ordinary funding keeps the old line');
  assert.equal(keyOf(detectFundingOiSqueeze(candles, ctx({ fundingClass: undefined })) as never), 'STRAT_SQUEEZE_NO_LIVE', 'missing live input stays "needs live data"'); assert.equal(keyOf(detectFundingOiSqueeze(candles, ctx({ fundingClass: 'longs_heavy', oiExtreme: false })) as never), 'STRAT_SQUEEZE_WAIT_OI');
  for (const r of [pinned, stock, both, plain]) assert.ok(!('direction' in (r as object)) || (r as { direction?: unknown }).direction == null, 'a WAIT must not carry a trade direction');
});

const realFetch = globalThis.fetch;
const net = { binance: 0, bybit: 0, mode: 'binance502' as 'binance502' | 'binanceOk' | 'bothFail' };
const settlements = (n: number) => Array.from({ length: n }, (_, i) => ({ fundingRate: '0.00005', fundingRateTimestamp: String(NOW - (n - i) * 8 * 3_600_000), fundingTime: NOW - (n - i) * 8 * 3_600_000 }));
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.includes('type=funding-rate-1')) { net.binance++; return net.mode === 'binanceOk' ? new Response(JSON.stringify(settlements(150)), { status: 200 }) : new Response('{}', { status: 502 }); }
  if (u.includes('type=funding-history')) { net.bybit++; return net.mode === 'bothFail' ? new Response('{}', { status: 502 }) : new Response(JSON.stringify({ result: { list: settlements(150).reverse().slice(0, 150) } }), { status: 200 }); }
  throw new Error('stray request ' + u);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
test('P3. a refused Binance funding route is skipped for 30 minutes and the history comes from Bybit; asked again after the block ends', async (t) => {
  const T0 = NOW + 400 * DAY; t.mock.timers.enable({ apis: ['Date'], now: T0 });
  net.binance = 0; net.bybit = 0; net.mode = 'binance502';
  const a = await fetchFundingHistory('sol', undefined, T0); assert.ok(a && a.length > 100, 'Bybit must supply the history when Binance refuses'); assert.equal(net.binance, 1, 'Binance is tried once, one page'); assert.ok(net.bybit >= 1);
  const b = await fetchFundingHistory('eth', undefined, T0 + 60_000); assert.ok(b && b.length > 100); assert.equal(net.binance, 1, 'a second coin inside 30 minutes must not ask the refused route again');
  t.mock.timers.tick(29 * 60_000); const c = await fetchFundingHistory('xrp', undefined, T0 + 29 * 60_000); assert.ok(c); assert.equal(net.binance, 1, 'still blocked at 29 minutes');
  t.mock.timers.tick(2 * 60_000); net.mode = 'binanceOk'; const d = await fetchFundingHistory('doge', undefined, T0 + 31 * 60_000); assert.ok(d && d.length === 150); assert.equal(net.binance, 2, 'asked again after the block');
  net.mode = 'bothFail'; t.mock.timers.tick(31 * 60_000); assert.equal(await fetchFundingHistory('avax', undefined, T0 + 62 * 60_000), null, 'both sources failing is no reading, never a guess');
});

test('P4. the labels: keys registered, English in the defaults, the held migration carries the same text for PROD and DEV in en/ko/zh/ru/ar', () => {
  const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>; const keys = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261126a_labels_squeeze_says_why.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(defaults.STRAT_SQUEEZE_WAIT_FUNDING_PINNED, 'Funding equals its usual top readings for this coin, so it cannot stand out.'); assert.equal(defaults.STRAT_SQUEEZE_WAIT_FUNDING_STOCK, 'Funding on a tokenized stock is often zero, so it rarely stands out.');
  const prod = sql.slice(sql.indexOf('===== PROD ====='), sql.indexOf('===== DEV =====')), dev = sql.slice(sql.indexOf('===== DEV ====='));
  for (const k of ['STRAT_SQUEEZE_WAIT_FUNDING_PINNED', 'STRAT_SQUEEZE_WAIT_FUNDING_STOCK']) { assert.ok(keys.includes(`'${k}'`), `${k} is not a registered label key`); for (const [name, block, table] of [['PROD', prod, 'lhq_labels'], ['DEV', dev, 'lhq_dev_labels']] as const) { assert.ok(block.includes(`insert into ${table} (key, locale, value) values`), `${name}: wrong table`); for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) assert.ok(new RegExp(`\\('${k}','${loc}','[^']+'\\)`).test(block), `${name}: ${k} has no ${loc} row`); assert.ok(block.includes(`('${k}','en','${defaults[k]}')`), `${name}: the en row differs from the defaults`); } }
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/, 'the migration header no longer says it is held'); assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2, 'both blocks must upsert (re-running must be safe)');
});
