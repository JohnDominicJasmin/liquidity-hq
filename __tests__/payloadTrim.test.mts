/* #2422 (#1651 medium): the server sends sums and trimmed lists instead of whole raw payloads. Expectations are the CONTRACTS Dev stated, written as literals; nothing is computed with the code under test.
 *   A  lib/aggTradesSummary.ts summarizeAggTrades: buy/sell sums equal the old per-trade sums (m true = the taker SOLD), whales = every trade with price x quantity >= 500,000 INCLUDING its id, maxId = the
 *      largest id (null for an empty window), a trade that does not parse counts for nothing (never NaN).
 *   B  lib/payloadTrim.ts: trimBybitTickers keeps exactly BYBIT_TICKER_FIELDS (13), trimDeribitBook exactly 4, trimLlamaStables only USDT and USDC with symbol + the three circulating readings; a body it does not
 *      recognise comes back UNTOUCHED (the same object, ===), so a changed upstream shape reaches the caller as it is.
 *   C  the proxy route, run for real with a stand-in network: the Bybit fallback conversion is still served, X-Data-Source: bybit-fallback is still set on it, and the response is application/json; a
 *      primary answer is trimmed BEFORE it is cached and served.
 * WHAT IT CANNOT PROVE: that the browser reads the trimmed shape correctly (that is the CVD sweep's own cell, qa/e2e/_fixtures.ts), or any byte saving on a real network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { summarizeAggTrades, WHALE_USD_THRESHOLD } from '../lib/aggTradesSummary.ts';
import { trimBybitTickers, trimDeribitBook, trimLlamaStables, BYBIT_TICKER_FIELDS, DERIBIT_BOOK_FIELDS } from '../lib/payloadTrim.ts';

/* ── A: the summary ──────────────────────────────────────────────────────────────── */

test('A1. buy and sell sums: m true is a SELL, m false a BUY, summed from the base quantity', () => {
  const s = summarizeAggTrades([
    { a: 10, m: false, q: '1.5', p: '100' }, { a: 11, m: true, q: '2', p: '100' }, { a: 12, m: false, q: '0.25', p: '100' }, { a: 13, m: true, q: '0.5', p: '100' },
  ]);
  assert.equal(s.buyVol, 1.75); assert.equal(s.sellVol, 2.5);
});

test('A2. whales: EVERY trade at or above $500,000 with its id, and nothing below it', () => {
  assert.equal(WHALE_USD_THRESHOLD, 500_000);
  const s = summarizeAggTrades([
    { a: 1, m: false, q: '10', p: '50000' },        // exactly 500,000: a whale
    { a: 2, m: true, q: '9.99', p: '50000' },       // 499,500: not
    { a: 3, m: true, q: '20', p: '60000' },         // 1,200,000: a whale
    { a: 4, m: false, q: '1', p: '1000' },
  ]);
  assert.deepEqual(s.whales, [{ a: 1, m: false, q: 10, p: 50000 }, { a: 3, m: true, q: 20, p: 60000 }]);
});

test('A3. maxId is the largest id; null for an empty window; ids need not be in order', () => {
  assert.equal(summarizeAggTrades([{ a: 5, m: false, q: '1', p: '1' }, { a: 99, m: true, q: '1', p: '1' }, { a: 7, m: false, q: '1', p: '1' }]).maxId, 99);
  const e = summarizeAggTrades([]); assert.equal(e.maxId, null); assert.equal(e.buyVol, 0); assert.equal(e.sellVol, 0); assert.deepEqual(e.whales, []);
  assert.equal(summarizeAggTrades([{ a: -3, m: false, q: '1', p: '1' }, { a: -1, m: true, q: '1', p: '1' }]).maxId, -1, 'a Bybit-fallback trade carries a negative id');
});

test('A4. a trade that does not parse counts for nothing, and never turns a sum into NaN', () => {
  const s = summarizeAggTrades([{ a: 1, m: false, q: 'x', p: '100' }, { a: 2, m: false, q: '2', p: 'oops' }, { a: 3, m: true, q: '3', p: '10' }]);
  assert.equal(s.buyVol, 0); assert.equal(s.sellVol, 3); assert.deepEqual(s.whales, []);
  assert.ok(Number.isFinite(s.buyVol) && Number.isFinite(s.sellVol));
});

/* ── B: the trims ────────────────────────────────────────────────────────────────── */

test('B1. trimBybitTickers keeps exactly the 13 fields and nothing else, per contract', () => {
  assert.deepEqual([...BYBIT_TICKER_FIELDS].sort(), ['fundingRate', 'highPrice24h', 'indexPrice', 'lastPrice', 'lowPrice24h', 'markPrice', 'nextFundingTime', 'openInterest', 'openInterestValue', 'price24hPcnt', 'symbol', 'turnover24h', 'fundingIntervalHour'].sort());
  const row: Record<string, string> = { symbol: 'BTCUSDT', lastPrice: '1', indexPrice: '2', markPrice: '3', openInterest: '4', openInterestValue: '5', fundingRate: '6', nextFundingTime: '7', highPrice24h: '8', lowPrice24h: '9', price24hPcnt: '10', turnover24h: '11', fundingIntervalHour: '4', volume24h: '12', bid1Price: '13', ask1Price: '14', prevPrice24h: '15', usdIndexPrice: '16' };
  const out = trimBybitTickers({ retCode: 0, result: { category: 'linear', list: [row, { ...row, symbol: 'ETHUSDT' }] }, time: 1 }) as { retCode: number; time: number; result: { category: string; list: Array<Record<string, string>> } };
  assert.equal(out.retCode, 0); assert.equal(out.time, 1); assert.equal(out.result.category, 'linear');
  assert.equal(out.result.list.length, 2);
  for (const t of out.result.list) assert.deepEqual(Object.keys(t).sort(), [...BYBIT_TICKER_FIELDS].sort());
  assert.equal(out.result.list[1].symbol, 'ETHUSDT');
});

/* #1651 owner item 91: the trim dropped fundingIntervalHour, so the browser scaled every rate by 1 and a 4 hour contract showed half its per-8-hours funding. B1 pinned the list as written, which is why it stayed green; B1b pins the list against what the page READS. */
const MP = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('B1b. every field the page reads off a Bybit ticker is a field the trim keeps', () => {
  const from = MP.indexOf('const fetchBybit = useCallback('), to = MP.indexOf('const bnOnly = Object.keys(UNIVERSE_BINANCE_ONLY)');
  assert.ok(from > 0 && to > from, 'CONTROL: the Bybit ticker fill was not found in MarketProvider');
  const read = [...new Set([...MP.slice(from, to).matchAll(/\b(?:item|t)\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
  assert.ok(read.includes('fundingRate') && read.includes('fundingIntervalHour') && read.length >= 12, `CONTROL: the scan found only ${read.join(', ')}`);
  assert.deepEqual(read.filter((f) => !(BYBIT_TICKER_FIELDS as readonly string[]).includes(f)), [], 'read by the page and dropped by the trim');
});

test('B1c. a trimmed 4 hour ticker, put through the page\'s own scaling, reads per 8 hours (1 hour x8, 8 hours unchanged)', () => {
  /* The slice is OUR OWN checked-in source, never input. */
  const strip = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
  const a = MP.indexOf('function fundingScaleTo8h('); assert.ok(a > 0, 'CONTROL: fundingScaleTo8h not found');
  const scale = new Function(`return (${strip(MP.slice(a, MP.indexOf('\n}\n', a) + 3)).replace(/^function fundingScaleTo8h/, 'function')});`)() as (h: unknown) => number;
  const list = [['PYTHUSDT', '0.00005', '4'], ['XUSDT', '0.00001', '1'], ['BTCUSDT', '0.00004', '8']].map(([symbol, fundingRate, fundingIntervalHour]) => ({ symbol, fundingRate, fundingIntervalHour, volume24h: '1' }));
  const out = trimBybitTickers({ retCode: 0, result: { list } }) as { result: { list: Array<Record<string, string>> } };
  const per8h = out.result.list.map((t) => Number((parseFloat(t.fundingRate) * scale(t.fundingIntervalHour)).toFixed(8)));
  assert.deepEqual(per8h, [0.0001, 0.00008, 0.00004]);
});

test('B2. trimDeribitBook keeps exactly the 4 fields', () => {
  assert.deepEqual([...DERIBIT_BOOK_FIELDS].sort(), ['instrument_name', 'mark_iv', 'open_interest', 'underlying_price']);
  const out = trimDeribitBook({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-1', open_interest: 1, mark_iv: 2, underlying_price: 3, volume: 4, bid_price: 5, creation_timestamp: 6 }] }) as { jsonrpc: string; result: Array<Record<string, unknown>> };
  assert.equal(out.jsonrpc, '2.0');
  assert.deepEqual(out.result, [{ instrument_name: 'BTC-1', open_interest: 1, mark_iv: 2, underlying_price: 3 }]);
});

test('B3. trimLlamaStables keeps only USDT and USDC, each with symbol and the three circulating readings', () => {
  const coin = (symbol: string) => ({ symbol, circulating: { peggedUSD: 1 }, circulatingPrevWeek: { peggedUSD: 2 }, circulatingPrevMonth: { peggedUSD: 3 }, name: 'x', gecko_id: 'y', chains: ['a'], price: 1 });
  const out = trimLlamaStables({ peggedAssets: [coin('DAI'), coin('USDT'), coin('FRAX'), coin('USDC')] }) as { peggedAssets: Array<Record<string, unknown>> };
  assert.deepEqual(out.peggedAssets.map((a) => a.symbol), ['USDT', 'USDC']);
  for (const a of out.peggedAssets) assert.deepEqual(Object.keys(a).sort(), ['circulating', 'circulatingPrevMonth', 'circulatingPrevWeek', 'symbol']);
});

test('B4. a body a trim does not recognise comes back UNTOUCHED (the same object)', () => {
  const odd: unknown[] = [null, 'text', 42, [], {}, { result: 'nope' }, { result: { list: 'nope' } }, { result: {} }, { peggedAssets: 'x' }];
  for (const o of odd) {
    assert.equal(trimBybitTickers(o), o, `trimBybitTickers changed ${JSON.stringify(o)}`);
    assert.equal(trimDeribitBook(o), o, `trimDeribitBook changed ${JSON.stringify(o)}`);
    assert.equal(trimLlamaStables(o), o, `trimLlamaStables changed ${JSON.stringify(o)}`);
  }
});

/* ── C: the proxy route, for real, against a stand-in network ─────────────────────── */

const realFetch = globalThis.fetch;
type Hit = { url: string };
const hits: Hit[] = [];
let plan: (url: string) => Response | null = () => null;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  hits.push({ url });
  const r = plan(url);
  if (!r) throw new Error(`stand-in network has no answer for ${url}`);
  return r;
}) as typeof fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const { NextRequest } = await import('next/server');
const { GET } = await import('../app/api/proxy/route.ts');
let n = 0;
const call = (qs: string) => GET(new NextRequest(`http://localhost/api/proxy?${qs}`, { headers: { 'x-forwarded-for': `10.9.${Math.floor(++n / 250)}.${n % 250}` } }));

/* ORDER MATTERS: C1 makes Binance answer 418, and the exchange guard (lib/exchangeGuard.ts) then treats Binance as banned for a while, so a primary read after it is refused (502). The primary-path case goes FIRST. */
test('C2. a primary Binance answer carries NO fallback header and is application/json', async () => {
  plan = (u) => u.includes('api.binance.com') ? json([{ symbol: 'ETHUSDT', lastPrice: '3000' }]) : null;
  const r = await call('type=binance-24hr&symbols=ETHUSDT'); // a different symbol: the key is the resolved query, so C1's cached fallback must not answer this
  assert.equal(r.status, 200); assert.equal(r.headers.get('X-Data-Source'), null);
  assert.match(r.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.deepEqual(await r.json(), [{ symbol: 'ETHUSDT', lastPrice: '3000' }]);
});

test('C1. a Bybit-sourced fallback is still converted to the Binance array shape, flagged with X-Data-Source, and served as application/json', async () => {
  hits.length = 0;
  plan = (u) => u.includes('api.binance.com') ? json({ code: -1 }, 418)
    : u.includes('api.bybit.com/v5/market/tickers') ? json({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60000', price24hPcnt: '0.02', highPrice24h: '61000', lowPrice24h: '59000', turnover24h: '1000000', volume24h: '10' }] } }) : null;
  const r = await call('type=binance-24hr&symbols=BTCUSDT&c1=1');
  assert.equal(r.status, 200, `the fallback was not served: ${r.status}`);
  assert.equal(r.headers.get('X-Data-Source'), 'bybit-fallback', 'the fallback is no longer flagged');
  assert.match(r.headers.get('Content-Type') ?? '', /^application\/json/);
  const body = await r.json() as Array<Record<string, string>>;
  assert.ok(Array.isArray(body) && body.length === 1, 'the fallback is not a Binance-shaped array');
  assert.equal(body[0].symbol, 'BTCUSDT'); assert.equal(body[0].lastPrice, '60000');
  assert.equal(Number(body[0].priceChangePercent), 2, 'price24hPcnt 0.02 is 2 %');
});

test('C3. the Bybit tickers entry is TRIMMED before it is served (13 fields per contract), and a repeat read is the same small body', async () => {
  const row = { symbol: 'BTCUSDT', lastPrice: '1', indexPrice: '2', markPrice: '3', openInterest: '4', openInterestValue: '5', fundingRate: '6', nextFundingTime: '7', highPrice24h: '8', lowPrice24h: '9', price24hPcnt: '10', turnover24h: '11', fundingIntervalHour: '4', volume24h: 'DROP', bid1Price: 'DROP' };
  let upstream = 0;
  plan = (u) => { if (!u.includes('api.bybit.com/v5/market/tickers')) return null; upstream++; return json({ retCode: 0, result: { category: 'linear', list: [row] } }); };
  const a = await call('type=bybit-tickers'); const b = await call('type=bybit-tickers');
  for (const r of [a, b]) {
    assert.equal(r.status, 200); assert.match(r.headers.get('Content-Type') ?? '', /^application\/json/);
  }
  const body = await a.json() as { result: { list: Array<Record<string, string>> } };
  assert.deepEqual(Object.keys(body.result.list[0]).sort(), [...BYBIT_TICKER_FIELDS].sort(), 'the served ticker still carries fields nobody reads (or lost one somebody does)');
  assert.equal(body.result.list[0].fundingIntervalHour, '4', 'the funding interval was not served as the exchange sent it');
  assert.deepEqual(await b.json(), body, 'the cached read differs from the first');
  assert.equal(upstream, 1, 'the second read went upstream again: the trimmed body was not cached');
});

test('C4. an upstream body the trim does not recognise is served as it is, not emptied', async () => {
  plan = (u) => u.includes('stablecoins.llama.fi') ? json({ somethingNew: [1, 2, 3] }) : null;
  const r = await call('type=llama-stables&c4=1');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { somethingNew: [1, 2, 3] });
});

test.after(() => { globalThis.fetch = realFetch; });
