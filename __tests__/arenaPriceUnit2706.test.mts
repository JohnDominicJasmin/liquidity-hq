/* QA: PR #2706, ONE PRICE UNIT ON THE ARENA FOR 1000x COINS (PM ruling A, 2026-11-20, QA drawings audit #1263: PEPE showed two scales on one screen).
 *
 * THE WRITTEN RULE (PM + Dev's PR): a 1000x contract (1000PEPE, 1000BONK, 10000SATS, 1000000MOG...) is charted on the exchange's own scaled series. Every price TEXT on the Arena screen (call box, Watching, EMA card entry / stop / target, the chart's EMA markers)
 * and every price the AI read quotes is in THAT unit, the unit of the coin's PRIMARY venue symbol (Bybit's when it lists the coin, else Binance's). Ordinary coins are untouched. The label carries the exchange's own prefix: 1000PEPE, 10000SATS, 1000000MOG.
 *   A1  arenaPriceUnit on a written table (pepe, bonk, floki, tag 1000 / sats 10000 / mog 1000000 / btc eth sol doge and an unknown id 1), plus the whole universe: exactly the coins whose primary symbol carries a power-of-ten prefix of 1000 or more are not 1, and each equals that prefix
 *   A2  fetchOHLCV (the candles the strategies and the EMA card read), venues stood in: 1000PEPE answers in the exchange unit (x1000 of per-token, price 3.8 not 0.0038), volume untouched; BTC unchanged; SATS read through Binance's 1000SATS fallback lands in Bybit's 10000SATS unit (the venues disagree on the denomination)
 *   A3  arenaNumberFields(row, unit): price, MA20, VWAP, POC / VAH / VAL scaled, every percentage and the text verdicts (ABOVE MA20 +x%, price ABOVE POC) identical to unit 1, unit 1 byte-identical to calling it with no unit
 *   A4  chartDisplaySymbol carries the exchange's own prefix (1000PEPE, 10000SATS, 1000000MOG, 1000TAG), ordinary and non-denomination digits (1INCH) keep none
 *   A5  the Arena page passes the unit to arenaNumberFields and scales the walls and the nearest level; the server read (arenaServerNumbers) passes arenaPriceUnit(coin)
 * WHAT THIS CANNOT PROVE: that the chart axis, the call box, Watching, the EMA card and the markers are on screen in one unit (the browser sign-off after promotion), nor the AI prompt's other price fields (fib, clusters) which are checked in the browser by reading the request the page builds. */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arenaPriceUnit, venueSymbols, chartDisplaySymbol, UNIVERSE_COINS } from '../lib/coins.ts';
import { arenaNumberFields } from '../lib/arenaContextFields.ts';
import * as nodeModule from 'node:module';
import { deadlineSignal } from '../lib/deadlineSignal.ts';
import { OKX_SYMS } from '../lib/coins.ts';
import { okxBarForBinanceInterval } from '../lib/okx.ts';
import { symbolDenominationFactor } from '../lib/coins.ts';
import { fetchBybitKlinesRetry } from '../lib/bybitKlines.ts';
import { firstVenueThatAnswers } from '../lib/venueFallback.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('A1. arenaPriceUnit: the written table, and the universe sweep', () => {
  const table: Record<string, number> = { pepe: 1000, bonk: 1000, floki: 1000, tag: 1000, sats: 10000, mog: 1_000_000, btc: 1, eth: 1, sol: 1, doge: 1, zzz_unknown: 1 };
  for (const [coin, want] of Object.entries(table)) assert.equal(arenaPriceUnit(coin), want, `${coin}`);
  const moved: string[] = [];
  for (const coin of UNIVERSE_COINS as string[]) {
    const v = venueSymbols(coin); const primary = v.bybit ?? v.binance ?? '';
    const m = /^(\d+)/.exec(primary); const n = m ? Number(m[1]) : 1; const denom = n >= 1000 && Number.isInteger(Math.log10(n)) ? n : 1;
    assert.equal(arenaPriceUnit(coin), denom, `${coin} (${primary})`);
    if (denom !== 1) moved.push(`${coin}:${denom}`);
  }
  console.log(`[A1] ${moved.length} of ${(UNIVERSE_COINS as string[]).length} coins move: ${moved.join(' ')}`);
  assert.ok(moved.length >= 10 && moved.length <= 20, 'the sweep must find the 1000x family (control: it is not empty and not everything)');
});

/* THE REAL fetchOHLCV, cut out of lib/useEMAStrategy.ts together with the venue fetchers it calls (the hook file itself cannot be imported by node: it value-imports types), run with the real
   helpers it depends on and the network stood in below. */
const emaSrc = read('lib/useEMAStrategy.ts');
const cutFrom = emaSrc.indexOf('async function fetchBinanceFuturesKlines('); const cutMark = 'export async function fetchOHLCV(';
const CLOSE = String.fromCharCode(10) + '}' + String.fromCharCode(10);   // a function's closing brace at column 0
const cutAt = emaSrc.indexOf(cutMark); const cutEnd = emaSrc.indexOf(CLOSE, cutAt) + CLOSE.length;
assert.ok(cutFrom > 0 && cutAt > cutFrom && cutEnd > cutAt, 'CONTROL: the fetchers were not found in lib/useEMAStrategy.ts');
const fetchSrc = stripTypeScriptTypes(emaSrc.slice(cutFrom, cutEnd)).replace('export async function fetchOHLCV(', 'async function fetchOHLCV(') + String.fromCharCode(10) + 'return fetchOHLCV;';
const fetchOHLCV = new Function('deadlineSignal', 'venueSymbols', 'OKX_SYMS', 'okxBarForBinanceInterval', 'symbolDenominationFactor', 'arenaPriceUnit', 'fetchBybitKlinesRetry', 'firstVenueThatAnswers', 'console', fetchSrc)(
  deadlineSignal, venueSymbols, OKX_SYMS, okxBarForBinanceInterval, symbolDenominationFactor, arenaPriceUnit, fetchBybitKlinesRetry, firstVenueThatAnswers, { warn: () => undefined, error: () => undefined },
) as (coin: string, bn: string, by: string, limit: number) => Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>;

/* ── A2: the candle feeds stood in ─────────────────────────────────────── */
const realFetch = globalThis.fetch;
const T0 = 1_700_000_000_000; const H = 3_600_000;
type Mode = { bybit: 'ok' | number; futures: 'ok' | number };
let mode: Mode = { bybit: 'ok', futures: 'ok' };
let priceBybit = 1; let priceFutures = 1; const asked: string[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url, 'http://localhost');
  const source = url.searchParams.get('source'); const sym = url.searchParams.get('symbol') ?? ''; asked.push(`${source}:${sym}`);
  const bar = (i: number, p: number) => [T0 + i * H, String(p), String(p * 1.01), String(p * 0.99), String(p), '1234'];
  if (source === 'bybit') { if (mode.bybit !== 'ok') return json(mode.bybit, {}); return json(200, { retCode: 0, result: { list: Array.from({ length: 5 }, (_, i) => bar(4 - i, priceBybit)) } }); }
  if (source === 'binance-futures') { if (mode.futures !== 'ok') return json(mode.futures, {}); return json(200, Array.from({ length: 5 }, (_, i) => bar(i, priceFutures))); }
  return json(400, { error: 'not stood in' });
}) as typeof fetch;
afterEach(() => { mode = { bybit: 'ok', futures: 'ok' }; asked.length = 0; });
test.after(() => { globalThis.fetch = realFetch; });
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

test('A2a. 1000PEPE candles come back in the exchange unit (x1000 of per-token), volume untouched', async () => {
  priceBybit = 3.8; const c = await fetchOHLCV('pepe', '1h', '60', 5);
  assert.equal(c.length, 5); assert.ok(asked.every((a) => a === 'bybit:1000PEPEUSDT'), `asked ${asked}`);
  for (const k of c) { assert.ok(near(k.close, 3.8), `close ${k.close}`); assert.ok(near(k.open, 3.8)); assert.ok(near(k.high, 3.8 * 1.01), `high ${k.high}`); assert.ok(near(k.low, 3.8 * 0.99)); assert.equal(k.volume, 1234, 'volume must not be scaled'); }
});
test('A2b. an ordinary coin is unchanged', async () => {
  priceBybit = 71_234.5; const c = await fetchOHLCV('btc', '1h', '60', 5); assert.ok(near(c.at(-1)!.close, 71_234.5)); assert.equal(c.at(-1)!.volume, 1234);
});
test('A2c. SATS read through Binance 1000SATS lands in Bybit\'s 10000SATS unit (Bybit down)', async () => {
  mode = { bybit: 502, futures: 'ok' }; priceFutures = 0.42;                         // 1000SATS on Binance: 0.42 per 1000 tokens = 0.00042 per token
  const c = await fetchOHLCV('sats', '1h', '60', 5);
  assert.ok(asked.some((a) => a === 'binance-futures:1000SATSUSDT'), `asked ${asked}`);
  assert.ok(near(c.at(-1)!.close, 4.2), `10000SATS unit: ${c.at(-1)!.close} (per token 0.00042 x 10000)`);
});
test('A2d. SATS from Bybit is already in the 10000SATS unit', async () => {
  priceBybit = 4.2; const c = await fetchOHLCV('sats', '1h', '60', 5); assert.ok(near(c.at(-1)!.close, 4.2), `${c.at(-1)!.close}`);
});

/* ── A3 ───────────────────────────────────────────────────────────────── */
const ROW = { price: 0.003802, ma20: 0.003700, vwap: 0.003750, poc: 0.003600, vah: 0.003900, val: 0.003500, change: 2.5, rsi14: 55.5, volRatio: 1.2 } as never;
test('A3. arenaNumberFields(row, 1000) quotes the 1000x unit, the % and verdicts do not move, unit 1 is unchanged', () => {
  const a = arenaNumberFields(ROW, 1000); const b = arenaNumberFields(ROW);
  console.log(`[A3] unit 1: price ${b.price} · ma20 ${b.ma20} · vwap ${b.vwap} · poc ${b.pocLine}\n[A3] unit 1000: price ${a.price} · ma20 ${a.ma20} · vwap ${a.vwap} · poc ${a.pocLine} · ${a.priceVsMA}`);
  assert.deepEqual(arenaNumberFields(ROW, 1), b, 'unit 1 must be byte-identical to no unit');
  assert.match(a.price, /3\.80/); assert.doesNotMatch(a.price, /0\.0038/);
  assert.match(a.ma20, /^\$3\.7$/); assert.match(a.vwap, /^\$3\.75\b/); assert.match(a.pocLine, /^\$3\.6 \| VAH \$3\.9 \| VAL \$3\.5\b/); assert.doesNotMatch(a.ma20 + a.vwap + a.pocLine, /0\.00\d/, 'a per-token price is still in the text');
  assert.equal(a.priceVsMA, b.priceVsMA, 'the % vs MA20 and its verdict are unit-free'); assert.equal(a.change24h, b.change24h); assert.equal(a.rsi14, b.rsi14); assert.equal(a.volRatio, b.volRatio);
  assert.equal(a.pocLine.includes('price ABOVE POC (bullish)'), b.pocLine.includes('price ABOVE POC (bullish)')); assert.equal(a.vwap.includes('price ABOVE VWAP'), b.vwap.includes('price ABOVE VWAP'));
  assert.equal(arenaNumberFields(undefined, 1000).price, '-', 'no row stays "-"');
  assert.equal(arenaNumberFields({ ...(ROW as object), ma20: undefined } as never, 1000).ma20, '-', 'a missing field stays "-", never 0');
});

/* ── A4 ───────────────────────────────────────────────────────────────── */
test('A4. the chart label carries the exchange\'s own prefix; ordinary and non-denomination digits keep none', () => {
  for (const [coin, want] of [['pepe', '1000PEPE/USDT'], ['bonk', '1000BONK/USDT'], ['floki', '1000FLOKI/USDT'], ['tag', '1000TAG/USDT'], ['sats', '10000SATS/USDT'], ['mog', '1000000MOG/USDT'], ['btc', 'BTC/USDT'], ['eth', 'ETH/USDT']] as const) assert.equal(chartDisplaySymbol(coin), want, coin);
  const digits = (UNIVERSE_COINS as string[]).filter((c) => /^\d/.test(venueSymbols(c).bybit ?? venueSymbols(c).binance ?? '') && arenaPriceUnit(c) === 1);
  console.log(`[A4] coins with leading digits that are NOT a denomination: ${digits.join(', ') || 'none'}`);
  for (const c of digits) { const sym = (venueSymbols(c).bybit ?? venueSymbols(c).binance ?? '').replace(/USDT$/, ''); assert.equal(chartDisplaySymbol(c).toUpperCase(), `${sym}/USDT`.toUpperCase(), `${c}: the label must be the symbol's own digits, no multiplier added`); }
});

/* ── A5 ───────────────────────────────────────────────────────────────── */
test('A5. the Arena page and the server read pass the unit', () => {
  const page = read('app/(main)/arena/page.tsx');
  assert.match(page, /const priceUnit = arenaPriceUnit\(selectedCoin\)/); assert.match(page, /arenaNumberFields\(coin, priceUnit\)/);
  assert.match(page, /priceText\(nearest\.price \* priceUnit\)/); assert.equal((page.match(/priceText\(w\.price \* priceUnit\)/g) ?? []).length, 2, 'both wall lists are scaled');
  const server = read('lib/arenaServerNumbers.ts'); assert.match(server, /arenaNumberFields\(row, arenaPriceUnit\(coin\)\)/);
});
