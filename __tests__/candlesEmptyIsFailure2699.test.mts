import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { firstVenueThatAnswers } from '../lib/venueFallback.ts';
import { symbolDenominationFactor } from '../lib/coins.ts';

/* #2699 (QA drawings audit #1263: BTC 1d ema_cross said "Needs 601 1d candles; BTC has 0"). Written rule (PR body): NO CANDLES FROM A VENUE IS A FAILED READ, NOT "THE COIN HAS 0": fetchBybitKlines THROWS on an empty list (so fetchOHLCV falls through to Binance futures, then OKX; only when every venue fails does the read fail); zero closed candles in the strategy hook is a failed read (the catch keeps the last good call or shows the retry state) and never the "too few candles" end state; a short non-empty history still says how many candles the strategy needs.
 *   E1 the REAL fetchBybitKlines (cut out of lib/useEMAStrategy.ts, its fetch stood in): an empty list throws, candles resolve and are scaled by the denomination   E2 the REAL firstVenueThatAnswers with the three venues in the order fetchOHLCV declares them: an empty/refusing Bybit falls through, every venue failing rejects   E3 the strategy hook: the zero-candle guard comes BEFORE the too-few state
 * NOT covered (needs a browser and live venues): the BTC 1d call box on the real page. */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const rd = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ema = rd('lib/useEMAStrategy.ts');
const startAt = ema.indexOf('async function fetchBybitKlines('), endAt = ema.indexOf('export async function fetchOHLCV(');
assert.ok(startAt > 0 && endAt > startAt, 'CONTROL: fetchBybitKlines was not found');
const fnSrc = stripTypeScriptTypes(ema.slice(startAt, endAt)).replace(/^async function fetchBybitKlines/, 'return async function fetchBybitKlines');
const DAY = 86_400_000;
const mk = (retry: (...a: unknown[]) => Promise<unknown>) => new Function('fetchBybitKlinesRetry', 'deadlineSignal', 'symbolDenominationFactor', fnSrc)(retry, () => undefined, symbolDenominationFactor) as (sym: string, interval: string, limit: number) => Promise<Array<{ time: number; close: number; volume: number }>>;
const list = (n: number) => Array.from({ length: n }, (_, i) => [String(1_700_000_000_000 + (n - 1 - i) * DAY), '100', '101', '99', '100.5', '10']);

test('E1. fetchBybitKlines: an empty list is a failure (throws), a null after retry is a failure, candles resolve oldest-first and 1000x symbols are scaled', async () => {
  await assert.rejects(mk(async () => ({ retCode: 0, result: { list: [] } }))('BTCUSDT', 'D', 600), /no candles/i, 'an empty list was returned as a normal answer (the "BTC has 0" path)');
  await assert.rejects(mk(async () => ({ retCode: 0, result: {} }))('BTCUSDT', 'D', 600), /no candles/i, 'a body without a list must fail the same way');
  await assert.rejects(mk(async () => null)('BTCUSDT', 'D', 600), /failed after retry/i);
  const ok = await mk(async () => ({ retCode: 0, result: { list: list(5) } }))('BTCUSDT', 'D', 600); assert.equal(ok.length, 5); assert.ok(ok[0].time < ok[4].time, 'the candles must run oldest first'); assert.equal(ok[4].close, 100.5);
  const pepe = await mk(async () => ({ retCode: 0, result: { list: list(3) } }))('1000PEPEUSDT', 'D', 600); assert.equal(Math.round(pepe[0].close * 1e6) / 1e6, 0.1005, 'a 1000x contract is scaled to per-token prices');
});
test('E2. the venue order (Bybit, Binance futures, OKX): an empty or refusing venue falls through to the next, and only when every venue fails does the read reject', async () => {
  const order = /firstVenueThatAnswers<OHLCV\[\]>\(\[\s*bySym \? \{ venue: 'Bybit'[\s\S]*?bnSym \? \{ venue: 'Binance futures'[\s\S]*?okSym && okBar \? \{ venue: 'OKX'/.test(ema); assert.ok(order, 'the venue order is no longer Bybit, Binance futures, OKX');
  const ran: string[] = []; const venue = (v: string, outcome: 'ok' | 'throw') => ({ venue: v, run: async () => { ran.push(v); if (outcome === 'throw') throw new Error(`${v} returned no candles`); return [{ v }]; } });
  assert.deepEqual(await firstVenueThatAnswers([venue('Bybit', 'throw'), venue('Binance futures', 'ok'), venue('OKX', 'ok')], 'btc'), [{ v: 'Binance futures' }]); assert.deepEqual(ran, ['Bybit', 'Binance futures'], 'the venue after the first answer must not be asked');
  ran.length = 0; assert.deepEqual(await firstVenueThatAnswers([venue('Bybit', 'throw'), venue('Binance futures', 'throw'), venue('OKX', 'ok')], 'btc'), [{ v: 'OKX' }]); assert.deepEqual(ran, ['Bybit', 'Binance futures', 'OKX']);
  await assert.rejects(firstVenueThatAnswers([venue('Bybit', 'throw'), venue('Binance futures', 'throw'), venue('OKX', 'throw')], 'btc'), /All venues failed for btc/, 'every venue failing must reject, never resolve empty');
});
test('E3. the strategy hook: zero candles throws BEFORE the too-few state; a short non-empty history still reaches the too-few state with its count', () => {
  const src = rd('lib/useStrategySignal.ts').replace(/\/\*[\s\S]*?\*\//g, '');
  const zero = src.indexOf("if (!closed.length) throw new Error('no candles');"), few = src.indexOf('if (closed.length < def.minCandles)'); assert.ok(zero > 0, 'the zero-candle guard is gone'); assert.ok(few > zero, 'the zero-candle guard must come BEFORE the too-few state (or a failed read says "has 0" again)');
  assert.match(src.slice(few, few + 400), /STRAT_NA_TOO_FEW[\s\S]{0,200}need: String\(def\.minCandles\)/, 'a short history no longer reports how many candles it needs'); assert.match(src.slice(zero), /catch/, 'CONTROL: a catch must follow the guard');
});
