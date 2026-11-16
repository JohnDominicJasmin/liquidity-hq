/* #2415: Binance forceOrder PARTIALLY_FILLED. z = accumulated filled quantity, ap = average price, X = status (PM, from Binance's field list).
 * One liquidation order that reports PARTIALLY_FILLED (z=1) and later FILLED (z=3) is ONE liquidation of 3 units. A row has no order id, so two rows
 * cannot be de-duplicated afterwards: counting the partial adds 1 + 3 = 4 units. Real parser, real events.
 *   P1  FILLED: usd = z * ap (not q * p)
 *   P2  PARTIALLY_FILLED + later FILLED of the SAME order must add up to the order's real size (3 units), never 4: written as the contract, todo until Dev answers PM's question on whether partials are stored
 *   P3  NEW / CANCELED / EXPIRED are never rows
 * Expectations come from the field definitions above, not from the code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceForceOrder } from '../lib/liqCollector.ts';

const ev = (o: Record<string, string>) => JSON.stringify({ data: { E: 1_950_000_000_000, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '3', p: '60000', ap: '60100', X: 'FILLED', l: '3', z: '3', T: 1_950_000_000_000, ...o } } });

test('P1. FILLED counts z * ap (accumulated filled quantity at the average price)', () => {
  const r = parseBinanceForceOrder(ev({ X: 'FILLED', q: '9', z: '3', ap: '60100', p: '60000' }), 1_950_000_000_000);
  assert.ok(r, 'a filled liquidation over the floor was dropped'); assert.equal(r!.usd, 3 * 60100); assert.equal(r!.side, 'LONG'); assert.equal(r!.source, 'BN');
});
test('P2. one order reported as PARTIALLY_FILLED (z=1) then FILLED (z=3) adds up to 3 units, not 4', { todo: true }, () => {
  const ts = 1_950_000_000_000; const sum = [ev({ X: 'PARTIALLY_FILLED', z: '1', l: '1' }), ev({ X: 'FILLED', z: '3', l: '2' })].map((m) => parseBinanceForceOrder(m, ts)).reduce((a, r) => a + (r?.usd ?? 0), 0);
  assert.equal(sum, 3 * 60100, `the order is counted as ${sum / 60100} units: the partial is added to the final accumulated quantity (z is already cumulative)`);
});
test('P3. NEW, CANCELED and EXPIRED are never liquidation rows', () => {
  for (const X of ['NEW', 'CANCELED', 'EXPIRED']) assert.equal(parseBinanceForceOrder(ev({ X, z: '0' }), 1_950_000_000_000), null, X);
});
