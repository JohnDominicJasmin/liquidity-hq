/* QA: PR #2718 (#1651, PM lane 1), liquidation prices are PER-TOKEN at the feed and the Arena converts the selected coin's clusters to the chart's unit once. It RETIRES the #2707 hiding of the Liq layer for sats / tag / toshi / turbo (liqMixedUnits2707 L1-L7 are replaced by this file).
 *
 * THE WRITTEN RULE (PM + Dev's PR): the exchanges quote 1000x contracts per 1000 tokens (1000PEPEUSDT) and some coins differently on each venue (sats 10000x Bybit / 1000x Binance; tag, toshi, turbo 1000x Bybit / per-token Binance). Every liquidation price is converted to PER-TOKEN where it enters the browser's feed:
 * a live message by its own symbol, a stored row (lhq_liq_events keeps the raw price, coin and venue 'BB' / 'BN') by the coin's listing on that venue. The Arena then multiplies the SELECTED coin's clusters by arenaPriceUnit(coin) once, so levels sit in the chart's unit whichever venue reported them. The cluster
 * bucket (price rounding) for a price under 0.1 is one decade under the price (1 to 10 % of it): the old fixed 0.01 rounded every price under half a cent to 0 and a price of 0 is dropped, so PEPE (per-token 0.0000037) never had a cluster. Prices from 0.1 up keep their tiers.
 *   U1  liqPerTokenFactor on a written table and over the whole universe: the denomination of the coin's symbol on the reporting venue, 1 for an unknown coin or venue
 *   U2  bucketSz: unchanged tiers from 0.1 up; under 0.1 the bucket is 1-10 % of the price at every magnitude down to 1e-9, a snapped price never becomes 0 (control: the old 0.01 does); invalid input keeps the 0.01 fallback
 *   U3  the whole chain, every 1000x and mixed coin on both venues: a venue's price -> per-token (live by symbol, stored by factor) -> x arenaPriceUnit = the PRIMARY venue's own price: the same token price gives one chart-unit level whichever venue reported it
 *   U4  the Arena page: arenaLiqClusters converts only the selected coin's buckets (case-insensitive), leaves other coins and ordinary coins unchanged; the chart layer, the strategies' liquidation levels, the AI line and the effect deps read it; the #2707 gating (liqUnitsMixed / liqMixedUnits) is gone from the page and the panel
 *   U5  LiqFeed: a live event is converted by its own symbol, a stored row by liqPerTokenFactor before it is compared or merged, and the localStorage key moved to v3 so v2 raw-unit rows are ignored
 *   U6  the AI line quotes a sats / tag / toshi / turbo cluster (no "Not used" line any more) and the raid-guard stays keyed on an EMPTY feed
 * WHAT THIS CANNOT PROVE: the layer drawn on the real chart for these coins and the /liq page reading per-token prices (the browser run after promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { coinRow, venueSymbols, arenaPriceUnit, UNIVERSE_COINS, symbolDenominationFactor } from '../lib/coins.ts';
import { liqPerTokenFactor } from '../lib/liqUnits.ts';
import { bucketSz, formatClustersForPrompt, topClustersForCoin } from '../lib/liqClusters.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1e-30, Math.abs(b));
/* independent derivation of a symbol's denomination: a leading power of ten of at least 1000 */
const denom = (sym: string | null | undefined) => { const m = /^(\d+)/.exec(sym ?? ''); const n = m ? Number(m[1]) : 1; return n >= 1000 && Number.isInteger(Math.log10(n)) ? 1 / n : 1; };

test('U1. liqPerTokenFactor: the written table and the universe sweep', () => {
  const T: Array<[string, string, number]> = [['pepe', 'BB', 0.001], ['pepe', 'BN', 0.001], ['PEPE', 'BB', 0.001], ['bonk', 'BB', 0.001], ['sats', 'BB', 0.0001], ['sats', 'BN', 0.001], ['tag', 'BB', 0.001], ['tag', 'BN', 1], ['toshi', 'BN', 1], ['turbo', 'BB', 0.001], ['mog', 'BB', 0.000001], ['btc', 'BB', 1], ['btc', 'BN', 1], ['zzz_unknown', 'BB', 1], ['pepe', 'XX', 1], ['pepe', '', 1]];
  for (const [c, s, want] of T) assert.ok(near(liqPerTokenFactor(c, s), want), `${c}/${s}: ${liqPerTokenFactor(c, s)} vs ${want}`);
  let moved = 0;
  for (const c of UNIVERSE_COINS as string[]) { const row = coinRow(c); for (const [src, sym] of [['BB', row?.bybit], ['BN', row?.binance]] as const) { const f = liqPerTokenFactor(c, src); assert.ok(near(f, denom(sym)), `${c}/${src} (${sym}): ${f}`); if (f !== 1) moved++; } }
  console.log(`[U1] ${moved} coin/venue pairs carry a non-1 factor`); assert.ok(moved >= 20 && moved <= 40, 'control: the 1000x family is neither empty nor everything');
});

test('U2. bucketSz: tiers from 0.1 up unchanged, sub-dime = 1-10 % of the price, never snaps to 0', () => {
  for (const [p, want] of [[10_000, 200], [76_000, 200], [1_000, 20], [100, 2], [10, 0.5], [1, 0.1], [0.5, 0.01], [0.1, 0.01]] as const) assert.ok(near(bucketSz(p), want), `bucketSz(${p}) = ${bucketSz(p)} vs ${want}`);
  for (const [p, want] of [[0.05, 0.001], [0.0037, 0.0001], [0.0000037, 0.0000001], [0.0000231, 0.000001]] as const) assert.ok(near(bucketSz(p), want, 1e-6), `bucketSz(${p}) = ${bucketSz(p)} vs ${want}`);
  for (let e = -9; e <= -2; e++) for (const m of [1, 1.5, 2.2, 3.7, 5, 7.3, 9.9]) {
    const p = m * Math.pow(10, e); const sz = bucketSz(p); const r = sz / p;
    assert.ok(r > 0.0099 && r <= 0.1001, `price ${p}: bucket ${sz} is ${(r * 100).toFixed(2)} % of it`); assert.ok(Math.round(p / sz) * sz > 0, `price ${p} snaps to 0`);
  }
  assert.equal(Math.round(0.0000037 / 0.01) * 0.01, 0, 'control: the OLD fixed 0.01 tier really does snap PEPE to 0');
  for (const bad of [0, -1, NaN]) assert.equal(bucketSz(bad), 0.01, `invalid ${bad} must keep the 0.01 fallback`);
});

test('U3. the whole chain: one token price, any venue, any 1000x or mixed coin -> the primary venue\'s own price', () => {
  const coins = (UNIVERSE_COINS as string[]).filter((c) => arenaPriceUnit(c) !== 1 || ['sats', 'tag', 'toshi', 'turbo'].includes(c)); const token = 0.004; let n = 0;
  for (const c of coins) {
    const v = venueSymbols(c); const primary = v.bybit ?? v.binance!; const primaryPrice = token / denom(primary);   // what the primary venue quotes for this token price
    for (const [src, sym] of [['BB', coinRow(c)?.bybit], ['BN', coinRow(c)?.binance]] as const) {
      if (!sym) continue; const venuePrice = token / denom(sym);
      const live = venuePrice * symbolDenominationFactor(sym); const stored = venuePrice * liqPerTokenFactor(c, src);
      assert.ok(near(live, token), `${c}/${src} live: ${live} vs per-token ${token}`); assert.ok(near(stored, token), `${c}/${src} stored: ${stored}`);
      assert.ok(near(stored * arenaPriceUnit(c), primaryPrice, 1e-9), `${c}/${src}: chart-unit level ${stored * arenaPriceUnit(c)} vs the primary venue's ${primaryPrice}`); n++;
    }
  }
  console.log(`[U3] ${coins.length} coins, ${n} venue legs`); assert.ok(n >= 20);
});

test('U4. the Arena page converts only the selected coin once and no longer gates the layer', () => {
  const page = read('app/(main)/arena/page.tsx'); const A = 'const arenaLiqClusters = useMemo(() => {'; const Z = '}, [liqClusters, selectedCoin]);';
  const a = page.indexOf(A), z = page.indexOf(Z, a); assert.ok(a > 0 && z > a, 'CONTROL: arenaLiqClusters was not found'); const body = page.slice(a + A.length, z);
  const run = new Function('arenaPriceUnit', 'liqClusters', 'selectedCoin', `return (() => {${stripTypeScriptTypes(`function _x() {${body}}`).replace(/^function _x\(\) \{/, '').replace(/\}\s*$/, '')}})();`) as (u: (c: string) => number, b: unknown[], s: string) => Array<{ coin: string; price: number; total: number }>;
  const B = [{ coin: 'PEPE', price: 0.0000037, total: 5 }, { coin: 'pepe', price: 0.0000041, total: 3 }, { coin: 'BTC', price: 70_000, total: 9 }, { coin: 'SOL', price: 80, total: 2 }];
  const pepe = run(arenaPriceUnit, B, 'pepe'); assert.ok(near(pepe[0].price, 0.0037) && near(pepe[1].price, 0.0041), 'the selected coin is not in the chart unit'); assert.equal(pepe[2].price, 70_000); assert.equal(pepe[3].price, 80); assert.equal(B[0].price, 0.0000037, 'the input list was mutated');
  assert.deepEqual(run(arenaPriceUnit, B, 'btc'), B, 'an ordinary coin must be unchanged'); assert.ok(near(run(arenaPriceUnit, [{ coin: 'SATS', price: 0.00000042, total: 1 }], 'sats')[0].price, 0.0042), 'sats goes to the 10000x unit');
  assert.match(page, /topClustersForCoin\(arenaLiqClusters, selectedCoin\)/); assert.match(page, /formatClustersForPrompt\(arenaLiqClusters, selectedCoin\)/); assert.match(page, /resultsCache, arenaLiqClusters, locale\]/, 'the AI context effect must depend on the converted list');
  assert.doesNotMatch(page, /liqUnitsMixed|liqMixedUnits/, 'the #2707 gating is still in the page'); assert.doesNotMatch(read('components/StrategyPanel.tsx'), /liqMixedUnits|STRATEGY_PANEL_LIQ_MIXED_UNITS/, 'the #2707 chip reason / note is still in the panel');
});

test('U5. LiqFeed converts a live event by its symbol, a stored row by its venue, and ignores the v2 raw-unit cache', () => {
  const f = read('components/LiqFeed.tsx');
  assert.match(f, /price: price \* symbolDenominationFactor\(sym\)/, 'a live event is not converted by its own symbol'); assert.match(f, /r\.price \* liqPerTokenFactor\(r\.coin, r\.source\)/, 'a stored row is not converted before it is compared or merged');
  assert.match(f, /STORAGE_KEY\s*=\s*'liq-events-v3'/, 'the cache key must move to v3 (v2 holds raw contract-unit prices)');
});

test('U6. the AI line quotes a former mixed-unit coin\'s clusters; the raid guard stays on an empty feed', () => {
  const bucket = (coin: string, price: number) => ({ coin, price, total: 1_500_000, longUsd: 1_000_000, shortUsd: 500_000 });
  for (const [coin, price, want] of [['sats', 4.2, '$4.2'], ['tag', 3.8, '$3.8'], ['toshi', 0.25, '$0.25'], ['turbo', 6.1, '$6.1']] as const) {
    const line = formatClustersForPrompt([bucket(coin, price)], coin); assert.ok(line.startsWith(want), `${coin}: "${line}"`); assert.doesNotMatch(line, /^Not /, `${coin} still reads as not used`);
    assert.equal(topClustersForCoin([bucket(coin.toUpperCase(), price)], coin).length, 1);
  }
  assert.equal(formatClustersForPrompt([], 'sats'), 'Not available', 'an empty feed still reads Not available (the raid guard\'s key)');
});
