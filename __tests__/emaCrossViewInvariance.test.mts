import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmaCross } from '../lib/strategies/emaCross.ts';

/* QA regression (real-data audit 2026-11-19): the golden / death cross must not depend on HOW MUCH OLDER HISTORY the view carries. The Arena hands every strategy only the last 300 closed candles
 * (lib/useStrategySignal.ts fetchOHLCV(..., 300)), and detectEmaCross seeds both EMAs with the FIRST CLOSE of that view. After 300 candles the EMA200 still carries (1 - 2/201)^300 = 5% of the seed's offset,
 * which is larger than the whole 50/200 spread at a cross, so the cross lands on a different candle than the true one, and one candle fewer in the window moves it again. Measured on 30 days of real
 * BTC/ETH/SOL candles: only 9 of 54 app crosses were a cross of the true EMAs on the same candle, 18 of 54 were gone from the next bar's window, and a window one candle shorter changed the answer on 45% of
 * the bars where either showed a cross. Synthetic fixtures (qa/fixtures/strategyFixtures.ts crossFixture) pass because they hand the strategy the whole history.
 * HAND-BUILT INPUT: a pure sine wave (period 480 candles, amplitude 10 around 100): the 50 and 200 EMAs cross twice per cycle at calculable candles; nothing random, no market data. */

const T0 = 1_700_000_000_000, TF = 3_600_000;
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const N = 1600, PERIOD = 480, AMP = 10;
const closes = Array.from({ length: N }, (_, i) => 100 + AMP * Math.sin((2 * Math.PI * i) / PERIOD));
const candles: C[] = closes.map((c, i) => { const p = i ? closes[i - 1] : c; return { time: T0 + i * TF, open: p, close: c, high: Math.max(p, c) + 0.05, low: Math.min(p, c) - 0.05, volume: 100 }; });
const ctx = { coin: 'btc', tf: '1h', tfMs: TF };
const idOf = (r: ReturnType<typeof detectEmaCross>) => `${r.verdict}@${r.signalTimestamp === null ? '-' : (r.signalTimestamp - T0) / TF}`;

test('cross-a. control: with the whole history the sine has a golden cross at candle 934 and a death cross at 1174', () => {
  assert.equal(idOf(detectEmaCross(candles.slice(0, 935), ctx)), 'buy@934');
  assert.equal(idOf(detectEmaCross(candles.slice(0, 1175), ctx)), 'sell@1174');
});

test('cross-b. control: a 1000-candle view gives the same answer as the whole history on every candle from 1000 on (the oracle is not over-strict)', () => {
  const bad: string[] = [];
  for (let k = 1000; k < N; k++) { const full = idOf(detectEmaCross(candles.slice(0, k + 1), ctx)), view = idOf(detectEmaCross(candles.slice(k - 999, k + 1), ctx)); if (full !== view) bad.push(`k=${k} full=${full} view1000=${view}`); }
  assert.deepEqual(bad, []);
});

test('cross-c. a 300-candle view never contradicts the whole history: it either agrees on the candle or says wait (unsettled EMA200)', () => {
  const bad: string[] = [];
  for (let k = 900; k < N; k++) {
    const full = detectEmaCross(candles.slice(0, k + 1), ctx), view = detectEmaCross(candles.slice(k - 299, k + 1), ctx);
    if (view.verdict !== 'wait' && idOf(view) !== idOf(full)) bad.push(`k=${k} whole-history=${idOf(full)} 300-view=${idOf(view)}`);
  }
  assert.deepEqual(bad, [], 'the 300-candle view reported a cross on a candle where the true EMAs do not cross');
});
