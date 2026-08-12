/* Perps vs spot - is a move real buying, or futures traders? (#328)
 *
 * ── THE MEASUREMENT THAT DECIDED THE DESIGN ─────────────────────────────────
 *
 * The owner asked for "a number like N vs N". Taken literally that is spot
 * volume beside perp volume, and on its own it would be useless. Measured
 * against Binance, 168 hourly bars:
 *
 *     coin   latest spot   latest perp   ratio   7d median ratio
 *     BTC        37.6M        444.1M     11.80        7.80
 *     ETH        10.0M        218.0M     21.78       14.41
 *     SOL         3.5M         41.5M     11.75       10.43
 *
 * Perps are SEVEN TO FOURTEEN TIMES spot as the normal state. A pair shown raw
 * would say "futures dominate" every hour of every day, correctly and
 * uselessly - and any fixed cross-coin threshold would be wrong too, because
 * BTC's normal is 7.8 and ETH's is 14.4.
 *
 * So the pair is what gets DISPLAYED, because that is what was asked for and it
 * is honest. The READING comes from the ratio measured against that coin's own
 * recent baseline. "Perp share is 1.5x its own normal" is a statement about
 * today; "perps are 11x spot" is a statement about crypto market structure.
 *
 * ── WHY QUOTE VOLUME ────────────────────────────────────────────────────────
 *
 * Kline index 7 is quote-asset volume (USDT), not base volume. Base volume
 * would compare BTC-denominated spot against contract counts and is not
 * comparable across the two venues.
 */

import { dropForming } from './candles.ts';

export interface OHLCVLike {
  time: number;
  /** Quote-asset volume - USDT, comparable between spot and perp. */
  quoteVolume: number;
}

export type PerpSpotLean = 'spot' | 'perp' | 'normal' | 'unknown';

export interface PerpSpotReading {
  spotVol: number | null;
  perpVol: number | null;
  /** perp / spot on the latest shared bar. */
  ratio: number | null;
  /** Median ratio across the window - this coin's own normal. */
  baseline: number | null;
  /** ratio / baseline. 1.0 is a completely ordinary day. */
  relative: number | null;
  lean: PerpSpotLean;
  /** The pair, formatted as the owner asked: "N vs N". */
  pair: string;
  /** Plain language, for someone who does not know what a perp is. */
  explanation: string;
}

/* PROVISIONAL, and flagged as such on #328 rather than presented as settled.
 *
 * From the 168-bar sample, BTC's ratio ranged 2.29-19.07 around a median of
 * 7.80, so `relative` spans roughly 0.29-2.44 in a normal week. 1.3 and 0.75
 * sit inside that range without firing constantly.
 *
 * They are still numbers we chose. #311's threshold came from the owner, and QA
 * was right that "a threshold invented by us is a threshold nobody can verify" -
 * so these are defaults pending the same conversation, not a hidden judgement. */
export const PERP_LED_AT = 1.30;
export const SPOT_LED_AT = 0.75;

/** Enough bars to have a stable median; below this the baseline is noise. */
export const MIN_BARS = 24;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Compact money for display: 444100000 -> "$444.1M". */
export function fmtVol(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

const UNAVAILABLE: PerpSpotReading = {
  spotVol: null, perpVol: null, ratio: null, baseline: null, relative: null,
  lean: 'unknown', pair: '-',
  explanation: 'Spot data unavailable for this coin, so we cannot tell whether a move is real buying or futures.',
};

/**
 * Compare spot and perp activity for one coin.
 *
 * THE STILL-FORMING BAR IS DROPPED FIRST, and it is not a detail. QA measured
 * both readings two minutes into an hour:
 *
 *     FORMING bar   spot  1.6M  perp  15.7M  ratio  9.76  relative 1.26x -> balanced
 *     LAST CLOSED   spot 48.9M  perp 539.0M  ratio 11.01  relative 1.42x -> PERP-LED
 *
 * Same coin, same instant, opposite verdicts. At two minutes past, the forming
 * hour holds ~3% of a normal hour's volume, so its ratio is a thin noisy slice
 * being compared against a median built from 167 COMPLETE hours. The comparison
 * was not like-for-like, and PERP_LED_AT sits close enough to the middle that
 * the noise crosses it.
 *
 * This is #316 again in a new place - a live reading taken from an incomplete
 * bar while everything it is measured against uses closed ones. Costs up to one
 * bar of freshness on a series whose baseline is a 7-day median; the number is
 * not trying to be real-time.
 *
 * Bars are matched on `time`. Comparing the latest spot bar against the latest
 * perp bar when one venue is a beat behind produces a ratio that is really a
 * clock difference - the sort of number that looks like a finding and is not.
 *
 * Returns `unknown` rather than a plausible number whenever it cannot answer:
 * no spot feed (many alts have no Binance spot pair), too few shared bars, or a
 * zero-volume bar. An absent reading and a quiet one must not look the same.
 */
export function computePerpSpot(
  spot: readonly OHLCVLike[], perp: readonly OHLCVLike[],
  intervalMs = 3_600_000, nowMs = Date.now(),
): PerpSpotReading {
  if (spot.length === 0 || perp.length === 0) return UNAVAILABLE;

  const closedSpot = dropForming(spot, intervalMs, nowMs);
  const closedPerp = dropForming(perp, intervalMs, nowMs);

  const perpByTime = new Map(closedPerp.map(c => [c.time, c.quoteVolume]));
  const paired: Array<{ time: number; s: number; p: number }> = [];
  for (const c of closedSpot) {
    const p = perpByTime.get(c.time);
    if (p !== undefined && c.quoteVolume > 0 && p > 0) {
      paired.push({ time: c.time, s: c.quoteVolume, p });
    }
  }
  if (paired.length < MIN_BARS) return UNAVAILABLE;

  paired.sort((a, b) => a.time - b.time);
  const latest = paired[paired.length - 1];
  const ratio = latest.p / latest.s;
  const baseline = median(paired.map(x => x.p / x.s));
  if (baseline === null || !(baseline > 0)) return UNAVAILABLE;

  const relative = ratio / baseline;
  const lean: PerpSpotLean =
    relative >= PERP_LED_AT ? 'perp' :
    relative <= SPOT_LED_AT ? 'spot' : 'normal';

  const pair = `${fmtVol(latest.s)} vs ${fmtVol(latest.p)}`;
  const times = `${relative.toFixed(1)}x`;

  /* Written for someone who does not know what a perp is - the owner asked for
     the explanation explicitly, which means it is the part they will read. */
  const explanation =
    lean === 'perp'
      ? `Futures trading is ${times} its usual share against spot. The move is being driven by leveraged traders more than by people buying the coin itself, which unwinds faster if it turns.`
      : lean === 'spot'
        ? `Futures trading is unusually quiet at ${times} its usual share. More of this move is people actually buying the coin, which tends to hold better.`
        : `Futures and spot are trading in their usual proportions for this coin. Nothing unusual about who is driving the move.`;

  return { spotVol: latest.s, perpVol: latest.p, ratio, baseline, relative, lean, pair, explanation };
}
