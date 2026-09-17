import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSource, stableEnoughToSwitchBack } from '../lib/exchangeFailover.ts';

/* #1059/#1228 - client-side WebSocket reconnect state machine (WhaleTradesFeed,
 * MarketProvider's Liquidation Cascade Detector). Distinct from
 * lib/klinesFailover.ts (#1077's server-side one-shot per-request decision). */

test('nextSource', async (t) => {
  await t.test('failures up to and including maxRetries stay on Binance', () => {
    assert.equal(nextSource('binance', 0, 5), 'binance');
    assert.equal(nextSource('binance', 5, 5), 'binance', 'exactly at the limit has not exceeded it yet');
  });

  await t.test('one more failure than maxRetries switches to Bybit', () => {
    assert.equal(nextSource('binance', 6, 5), 'bybit');
  });

  await t.test('already on Bybit is unaffected by more failures - only a still-on-Binance caller can trip the switch', () => {
    assert.equal(nextSource('bybit', 0, 5), 'bybit');
    assert.equal(nextSource('bybit', 1, 5), 'bybit');
    assert.equal(nextSource('bybit', 999, 5), 'bybit', 'an enormous failure count on a background retry does not change anything');
  });

  await t.test('maxRetries of 0 switches on the very first failure', () => {
    assert.equal(nextSource('binance', 0, 0), 'binance', 'zero failures yet, still on Binance');
    assert.equal(nextSource('binance', 1, 0), 'bybit');
  });
});

test('stableEnoughToSwitchBack - the hysteresis guarantee (QA\'s #1228 ask)', async (t) => {
  await t.test('holds false right up to the boundary, true exactly at it', () => {
    assert.equal(stableEnoughToSwitchBack(0, 2999, 3000), false);
    assert.equal(stableEnoughToSwitchBack(0, 3000, 3000), true);
    assert.equal(stableEnoughToSwitchBack(0, 3001, 3000), true);
  });

  await t.test('works from any connectedAt instant, not just zero', () => {
    const connectedAt = 1_757_000_000_000;
    assert.equal(stableEnoughToSwitchBack(connectedAt, connectedAt + 1500, 3000), false);
    assert.equal(stableEnoughToSwitchBack(connectedAt, connectedAt + 3000, 3000), true);
  });

  await t.test('the flapping case: a Binance connection that drops inside the window never reads as stable', () => {
    // This is the exact shape PR #1228's onopen/onclose pairing relies on: a
    // connectedAt timestamp taken when Binance's socket opens, checked again
    // when the BN_STABLE_MS confirm timer fires. If Binance drops and
    // reconnects repeatedly, each attempt's own connectedAt is always too
    // recent relative to when the check runs - so no single flap, however
    // many there are, can ever read as a stable recovery.
    const flapTimes = [0, 400, 900, 1600, 2100]; // reconnects every few hundred ms
    for (const connectedAt of flapTimes) {
      assert.equal(
        stableEnoughToSwitchBack(connectedAt, connectedAt + 600, 3000),
        false,
        `a connection opened at ${connectedAt} and checked 600ms later must not read as stable`,
      );
    }
  });

  await t.test('a genuinely stable recovery does read as stable', () => {
    const connectedAt = 5000;
    assert.equal(stableEnoughToSwitchBack(connectedAt, connectedAt + 3000, 3000), true);
  });
});
