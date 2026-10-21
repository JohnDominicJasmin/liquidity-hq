/* #1626 item 2 (#1629): when does a saved price alert count as hit? Pure rule in lib/priceAlertEval.ts, plus two facts about the cron route that has no tests of its own because it cannot export helpers.
 *
 * WHAT THIS PINS: the live price rule is unchanged (>= for "above", <= for "below", equality counts); a one-minute candle's high (above) or low (below) counts only if the candle STARTED after
 * the minute the alert was created; an alert with no readable created_at gets no wick check but still fires on the live price; the earliest touching candle is the one reported; unknown directions
 * never fire; a NaN or missing last price falls through to the wick check; the live price wins over a wick. Source pins: the cron adds the Bybit-only coins to its price map and looks back 15 one-minute candles.
 *
 * WHAT IT CANNOT PROVE: a real Telegram message, cron timing, Bybit rate limits with many armed coins, or that the 1-minute kline read returns what the rule expects (Dev measured the row shape live; this file
 * does not call Bybit). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePriceAlert, type Candle1m, type PriceAlertLike } from '../lib/priceAlertEval.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIN = 60_000;
const T0 = Date.parse('2026-10-21T12:00:30Z');          // alert created at 12:00:30
const M = (hh: number, mm: number) => Date.parse(`2026-10-21T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
const above = (target: number, created: string | null = '2026-10-21T12:00:30Z'): PriceAlertLike => ({ direction: 'above', target_price: target, created_at: created });
const below = (target: number, created: string | null = '2026-10-21T12:00:30Z'): PriceAlertLike => ({ direction: 'below', target_price: target, created_at: created });
const c = (startMs: number, high: number, low: number): Candle1m => ({ startMs, high, low });

test('A1. the live price rule is unchanged: above at or over the target, below at or under it, equality counts, a miss is null', () => {
  assert.deepEqual(evaluatePriceAlert(above(100), 100, []), { via: 'price', price: 100 });
  assert.deepEqual(evaluatePriceAlert(above(100), 101.5, []), { via: 'price', price: 101.5 });
  assert.deepEqual(evaluatePriceAlert(below(100), 100, []), { via: 'price', price: 100 });
  assert.deepEqual(evaluatePriceAlert(below(100), 99, []), { via: 'price', price: 99 });
  assert.equal(evaluatePriceAlert(above(100), 99.99, []), null);
  assert.equal(evaluatePriceAlert(below(100), 100.01, []), null);
});

test('A2. a wick counts: a candle high at or over an "above" target, a candle low at or under a "below" target, while the live price is back inside', () => {
  const up = evaluatePriceAlert(above(100), 98, [c(M(12, 3), 100.4, 97.9)]);
  assert.deepEqual(up, { via: 'wick', level: 100.4, atMs: M(12, 3) });
  const dn = evaluatePriceAlert(below(100), 102, [c(M(12, 3), 102.1, 99.6)]);
  assert.deepEqual(dn, { via: 'wick', level: 99.6, atMs: M(12, 3) });
  assert.deepEqual(evaluatePriceAlert(above(100), 98, [c(M(12, 3), 100, 97)]), { via: 'wick', level: 100, atMs: M(12, 3) }, 'a high exactly at the target counts');
});

test('A3. a near miss is not a wick: a high just under the target, a low just over it', () => {
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(12, 3), 99.999, 97)]), null);
  assert.equal(evaluatePriceAlert(below(100), 102, [c(M(12, 3), 103, 100.001)]), null);
  // the wrong side of the candle does not count either
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(12, 3), 99, 120)]), null, 'only the high is read for "above"');
  assert.equal(evaluatePriceAlert(below(100), 102, [c(M(12, 3), 80, 103)]), null, 'only the low is read for "below"');
});

test('A4. a wick from BEFORE the alert existed never fires it: a candle in the creation minute or earlier is ignored', () => {
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(12, 0), 105, 97)]), null, 'the candle the alert was created in');
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(11, 55), 105, 97), c(M(11, 59), 105, 97)]), null, 'older candles');
  assert.equal(evaluatePriceAlert(below(100), 102, [c(M(12, 0), 103, 95)]), null);
});

test('A5. the first eligible candle is the first whole minute after the creation minute (created 12:00:30: 12:01 counts, 12:00 does not)', () => {
  assert.deepEqual(evaluatePriceAlert(above(100), 98, [c(M(12, 1), 100.2, 97)]), { via: 'wick', level: 100.2, atMs: M(12, 1) });
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(12, 0), 100.2, 97)]), null);
  // created exactly on a minute boundary: that minute is still the creation minute
  assert.equal(evaluatePriceAlert(above(100, '2026-10-21T12:05:00Z'), 98, [c(M(12, 5), 101, 97)]), null);
  assert.deepEqual(evaluatePriceAlert(above(100, '2026-10-21T12:05:00Z'), 98, [c(M(12, 6), 101, 97)]), { via: 'wick', level: 101, atMs: M(12, 6) });
});

test('A6. no readable created_at: no wick check, but the live price still fires it', () => {
  for (const created of [null, undefined, '', 'not a date', 'yesterday']) {
    assert.equal(evaluatePriceAlert({ direction: 'above', target_price: 100, created_at: created as string | null | undefined }, 98, [c(M(12, 3), 105, 97)]), null, `created_at ${String(created)}`);
    assert.deepEqual(evaluatePriceAlert({ direction: 'above', target_price: 100, created_at: created as string | null | undefined }, 101, [c(M(12, 3), 105, 97)]), { via: 'price', price: 101 }, `live price, created_at ${String(created)}`);
  }
});

test('A7. several touching candles: the EARLIEST is reported, whatever order they come in', () => {
  const cs = [c(M(12, 9), 103, 98), c(M(12, 4), 101, 98), c(M(12, 7), 102, 98)];
  assert.deepEqual(evaluatePriceAlert(above(100), 98, cs), { via: 'wick', level: 101, atMs: M(12, 4) });
  assert.deepEqual(evaluatePriceAlert(above(100), 98, [...cs].reverse()), { via: 'wick', level: 101, atMs: M(12, 4) });
});

test('A8. the live price wins over a wick when both would fire', () => {
  assert.deepEqual(evaluatePriceAlert(above(100), 100.5, [c(M(12, 3), 110, 97)]), { via: 'price', price: 100.5 });
});

test('A9. a NaN, null or missing last price falls through to the wick check and never fires on its own', () => {
  for (const last of [null, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
    assert.equal(evaluatePriceAlert(above(100), last as number | null, []), null, `last ${String(last)}`);
    assert.deepEqual(evaluatePriceAlert(above(100), last as number | null, [c(M(12, 3), 101, 97)]), { via: 'wick', level: 101, atMs: M(12, 3) }, `last ${String(last)} with a wick`);
  }
});

test('A10. an unknown or missing direction never fires, by price or by wick', () => {
  for (const direction of ['', 'cross', 'ABOVE', 'up', undefined as unknown as string]) {
    const a = { direction, target_price: 100, created_at: '2026-10-21T12:00:30Z' };
    assert.equal(evaluatePriceAlert(a, 150, [c(M(12, 3), 200, 1)]), null, `direction ${String(direction)}`);
  }
});

test('A11. garbage candles cannot fire an alert: NaN highs and lows, and a candle with no start time', () => {
  assert.equal(evaluatePriceAlert(above(100), 98, [c(M(12, 3), Number.NaN, 97)]), null);
  assert.equal(evaluatePriceAlert(below(100), 102, [c(M(12, 3), 103, Number.NaN)]), null);
  assert.equal(evaluatePriceAlert(above(100), 98, [{ startMs: Number.NaN, high: 200, low: 1 }]), null);
  assert.equal(evaluatePriceAlert(above(100), 98, []), null);
});

test('A12. the creation minute arithmetic does not depend on seconds or milliseconds: created at 12:00:59.999 still excludes 12:00 and includes 12:01', () => {
  const created = '2026-10-21T12:00:59.999Z';
  assert.equal(evaluatePriceAlert(above(100, created), 98, [c(M(12, 0), 105, 97)]), null);
  assert.deepEqual(evaluatePriceAlert(above(100, created), 98, [c(M(12, 1), 105, 97)]), { via: 'wick', level: 105, atMs: M(12, 1) });
  assert.equal(T0 % MIN, 30_000); // sanity: the fixture really is mid-minute
});

test('S1. source (cron route): the Bybit-only coins are added to the price map, the wick lookback is 15 one-minute candles, and the rule from the lib is what decides', () => {
  const src = stripTsComments(read('app/api/telegram/alert/route.ts'));
  assert.ok(/for \(const coin of Object\.keys\(BYBIT_SYMS\)\)\s*\{\s*if \(bybitSpotOrLinear\(coin\)\) continue;\s*byLinSym\.set\(BYBIT_SYMS\[coin\], coin\);/.test(src), 'the Bybit-only coins are not added to the linear-ticker map');
  assert.ok(/const WICK_LOOKBACK_MIN = 15;/.test(src), 'the wick lookback is not 15');
  assert.ok(/fetchBybitCandles\(m\.symbol, '1', WICK_LOOKBACK_MIN/.test(src), 'the kline read is not 1-minute over the lookback');
  assert.ok(/evaluatePriceAlert\(alert, price \?\? null, candlesByCoin\.get\(alert\.coin\) \?\? \[\]\)/.test(src), 'the rule is not what decides');
  assert.ok(/bybitSymbolPriceFactor\(item\.symbol\)/.test(src), '1000-token quotes are not brought to a per-token price');
});
