/* #328 - perps vs spot.
 *
 * The load-bearing test is `a perfectly ordinary day does not read as
 * futures-driven`. Perps are 7-14x spot as the NORMAL state, so the obvious
 * implementation - compare the two numbers, call the bigger one the driver -
 * would fire every hour of every day and be right about market structure while
 * telling the user nothing about today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePerpSpot, fmtVol, PERP_LED_AT, SPOT_LED_AT, MIN_BARS,
} from '../lib/perpSpot.ts';

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 7, 12, 0, 0, 0);

/** n bars where perp = spot * ratio, with the last bar optionally different. */
function series(n: number, ratio: number, lastRatio = ratio) {
  const spot = [], perp = [];
  for (let i = 0; i < n; i++) {
    const t = T0 + i * HOUR;
    const s = 10_000_000;
    const r = i === n - 1 ? lastRatio : ratio;
    spot.push({ time: t, quoteVolume: s });
    perp.push({ time: t, quoteVolume: s * r });
  }
  return { spot, perp };
}

test('a perfectly ordinary day does NOT read as futures-driven', () => {
  // BTC's real median is 7.8x. A naive "perp > spot" rule calls this perp-led;
  // it is simply Tuesday.
  const { spot, perp } = series(48, 7.8);
  const r = computePerpSpot(spot, perp);
  assert.equal(r.lean, 'normal');
  assert.match(r.explanation, /usual proportions/);
});

test("each coin is judged against its OWN baseline, not a shared threshold", () => {
  // ETH normally runs ~14.4x and BTC ~7.8x. Both flat = both normal.
  assert.equal(computePerpSpot(...Object.values(series(48, 14.4)) as [never, never]).lean, 'normal');
  assert.equal(computePerpSpot(...Object.values(series(48, 7.8)) as [never, never]).lean, 'normal');
  // A fixed cross-coin cut at, say, 10x would have called ETH perp-led forever.
});

test('a genuine spike above the coin\'s own normal reads as futures-driven', () => {
  const { spot, perp } = series(48, 8, 8 * 1.6);
  const r = computePerpSpot(spot, perp);
  assert.equal(r.lean, 'perp');
  assert.ok(r.relative! > PERP_LED_AT);
  assert.match(r.explanation, /leveraged traders/);
});

test('unusually quiet futures reads as spot-led', () => {
  const { spot, perp } = series(48, 8, 8 * 0.5);
  const r = computePerpSpot(spot, perp);
  assert.equal(r.lean, 'spot');
  assert.ok(r.relative! < SPOT_LED_AT);
  assert.match(r.explanation, /actually buying/);
});

test('the raw pair is still computed, though no longer displayed', () => {
  // The owner revised the display from "N vs N" to a single number mid-build.
  // The pair stays available - it is the honest underlying figure and the Ask
  // AI / research prompts are a likely home for it - but nothing renders it.
  const { spot, perp } = series(48, 11.8);
  assert.equal(computePerpSpot(spot, perp).pair, '$10.0M vs $118.0M');
});

test('the DISPLAYED number is relative to the coin own baseline, not the raw ratio', () => {
  // This is the number on the dashboard. The raw ratio here is 11.8x, which
  // would read as "futures dominate" - and it is an ordinary day.
  const { spot, perp } = series(48, 11.8);
  const r = computePerpSpot(spot, perp);
  assert.equal(r.ratio, 11.8);
  assert.equal(r.relative, 1);
  assert.equal(r.lean, 'normal', 'an 11.8x raw ratio must still read as normal for this coin');
});

test('NO SPOT FEED reports unknown, never a number from the perp side alone', () => {
  // Many alts have no Binance spot pair. A missing spot leg looks EXACTLY like
  // a perp-dominated one unless this is explicit - the absence-as-finding shape.
  const { perp } = series(48, 8);
  const r = computePerpSpot([], perp);
  assert.equal(r.lean, 'unknown');
  assert.equal(r.pair, '-');
  assert.equal(r.spotVol, null);
  assert.match(r.explanation, /unavailable/);
});

test('too few shared bars reports unknown rather than a median of noise', () => {
  const { spot, perp } = series(MIN_BARS - 1, 8);
  assert.equal(computePerpSpot(spot, perp).lean, 'unknown');
});

test('bars are matched on time - a venue running a beat behind is not a signal', () => {
  const { spot, perp } = series(48, 8);
  // Shift every perp bar by one hour: no shared timestamps at all.
  const shifted = perp.map(c => ({ ...c, time: c.time + HOUR * 1000 }));
  assert.equal(computePerpSpot(spot, shifted).lean, 'unknown',
    'comparing mismatched bars would yield a ratio that is really a clock difference');
});

test('zero-volume bars are skipped, not divided by', () => {
  const { spot, perp } = series(48, 8);
  spot[10].quoteVolume = 0;
  const r = computePerpSpot(spot, perp);
  assert.equal(r.lean, 'normal');
  assert.ok(Number.isFinite(r.ratio!), 'a zero spot bar must not produce Infinity');
});

test('fmtVol matches the shape used in the measurement on #328', () => {
  assert.equal(fmtVol(444_100_000), '$444.1M');
  assert.equal(fmtVol(37_600_000), '$37.6M');
  assert.equal(fmtVol(2_300_000_000), '$2.3B');
  assert.equal(fmtVol(4_270), '$4K');
});

test('CONTROL: the thresholds actually discriminate on the measured range', () => {
  // BTC ranged 2.29-19.07 around a 7.80 median, i.e. relative 0.29-2.44. If the
  // thresholds sat outside that, one verdict would be unreachable in practice
  // and the feature would have a state it could never show.
  const rel = (r: number) => r / 7.8;
  assert.ok(rel(19.07) > PERP_LED_AT, 'the observed high must be reachable as perp-led');
  assert.ok(rel(2.29) < SPOT_LED_AT, 'the observed low must be reachable as spot-led');
  assert.ok(rel(7.8) > SPOT_LED_AT && rel(7.8) < PERP_LED_AT, 'the median must read normal');
});
