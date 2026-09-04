/* Cluster selection for the Arena chart overlay (#766).
 *
 * The interesting assertion is the coin filter, not the sort. LiqFeed emits
 * every coin's buckets in one array and the consumer filters - so the way this
 * overlay goes wrong is not an error or an empty chart, it is eight correct
 * lines drawn on the wrong coin's candles. That is the shape qa/README.md now
 * names in its preamble: a plausible result, correctly computed, about the
 * wrong subject.
 *
 * The last test is the control. Without it every assertion here passes on a
 * helper that returns [] for everything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { topClustersForCoin, LIQ_CLUSTER_LINES } from '../lib/liqClusters.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

type B = { coin: string; price: number; total: number };
const b = (coin: string, price: number, total: number): B => ({ coin, price, total });

test('keeps only the requested coin, whatever the casing on either side', () => {
  const mixed = [b('BTC', 109_000, 9e6), b('ETH', 4_100, 8e6), b('SOL', 210, 7e6)];
  assert.deepEqual(topClustersForCoin(mixed, 'btc').map(x => x.coin), ['BTC']);
  assert.deepEqual(topClustersForCoin(mixed, 'BTC').map(x => x.coin), ['BTC']);
  assert.deepEqual(topClustersForCoin(mixed, 'eth').map(x => x.price), [4_100]);
  assert.deepEqual(topClustersForCoin(mixed, 'doge'), []);
});

test('a coin name is matched whole, not as a substring', () => {
  /* 'ETH' inside 'WETH', and 'BTC' inside 'BTCDOM' - the substring match is
     trap 7 in qa/README.md and it is one `.includes()` away in this function. */
  const near = [b('WETH', 4_100, 5e6), b('BTCDOM', 2_400, 5e6), b('BTC', 109_000, 1e6)];
  assert.deepEqual(topClustersForCoin(near, 'eth'), []);
  assert.deepEqual(topClustersForCoin(near, 'btc').map(x => x.price), [109_000]);
});

test('heaviest first, and never more than the ruled 8', () => {
  const many = Array.from({ length: 20 }, (_, i) => b('BTC', 100_000 + i * 100, (i + 1) * 1e6));
  const top = topClustersForCoin(many, 'btc');
  assert.equal(top.length, LIQ_CLUSTER_LINES);
  assert.equal(LIQ_CLUSTER_LINES, 8, "the owner's ruling on #766 was eight lines");
  assert.deepEqual(top.map(x => x.total), [20e6, 19e6, 18e6, 17e6, 16e6, 15e6, 14e6, 13e6]);
  // Descending, so the caller can label the heaviest without re-sorting.
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].total >= top[i].total);
});

test('the input array is not reordered underneath the caller', () => {
  /* .sort() mutates in place. LiqFeed holds this array in React state and
     hands the same reference to every consumer, so sorting it here would
     silently reorder /liq's list from the Arena chart. .filter() copies
     first - this test is what keeps it that way. */
  const original = [b('BTC', 1, 1e6), b('BTC', 2, 9e6), b('BTC', 3, 5e6)];
  const snapshot = original.map(x => x.price);
  topClustersForCoin(original, 'btc');
  assert.deepEqual(original.map(x => x.price), snapshot);
});

test('a price a chart cannot draw is dropped, not passed through', () => {
  const junk = [
    b('BTC', NaN, 9e6), b('BTC', Infinity, 8e6), b('BTC', 0, 7e6), b('BTC', -5, 6e6),
    b('BTC', 109_000, NaN), b('BTC', 108_000, 0),
    b('BTC', 107_000, 1e6),
  ];
  assert.deepEqual(topClustersForCoin(junk, 'btc'), [b('BTC', 107_000, 1e6)]);
});

test('empty, null and undefined inputs return an empty list rather than throwing', () => {
  assert.deepEqual(topClustersForCoin([], 'btc'), []);
  assert.deepEqual(topClustersForCoin(null, 'btc'), []);
  assert.deepEqual(topClustersForCoin(undefined, 'btc'), []);
});

test('the overlay label says REALIZED, and no drawing path can omit it', () => {
  /* The one defect a reviewer cannot see by looking at the chart: these are
     liquidations that ALREADY happened. Coinglass sold PREDICTED levels -
     a forward magnet - and the two are indistinguishable once drawn. So the
     word is asserted against the source rather than trusted to survive an
     edit. Both the overlay text and the toggle's tooltip are checked, because
     a user who never hovers reads only the first. */
  const chart = readFileSync(path.join(ROOT, 'components', 'KLineProChart.tsx'), 'utf8');
  const drawText = chart.match(/text: `REALIZED LIQ [^`]*`/);
  assert.ok(drawText, 'the liqClusterLine label no longer starts with REALIZED LIQ');
  assert.ok(/not predicted liquidation levels/i.test(chart),
    'the Liq toggle tooltip no longer says these are not predicted levels');
  assert.ok(!/PREDICTED LIQ|predicted level[s]? at|liquidation magnet/i.test(drawText[0]),
    'the drawn label implies a forward prediction');
});

test('CONTROL: the helper returns something, so the assertions above can fail', () => {
  /* "0 failures" is the least trustworthy output in this repo. A helper that
     returned [] unconditionally would satisfy every deepEqual against [] above
     and most of the rest by vacuous truth. */
  const one = topClustersForCoin([b('BTC', 109_000, 4.2e6)], 'btc');
  assert.equal(one.length, 1);
  assert.equal(one[0].price, 109_000);
  assert.equal(one[0].total, 4.2e6);
});
