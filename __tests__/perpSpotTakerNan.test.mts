/* #2490: a degraded venue sending NaN (or Infinity) for a taker-buy or quote volume must read UNAVAILABLE, never "NaN% taker-buy".
 *   N1  control: 30 clean bars give finite percentages and a sentence with no NaN
 *   N2  some bars with a NaN / Infinity taker figure or a NaN quote volume are skipped like missing ones: the reading stays available from the clean bars and prints no NaN
 *   N3  so many bad bars that fewer than MIN_BARS pair up: unavailable, with the stock sentence
 *   N4  every bar NaN: unavailable (not a NaN average)
 * WHAT IT CANNOT PROVE: that Binance ever sends NaN (the reading came from a degraded venue and a cached row in the field). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAbsorption, MIN_BARS, type OHLCVLike } from '../lib/perpSpot.ts';

const HOUR = 3_600_000, T0 = Date.UTC(2026, 10, 1); const NOW = T0 + 80 * HOUR;
const bar = (i: number, over: Partial<OHLCVLike> = {}): OHLCVLike => ({ time: T0 + i * HOUR, quoteVolume: 1000, takerBuyQuoteVolume: 500, ...over });
const series = (n: number, bad: (i: number) => Partial<OHLCVLike> | null = () => null) => Array.from({ length: n }, (_, i) => bar(i, bad(i) ?? {}));
const noNaN = (s: string) => assert.doesNotMatch(s, /NaN|Infinity/, `printed: ${s}`);

test('N1. control: clean bars read finite and say so', () => {
  const r = computeAbsorption(series(30), series(30), HOUR, NOW);
  assert.equal(r.available, true); assert.ok(Number.isFinite(r.spotTakerPct!) && Number.isFinite(r.perpTakerPct!)); assert.equal(Math.round(r.spotTakerPct!), 50); noNaN(r.observation);
});

test('N2. a few bad bars are skipped, the rest still read', () => {
  const badSpot = (i: number) => (i % 7 === 0 ? { takerBuyQuoteVolume: Number.NaN } : i % 11 === 0 ? { takerBuyQuoteVolume: Infinity } : i % 13 === 0 ? { quoteVolume: Number.NaN } : null);
  const r = computeAbsorption(series(40, badSpot), series(40, (i) => (i === 3 ? { takerBuyQuoteVolume: Number.NaN } : null)), HOUR, NOW);
  assert.equal(r.available, true, 'enough clean bars remain'); assert.ok(Number.isFinite(r.spotTakerPct!) && Number.isFinite(r.perpTakerPct!)); noNaN(r.observation);
});

test('N3/N4. too few clean bars, or none: unavailable with the stock sentence', () => {
  const mostlyBad = computeAbsorption(series(30, (i) => (i >= MIN_BARS - 4 ? { takerBuyQuoteVolume: Number.NaN } : null)), series(30), HOUR, NOW);
  assert.equal(mostlyBad.available, false); assert.equal(mostlyBad.spotTakerPct, null); assert.equal(mostlyBad.observation, 'Taker-buy data unavailable for this coin.');
  const allBad = computeAbsorption(series(30, () => ({ takerBuyQuoteVolume: Number.NaN })), series(30), HOUR, NOW);
  assert.equal(allBad.available, false); noNaN(allBad.observation);
});
