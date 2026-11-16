/* #2450: taker flow was a different measurement per coin on the same score bands: Binance coins read the last 8 x 15m candles (about 2 hours), Bybit-only coins read the last 500 trades (seconds to minutes). A 0.58 or
 * 0.62 on a 500-trade sample is mostly noise. computeSqueezeScore now scores the taker input ONLY from the 2-hour candle window.
 *   T1  REAL computeSqueezeScore: a taker ratio with takerBasis 'trades' is NOT a score input (same score and direction with or without it) and does not count in signalsPresent
 *   T2  'candles' (and a coin with no basis, i.e. rows from before the field) STILL score and count, so Binance coins are unchanged
 *   T3  the trade sample stays on the coin for display (the ratio is not removed from CoinData); only scoring ignores it
 *   T4  the writers: the Bybit trade sample sets takerBasis 'trades', the kline snapshot merge sets 'candles' (source anchors, they live in the provider)
 * WHAT IT CANNOT PROVE: the landing hero's readiness copy for a Bybit-only coin ("3 of 3 signals" is no longer reachable for it: stated in the PR). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSqueezeScore } from '../lib/marketStore.ts';

const coin = (f: Record<string, unknown> = {}) => ({ price: 100, ...f }) as never;
const TWO = { fundingRate: 0.0005, longRatio: 0.52, shortRatio: 0.1 };               // funding + long/short: two inputs, directional

test('T1. a trade-sample taker ratio is NOT a score input: same score, direction and signal count with or without it', () => {
  const without = computeSqueezeScore(coin(TWO));
  for (const ratio of [0.3, 0.1, 0.38, 0.62, 0.9]) {
    const withTrades = computeSqueezeScore(coin({ ...TWO, takerBuyRatio: ratio, takerBasis: 'trades' }));
    assert.equal(withTrades.score, without.score, `a ${ratio} trade-sample ratio changed the score`); assert.equal(withTrades.dir, without.dir);
    assert.equal(withTrades.signalsPresent, without.signalsPresent, 'the trade sample counted as a signal'); assert.ok(!withTrades.present.includes('taker flow'), 'the trade sample is named as a present signal');
  }
});
test('T2. a CANDLE-window ratio (and a coin with no basis) still scores and counts, so Binance coins are unchanged', () => {
  const without = computeSqueezeScore(coin(TWO));
  for (const basis of [{ takerBasis: 'candles' }, {}]) {
    const r = computeSqueezeScore(coin({ ...TWO, takerBuyRatio: 0.3, ...basis }));
    assert.equal(r.signalsPresent, 3, `${JSON.stringify(basis)}: the candle-window taker ratio no longer counts`); assert.ok(r.present.includes('taker flow'));
    assert.notEqual(r.score, without.score, `${JSON.stringify(basis)}: the candle-window taker ratio no longer scores`);
  }
});
test('T3. the trade sample is left on the coin: scoring does not mutate or require removing it', () => {
  const c = coin({ ...TWO, takerBuyRatio: 0.7, takerBasis: 'trades' }) as { takerBuyRatio?: number };
  computeSqueezeScore(c as never); assert.equal(c.takerBuyRatio, 0.7, 'the display value was changed');
});
test('T3b. a Bybit-only coin with a trade-sample taker and ONE other input is still below the two-input floor (the sample does not rescue it)', () => {
  const r = computeSqueezeScore(coin({ fundingRate: 0.0005, takerBuyRatio: 0.9, takerBasis: 'trades' }));
  assert.equal(r.signalsPresent, 1); if ('enough' in r) assert.equal((r as { enough: boolean }).enough, false, 'a trade sample made a one-input coin look informed');
});

const MP = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('T4. the Bybit trade sample sets takerBasis trades; the kline snapshot merge sets candles', () => {
  assert.ok(MP.includes("updateCoin(coin, { takerBuyRatio: buyVol / totalVol, takerBasis: 'trades' });"), 'the Bybit trade sample is not marked as a trade sample: it would be scored again');
  assert.ok(MP.includes("(m.takerBuyRatio != null ? { ...m, takerBasis: 'candles' } : m) as Partial<CoinData>"), 'the candle-window ratio is not marked: a later trade sample could be taken for it');
});
