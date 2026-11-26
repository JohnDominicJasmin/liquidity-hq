/* QA: PR #2844 (#1263 owner item 97): the server-built chart reads fresh candles from the Arena chart's own market. The real fetchers run; the exchanges are a stand-in.
 *   F1 two reads inside one candle period: the second shows the exchange's price now (last close, high), unlike the cached closed-candle series
 *   F2 BTC reads Binance spot, a futures-only coin (SPX) reads futures; the signal series still reads futures
 *   F3 a refused or empty Binance answer falls back to Bybit, and nothing is cached by the chart read
 *   F4 only the server chart uses it; the quoted levels keep the cached series; the switch is still off unless set */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candleCacheSize, clearCandleCache, fetchChartCandles, fetchRibbonCandles } from '../lib/ribbonCandles.ts';
import { chartFromCandles } from '../lib/arenaChartServer.ts';

const HOUR = 3_600_000, open = Math.floor(Date.now() / HOUR) * HOUR;
const world = { live: 100, binance: 'ok' as 'ok' | 'down' | 'empty', asked: [] as string[] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  world.asked.push(`${url.host}${url.pathname}?${url.searchParams.get('symbol')}`);
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const row = (i: number) => { const c = i === 299 ? world.live : 100; return [open - (299 - i) * HOUR, '100', String(Math.max(c, 101)), '99', String(c), '10']; };
  const rows = Array.from({ length: 300 }, (_, i) => row(i));
  if (url.host === 'api.bybit.com') return ok({ retCode: 0, result: { list: rows.map((r) => r.map(String).concat('0')).reverse() } });
  if (world.binance === 'down') return new Response('refused', { status: 451 });
  return ok(world.binance === 'empty' ? [] : rows);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { world.live = 100; world.binance = 'ok'; world.asked = []; clearCandleCache(); });

test('F1. the second read in a period is the price now', async () => {
  const first = chartFromCandles('1h', await fetchChartCandles('btc', '1h'))!;
  await fetchRibbonCandles('btc', '1h', open + 60_000);
  world.live = 120;
  const later = chartFromCandles('1h', await fetchChartCandles('btc', '1h'))!;
  assert.deepEqual([first.lastClose, first.hi, later.lastClose, later.hi], [100, 101, 120, 120]);
  const cached = chartFromCandles('1h', await fetchRibbonCandles('btc', '1h', open + 51 * 60_000))!;
  assert.equal(cached.lastClose, 100, 'CONTROL: the signal series is the cached one');
});

test('F2. the chart\'s own market', async () => {
  await fetchChartCandles('btc', '1h'); await fetchChartCandles('spx', '1h'); await fetchRibbonCandles('eth', '1h');
  assert.deepEqual(world.asked, ['api.binance.com/api/v3/klines?BTCUSDT', 'fapi.binance.com/fapi/v1/klines?SPXUSDT', 'fapi.binance.com/fapi/v1/klines?ETHUSDT']);
});

test('F3. Bybit when Binance cannot answer, and nothing cached', async () => {
  for (const mode of ['down', 'empty'] as const) {
    world.binance = mode; world.asked = []; world.live = 130;
    const got = await fetchChartCandles('btc', '1h');
    assert.equal(got.at(-1)?.close, 130, mode);
    assert.ok(world.asked.at(-1)!.startsWith('api.bybit.com/'), `${mode}: ${world.asked.join(' ')}`);
  }
  assert.equal(candleCacheSize(), 0);
});

test('F4. only the server chart uses it, and the switch is off by default', () => {
  const route = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(route.includes('chartFromCandles(tf, await fetchChartCandles(coin, tf as EMASignalTF))'));
  assert.equal(route.split('fetchChartCandles(').length - 1, 1);
  assert.ok(route.includes('await fetchRibbonCandles(coin, tf as EMASignalTF, Date.now(), 400)'));
  assert.ok(route.includes("if (process.env.GROK_SERVER_CHART === '1' && coin"));
});
