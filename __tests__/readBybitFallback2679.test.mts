import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2679 (#1185 audit A4, owner's feature-freeze order): THE ARENA QUICK/DEEP READ TRIES BYBIT WHEN BINANCE FAILS. Written rule (PR body): a coin with a Binance symbol tries Binance first; on a non-OK answer OR a thrown fetch (timeout) it tries Bybit when a Bybit symbol exists; only when both fail does the read fail; a coin with no Binance symbol goes to Bybit directly; Binance is asked exactly once and Bybit at most once (no loop); a good Binance answer never touches Bybit; the interval mapping and the shared retry (fetchBybitKlinesRetry) are unchanged.
 * The REAL block is cut out of app/(main)/arena/page.tsx (const fromBybit ... the if/else) and run with stand-ins for fetch, fetchBybitKlinesRetry and the labels.
 *   B1 the decision table   B2 the Bybit leg: interval mapping, symbol, retry helper, newest-first reversed to oldest-first, null answer = failure   B3 source: the block shape (try/catch around Binance only, no second Binance call) */
const src = readFileSync(new URL('../app/(main)/arena/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('const fromBybit = async (): Promise<(string|number)[][]> => {'); assert.ok(start > 0, 'CONTROL: fromBybit not found');
const endMark = 'raw = await fromBybit();\n      }\n'; const endAt = src.indexOf(endMark, src.indexOf('if (binanceSym) {', start)); assert.ok(endAt > start, 'CONTROL: the end of the fallback block not found');
const block = src.slice(start, endAt + endMark.length).replace(': Promise<(string|number)[][]>', '').replace(/\/\*[\s\S]*?\*\//g, '');
const AsyncFn = Object.getPrototypeOf(async function () { /* */ }).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>;
const runBlock = new AsyncFn('binanceSym', 'bybitSym', 'readTf', 'selectedCoin', 'fetch', 'binanceKlineSource', 'deadlineSignal', 't', 'fetchBybitKlinesRetry', `let raw; ${block} return raw;`);
const T = (k: string, v?: Record<string, string>) => `${k}${v ? JSON.stringify(v) : ''}`;
type Ctx = { binance: 'ok' | 'http500' | 'throws'; bybit: 'ok' | 'null' | 'throws'; binanceSym: string | null; bybitSym: string | null; tf?: string };
async function run(c: Ctx) {
  const calls = { binance: [] as string[], bybit: [] as Array<{ sym: string; interval: string; limit: number }> };
  const BIN = [[1, '1', '2', '0.5', '1.5', '10'], [2, '1.5', '2', '1', '1.8', '12']];
  const fetchStub = async (url: string) => { calls.binance.push(url); if (c.binance === 'throws') throw new Error('timeout'); return { ok: c.binance === 'ok', json: async () => BIN } as unknown as Response; };
  const bybitStub = async (sym: string, interval: string, limit: number) => { calls.bybit.push({ sym, interval, limit }); if (c.bybit === 'throws') throw new Error('bybit boom'); if (c.bybit === 'null') return null; return { result: { list: [[2, '1.5', '2', '1', '1.8', '12'], [1, '1', '2', '0.5', '1.5', '10']] } }; };
  let raw: unknown = null; let err: string | null = null;
  try { raw = await runBlock(c.binanceSym, c.bybitSym, c.tf ?? '1h', 'btc', fetchStub, () => 'spot', () => undefined, T, bybitStub); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  return { raw, err, calls };
}
const BIN_RAW = [[1, '1', '2', '0.5', '1.5', '10'], [2, '1.5', '2', '1', '1.8', '12']];

test('B1. Binance first; a bad Binance answer or a thrown fetch falls back to Bybit; both failing fails the read; no loop', async () => {
  let r = await run({ binance: 'ok', bybit: 'ok', binanceSym: 'BTCUSDT', bybitSym: 'BTCUSDT' }); assert.deepEqual(r.raw, BIN_RAW); assert.equal(r.calls.binance.length, 1); assert.equal(r.calls.bybit.length, 0, 'a good Binance answer must never touch Bybit');
  for (const failure of ['http500', 'throws'] as const) { r = await run({ binance: failure, bybit: 'ok', binanceSym: 'BTCUSDT', bybitSym: 'BTCUSDT' }); assert.equal(r.err, null, `${failure}: the read must continue from Bybit`); assert.deepEqual(r.raw, BIN_RAW, `${failure}: the Bybit candles are not oldest-first`); assert.equal(r.calls.binance.length, 1, 'Binance asked more than once'); assert.equal(r.calls.bybit.length, 1, 'Bybit asked more than once'); }
  r = await run({ binance: 'http500', bybit: 'ok', binanceSym: 'BTCUSDT', bybitSym: null }); assert.match(r.err ?? '', /ARENA_ERROR_BINANCE_API/, 'no Bybit symbol: the Binance error stands'); assert.equal(r.calls.bybit.length, 0);
  r = await run({ binance: 'throws', bybit: 'ok', binanceSym: 'BTCUSDT', bybitSym: null }); assert.equal(r.err, 'timeout', 'no Bybit symbol: the original thrown error stands');
  r = await run({ binance: 'http500', bybit: 'null', binanceSym: 'BTCUSDT', bybitSym: 'BTCUSDT' }); assert.match(r.err ?? '', /ARENA_ERROR_BYBIT_API/, 'both failing must fail the read with the Bybit error'); assert.equal(r.calls.binance.length, 1); assert.equal(r.calls.bybit.length, 1);
  r = await run({ binance: 'throws', bybit: 'throws', binanceSym: 'BTCUSDT', bybitSym: 'BTCUSDT' }); assert.equal(r.err, 'bybit boom');
  r = await run({ binance: 'ok', bybit: 'ok', binanceSym: null, bybitSym: 'PEPEUSDT' }); assert.deepEqual(r.raw, BIN_RAW); assert.equal(r.calls.binance.length, 0, 'no Binance symbol: Binance is never asked'); assert.equal(r.calls.bybit.length, 1);
  r = await run({ binance: 'ok', bybit: 'ok', binanceSym: null, bybitSym: null }); assert.match(r.err ?? '', /ARENA_ERROR_NO_DATA_SOURCE/, 'no symbol at all');
});
test('B2. the Bybit leg: symbol, retry helper, 300 candles, the written interval mapping, newest-first reversed, null = failure', async () => {
  const want: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240' };
  for (const [tf, iv] of Object.entries(want)) { const r = await run({ binance: 'http500', bybit: 'ok', binanceSym: 'ETHUSDT', bybitSym: 'ETHUSDT', tf }); assert.deepEqual(r.calls.bybit, [{ sym: 'ETHUSDT', interval: iv, limit: 300 }], `${tf}: the Bybit request`); }
  const r = await run({ binance: 'http500', bybit: 'ok', binanceSym: 'ETHUSDT', bybitSym: 'ETHUSDT', tf: '1d' }); assert.equal(r.calls.bybit[0].interval, 'D', '1d maps to D');
  assert.deepEqual((await run({ binance: 'http500', bybit: 'ok', binanceSym: 'ETHUSDT', bybitSym: 'ETHUSDT' })).raw, [...BIN_RAW].sort((a, b) => Number(a[0]) - Number(b[0])), 'oldest-first');
});
test('B3. source: Binance is asked once inside the try, the catch rethrows without a Bybit symbol, and the shared retry helper is used', () => {
  assert.equal((block.match(/\/api\/market\/klines\?source=/g) ?? []).length, 1, 'a second Binance call'); assert.match(block, /try \{\s*const r = await fetch\([\s\S]*?\} catch \(e\) \{\s*if \(!bybitSym\) throw e;\s*raw = await fromBybit\(\);\s*\}/, 'the try/catch shape changed'); assert.match(block, /fetchBybitKlinesRetry\(bybitSym, bybitInterval, 300, \{ attemptTimeoutMs: 15_000 \}\)/, 'the shared retry helper or its budget changed');
});
