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
  // The instant the final bar closes. Tests pass this as `nowMs` so the clock
  // cannot change what they assert - these silently broke when the date rolled
  // over and part of the fixture moved into the future.
  return { spot, perp, nowMs: T0 + n * HOUR };
}

test('a perfectly ordinary day does NOT read as futures-driven', () => {
  // BTC's real median is 7.8x. A naive "perp > spot" rule calls this perp-led;
  // it is simply Tuesday.
  const { spot, perp, nowMs } = series(48, 7.8);
  const r = computePerpSpot(spot, perp, HOUR, nowMs);
  assert.equal(r.lean, 'normal');
  assert.match(r.explanation, /usual proportions/);
});

test("each coin is judged against its OWN baseline, not a shared threshold", () => {
  // ETH normally runs ~14.4x and BTC ~7.8x. Both flat = both normal.
  const eth = series(48, 14.4);
  const btc = series(48, 7.8);
  assert.equal(computePerpSpot(eth.spot, eth.perp, HOUR, eth.nowMs).lean, 'normal');
  assert.equal(computePerpSpot(btc.spot, btc.perp, HOUR, btc.nowMs).lean, 'normal');
  // A fixed cross-coin cut at, say, 10x would have called ETH perp-led forever.
});

test('a genuine spike above the coin\'s own normal reads as futures-driven', () => {
  const { spot, perp, nowMs } = series(48, 8, 8 * 1.6);
  const r = computePerpSpot(spot, perp, HOUR, nowMs);
  assert.equal(r.lean, 'perp');
  assert.ok(r.relative! > PERP_LED_AT);
  assert.match(r.explanation, /leveraged traders/);
});

test('unusually quiet futures reads as spot-led', () => {
  const { spot, perp, nowMs } = series(48, 8, 8 * 0.5);
  const r = computePerpSpot(spot, perp, HOUR, nowMs);
  assert.equal(r.lean, 'spot');
  assert.ok(r.relative! < SPOT_LED_AT);
  assert.match(r.explanation, /actually buying/);
});

test('the raw pair is still computed, though no longer displayed', () => {
  // The owner revised the display from "N vs N" to a single number mid-build.
  // The pair stays available - it is the honest underlying figure and the Ask
  // AI / research prompts are a likely home for it - but nothing renders it.
  const { spot, perp, nowMs } = series(48, 11.8);
  assert.equal(computePerpSpot(spot, perp, HOUR, nowMs).pair, '$10.0M vs $118.0M');
});

test('the DISPLAYED number is relative to the coin own baseline, not the raw ratio', () => {
  // This is the number on the dashboard. The raw ratio here is 11.8x, which
  // would read as "futures dominate" - and it is an ordinary day.
  const { spot, perp, nowMs } = series(48, 11.8);
  const r = computePerpSpot(spot, perp, HOUR, nowMs);
  assert.equal(r.ratio, 11.8);
  assert.equal(r.relative, 1);
  assert.equal(r.lean, 'normal', 'an 11.8x raw ratio must still read as normal for this coin');
});

test('NO SPOT FEED reports unknown, never a number from the perp side alone', () => {
  // Many alts have no Binance spot pair. A missing spot leg looks EXACTLY like
  // a perp-dominated one unless this is explicit - the absence-as-finding shape.
  const { perp, nowMs } = series(48, 8);
  const r = computePerpSpot([], perp, HOUR, nowMs);
  assert.equal(r.lean, 'unknown');
  assert.equal(r.pair, '-');
  assert.equal(r.spotVol, null);
  assert.match(r.explanation, /unavailable/);
});

test('too few shared bars reports unknown rather than a median of noise', () => {
  const { spot, perp, nowMs } = series(MIN_BARS - 1, 8);
  assert.equal(computePerpSpot(spot, perp, HOUR, nowMs).lean, 'unknown');
});

test('bars are matched on time - a venue running a beat behind is not a signal', () => {
  const { spot, perp, nowMs } = series(48, 8);
  // Shift every perp bar by one hour: no shared timestamps at all.
  const shifted = perp.map(c => ({ ...c, time: c.time + HOUR * 1000 }));
  assert.equal(computePerpSpot(spot, shifted, HOUR, nowMs).lean, 'unknown',
    'comparing mismatched bars would yield a ratio that is really a clock difference');
});

test('zero-volume bars are skipped, not divided by', () => {
  const { spot, perp, nowMs } = series(48, 8);
  spot[10].quoteVolume = 0;
  const r = computePerpSpot(spot, perp, HOUR, nowMs);
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

/* ── the still-forming bar must not decide the verdict (QA, #333) ───────────
 *
 * Reproduces QA's measurement directly. Two minutes into an hour the forming
 * bar held ~3% of a normal hour's volume, and its ratio read "balanced" while
 * the last CLOSED hour read perp-led. Same coin, same instant, opposite
 * answers - the only difference being which bar the ratio came from.
 *
 * The baseline is a median of complete hours, so comparing an incomplete one
 * against it was never like-for-like. Same defect as #316, in a file written
 * hours after fixing #316.
 */
const H = 3600_000;

/** 168 closed hours at `ratio`, plus a thin forming hour at `formingRatio`. */
function withForming(ratio: number, lastClosedRatio: number, formingRatio: number, minsIn: number) {
  const spot = [], perp = [];
  const nowMs = T0 + 168 * H + minsIn * 60_000;
  for (let i = 0; i < 168; i++) {
    const t = T0 + i * H;
    const s = 48_900_000;
    const r = i === 167 ? lastClosedRatio : ratio;
    spot.push({ time: t, quoteVolume: s });
    perp.push({ time: t, quoteVolume: s * r });
  }
  // The forming hour: only a few minutes of volume has accumulated.
  const formingSpot = 48_900_000 * (minsIn / 60);
  spot.push({ time: T0 + 168 * H, quoteVolume: formingSpot });
  perp.push({ time: T0 + 168 * H, quoteVolume: formingSpot * formingRatio });
  return { spot, perp, nowMs };
}

test('#333: the forming bar is ignored - the verdict comes from the last CLOSED hour', () => {
  // Closed hours sit at 7.75x; the last closed hour spikes to 11.0x (perp-led);
  // the forming 2-minute bar reads 9.76x, which would be "normal".
  const { spot, perp, nowMs } = withForming(7.75, 11.0, 9.76, 2);
  const r = computePerpSpot(spot, perp, H, nowMs);

  assert.equal(r.lean, 'perp', 'the last CLOSED hour was perp-led and must decide it');
  assert.ok(Math.abs(r.ratio! - 11.0) < 0.01, `ratio came from the forming bar: ${r.ratio}`);
});

test('#333 CONTROL: without the drop, that same input reads the other way', () => {
  // Passing a nowMs far in the future makes every bar closed, INCLUDING the
  // thin one - which is exactly the old behaviour. If this does not differ from
  // the test above, the drop is not doing anything.
  const { spot, perp } = withForming(7.75, 11.0, 9.76, 2);
  const asIfAllClosed = computePerpSpot(spot, perp, H, T0 + 300 * H);

  assert.ok(Math.abs(asIfAllClosed.ratio! - 9.76) < 0.01,
    'the control must actually use the thin bar, or it proves nothing');
  assert.notEqual(asIfAllClosed.lean, 'perp',
    'the thin bar reads differently - which is the whole defect');
});

test('#333: a bar that closed exactly now still counts', () => {
  const { spot, perp } = withForming(7.75, 11.0, 9.76, 0);
  // At exactly the top of the hour the "forming" bar has just opened; the hour
  // before it is closed and must be the one used.
  const r = computePerpSpot(spot, perp, H, T0 + 168 * H);
  assert.ok(Math.abs(r.ratio! - 11.0) < 0.01);
});

/* ── Option B weighting (#340) ───────────────────────────────────────────────
 *
 * The owner chose from worked examples, so the examples are what these assert -
 * a bare coefficient is not checkable by anyone later.
 */
import {
  perpConfidenceMultiplier, perpScorePenalty,
  PERP_LED_SCORE_PENALTY,
} from '../lib/perpSpot.ts';
import { computeConfluence } from '../lib/confluence.ts';
import type { ConfluenceFactorInput } from '../lib/confluence.ts';

test("#340: the owner's worked example - a signal at 8/10 futures-led becomes 6/10", () => {
  assert.equal(8 * perpConfidenceMultiplier('perp'), 6);
});

test('#340: spot-led is the mirror at half size - 8/10 becomes 9/10', () => {
  assert.equal(8 * perpConfidenceMultiplier('spot'), 9);
});

test('#340: a normal split and an unmeasurable one both leave confidence alone', () => {
  assert.equal(perpConfidenceMultiplier('normal'), 1);
  // unknown does NOT quietly discount. A lowered number would tell the user the
  // evidence was weighed and found wanting when it was never available; the
  // surface says "could not be measured" instead.
  assert.equal(perpConfidenceMultiplier('unknown'), 1);
});

test("#340: the owner's other worked example - a Confluence score of +12 becomes +8", () => {
  // The score shrinks by `1 - penaltyW/100`, so 33 reproduces 12 -> 8.
  const shrunk = 12 * (1 - PERP_LED_SCORE_PENALTY / 100);
  assert.equal(Math.round(shrunk), 8);
});

test('#340: only futures-led penalises the score - there is no spot-led bonus', () => {
  // computeConfluence shrinks toward zero and has no mechanism to push a score
  // ABOVE its natural value. The mirror is honoured on the confidence
  // multiplier, where the mechanism exists, and flagged on #340 rather than
  // silently dropped.
  assert.equal(perpScorePenalty('perp'), PERP_LED_SCORE_PENALTY);
  assert.equal(perpScorePenalty('spot'), 0);
  assert.equal(perpScorePenalty('normal'), 0);
  assert.equal(perpScorePenalty('unknown'), 0);
});

test('#340 THE CORRECTNESS PROPERTY: no weighting can flip a verdict direction', () => {
  // QA asked for this exhaustive over the RANGE rather than spot-checked at
  // Option B's numbers, so it still holds if the owner retunes later.
  const directional = (dir: 'bull' | 'bear', weight: number): ConfluenceFactorInput =>
    ({ kind: 'directional', label: 'x', dir, weight });

  for (const bull of [0, 5, 20, 30, 50]) {
    for (const bear of [0, 5, 20, 30, 50]) {
      if (bull === bear) continue;
      const base = computeConfluence([directional('bull', bull), directional('bear', bear)]);
      for (let penalty = 0; penalty <= 100; penalty += 1) {
        const withPerp = computeConfluence([
          directional('bull', bull), directional('bear', bear),
          { kind: 'penalty', label: 'perp', weight: penalty, active: true },
        ]);
        assert.ok(
          Math.sign(withPerp.score) === Math.sign(base.score) || withPerp.score === 0,
          `penalty ${penalty} flipped ${base.score} to ${withPerp.score}`,
        );
        assert.ok(Math.abs(withPerp.score) <= Math.abs(base.score) + 1,
          `penalty ${penalty} INCREASED magnitude: ${base.score} -> ${withPerp.score}`);
      }
    }
  }
});
