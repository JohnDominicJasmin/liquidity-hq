import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldFailToBybit, canFailoverForRequest, bybitIntervalFor } from '../lib/klinesFailover.ts';

/* #1077 - server-side Binance -> Bybit klines failover, the egress half of
 * #1059. lib/exchangeFailover.ts (#1228) is the client-side WebSocket
 * reconnect state machine; this is the unrelated one-shot per-request
 * decision for app/api/market/klines/route.ts. */

test('shouldFailToBybit', async (t) => {
  await t.test('no status at all (a thrown/network-level failure) fails over', () => {
    assert.equal(shouldFailToBybit(undefined), true);
  });

  await t.test('every 2xx does not fail over, at both boundaries', () => {
    assert.equal(shouldFailToBybit(200), false);
    assert.equal(shouldFailToBybit(299), false);
    assert.equal(shouldFailToBybit(250), false);
  });

  await t.test('the boundary just outside 2xx on either side fails over', () => {
    assert.equal(shouldFailToBybit(199), true);
    assert.equal(shouldFailToBybit(300), true);
  });

  await t.test('Binance\'s own ban codes fail over - not specially narrowed to only these', () => {
    assert.equal(shouldFailToBybit(418), true);
    assert.equal(shouldFailToBybit(429), true);
  });

  await t.test('an ordinary 404 or 500 fails over just the same - the point is never showing nothing', () => {
    assert.equal(shouldFailToBybit(404), true);
    assert.equal(shouldFailToBybit(500), true);
  });
});

test('canFailoverForRequest - the no-splicing rule', async (t) => {
  await t.test('a fixed-limit request (not a range) may fail over', () => {
    assert.equal(canFailoverForRequest(false), true);
  });

  await t.test('a range request never fails over, full stop', () => {
    // PM/DevOps's rule: a paginated backfill walk (lib/backtestEngine.ts) has
    // no memory of which exchange answered an earlier page, so per-page
    // failover could splice a series that is part-Binance, part-Bybit with
    // an invisible seam in it. This is the one guarantee that must never
    // depend on anything else - not the failure status, not the symbol, not
    // how many prior pages already failed over.
    assert.equal(canFailoverForRequest(true), false);
  });
});

test('bybitIntervalFor', async (t) => {
  await t.test('every Bybit-mappable Binance interval maps to its exact linear-kline value', () => {
    assert.equal(bybitIntervalFor('1m'), '1');
    assert.equal(bybitIntervalFor('3m'), '3');
    assert.equal(bybitIntervalFor('5m'), '5');
    assert.equal(bybitIntervalFor('15m'), '15');
    assert.equal(bybitIntervalFor('30m'), '30');
    assert.equal(bybitIntervalFor('1h'), '60');
    assert.equal(bybitIntervalFor('2h'), '120');
    assert.equal(bybitIntervalFor('4h'), '240');
    assert.equal(bybitIntervalFor('6h'), '360');
    assert.equal(bybitIntervalFor('12h'), '720');
    assert.equal(bybitIntervalFor('1d'), 'D');
    assert.equal(bybitIntervalFor('1w'), 'W');
    assert.equal(bybitIntervalFor('1M'), 'M');
  });

  await t.test('8h and 3d have no Bybit equivalent - null, never a nearest-guess substitute', () => {
    assert.equal(bybitIntervalFor('8h'), null);
    assert.equal(bybitIntervalFor('3d'), null);
  });

  await t.test('an interval Binance itself does not support is also null, not a crash', () => {
    assert.equal(bybitIntervalFor('7h'), null);
    assert.equal(bybitIntervalFor(''), null);
  });

  await t.test('every mapped interval round-trips through the route\'s own Bybit interval set', () => {
    // app/api/market/klines/route.ts's INTERVALS.bybit is the authority on
    // what Bybit's API actually accepts - a mapping that produces a value
    // outside that set would pass this file's own tests while still 400ing
    // against the real route's validation.
    const BYBIT_ACCEPTED = new Set(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M']);
    const BINANCE_INTERVALS = [
      '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M',
    ];
    for (const iv of BINANCE_INTERVALS) {
      const mapped = bybitIntervalFor(iv);
      if (mapped !== null) assert.ok(BYBIT_ACCEPTED.has(mapped), `${iv} -> ${mapped}, not in Bybit's own accepted set`);
    }
  });
});
