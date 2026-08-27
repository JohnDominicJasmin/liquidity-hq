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
  /** Taker-buy quote-asset volume (USDT). Binance kline index 10.
   *  Optional: absent on Bybit and on older cached rows. */
  takerBuyQuoteVolume?: number;
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

/* THE OWNER'S NUMBERS, not ours. Approved on #333.
 *
 * QA put three options to them framed in BEHAVIOUR rather than in figures -
 * "fires most days" against "only on a genuinely unusual session" - and the
 * balanced one was chosen. That framing is why the answer is usable: someone
 * can pick between those without knowing what a volume ratio is, where the
 * version I originally drafted asked them to bless a number.
 *
 * Recorded here because #311 established the rule and QA was right about it:
 * a threshold invented by us is a threshold nobody can verify. If these ever
 * need changing, that is another conversation with the owner, not a tuning
 * exercise.
 *
 * Both remain reachable on the measured range - BTC's `relative` spans roughly
 * 0.29-2.44 across a normal week - and there is a control test asserting that,
 * because a threshold outside the observed range gives the feature a state it
 * can never display. */
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

/* ── Option B weighting (#340) ───────────────────────────────────────────────
 *
 * FIRST, THE DEFINITION, because everything below multiplies off it. The owner
 * restated it twice, unprompted:
 *
 *     "that perps and spot is volume take note"
 *     "perpetual and spot trading volume"
 *
 * PERPETUAL TRADING VOLUME AGAINST SPOT TRADING VOLUME. Not price, not basis,
 * not open interest, not funding. All four are plausible things to call "perps
 * vs spot" and three of them are already in this app - `basis` was sitting in
 * the same Grok prompt under nearly the same name until #343.
 *
 * If anything in the path below starts blending basis, funding or OI into this
 * factor, the number stops meaning what the owner defined and it would still
 * look reasonable. The type is the structural guard: OHLCVLike carries
 * `quoteVolume` and no price field at all, so price cannot enter without
 * someone widening it deliberately.
 *
 * THE OWNER'S NUMBERS, chosen from worked examples rather than coefficients:
 *
 *     a signal at 8/10 confidence, futures-led   ->  6/10
 *     a Confluence score of +12, futures-led     ->  +8
 *     spot-led                                    the mirror at half size
 *
 * Those examples are kept here deliberately. A bare `0.75` is not checkable by
 * anyone later; "8/10 becomes 6/10, set with the owner on #340" is. Same
 * reasoning as REAL_YIELD_THRESHOLD_BP on #311.
 *
 * DIRECTION IS NEVER AFFECTED. Futures-led means the evidence behind the
 * existing read is weaker - it does not mean the trade is the other way. On the
 * Confluence side that is structural rather than a promise: penalties feed
 * `raw *= shrink` with shrink in [0,1], which cannot change a sign.
 */

/** 8/10 -> 6/10. Applied to the chart signal's confidence. */
export const PERP_LED_CONFIDENCE = 0.75;
/** The mirror at half size: 8/10 -> 9/10. */
export const SPOT_LED_CONFIDENCE = 1.125;

/**
 * +12 -> +8 through `shrink = 1 - penaltyW / 100`, so 33 is the weight that
 * reproduces the owner's example exactly (12 * (1 - 0.33) = 8.04).
 *
 * Larger than the existing penalties (GEX 12, choppiness 15, divergence 15)
 * because it is answering a different question - those say the setup is
 * lower-quality, this says the move underneath it may not be real.
 */
export const PERP_LED_SCORE_PENALTY = 33;

/**
 * Confidence multiplier for the chart signal.
 *
 * `unknown` returns 1 and the CALLER must say the input is missing. It does not
 * silently discount, because a quietly-lowered number is its own misstatement -
 * the user sees a reduced figure and reasonably assumes the evidence was
 * weighed and found wanting, when it was never available. Reduced certainty and
 * "we could not check" are different claims and the surface has to make both.
 */
export function perpConfidenceMultiplier(lean: PerpSpotLean): number {
  return lean === 'perp' ? PERP_LED_CONFIDENCE
       : lean === 'spot' ? SPOT_LED_CONFIDENCE
       : 1;
}

/**
 * Confluence penalty weight for the perps reading.
 *
 * ONLY the futures-led case penalises. There is deliberately no spot-led bonus:
 * `computeConfluence` shrinks toward zero and has no mechanism to push a score
 * ABOVE its natural value, and inventing one would change how every existing
 * factor composes. The owner approved a mirror at half size; that half is
 * honoured on the confidence multiplier, where the mechanism exists, and is
 * flagged on #340 rather than silently dropped.
 */
export function perpScorePenalty(lean: PerpSpotLean): number {
  return lean === 'perp' ? PERP_LED_SCORE_PENALTY : 0;
}

/**
 * How the Confluence card should DRESS the perps line - never whether the score
 * moves. `perpScorePenalty` above owns that, and only `perp` moves it.
 *
 * `caution` is the amber band: `perp` is a reason to size down, and `unknown`
 * means the check could not run, which is also a reason to size down.
 *
 * `neutral` is a plain row: `normal` and `spot` are not warnings. Until this
 * existed both fell through to null and rendered NOTHING - so "spot is doing
 * the buying", the most confirming thing this measure can say, appeared nowhere
 * on the arena page (owner, in session). Showing them in amber instead would
 * turn a confirmation into a warning, which is the opposite error.
 */
export function perpNoticeTone(lean: PerpSpotLean): 'caution' | 'neutral' {
  return lean === 'perp' || lean === 'unknown' ? 'caution' : 'neutral';
}

/* ── Spot absorption of futures liquidations (#361) ──────────────────────────
 *
 * When futures traders are force-sold (liquidations), perp taker-buy drops —
 * sellers dominate. If spot taker-buy is simultaneously HIGH, real buyers are
 * absorbing those forced sales. That divergence is the signal.
 *
 * Uses the taker-buy QUOTE volume (Binance kline index 10) so both feeds are
 * USDT-denominated and comparable. The observation threshold (20pp delta) is
 * an internal calibration value, not an owner-blessed number — record here
 * so it is visible rather than buried in a constant. */

const ABSORPTION_WINDOW = 4; // last 4 closed hourly bars

export interface AbsorptionReading {
  /** Average taker-buy % on spot over the last ABSORPTION_WINDOW bars. */
  spotTakerPct: number | null;
  /** Average taker-buy % on perp over the last ABSORPTION_WINDOW bars. */
  perpTakerPct: number | null;
  /** False when taker-buy data is missing (Bybit coins, old cache rows). */
  available: boolean;
  /** Ready-to-display observation. No forecast — numbers and direction only. */
  observation: string;
}

/**
 * Cross taker-buy % between spot and perp feeds.
 *
 * Requires `takerBuyQuoteVolume` on both feeds — returns `available: false`
 * for any coin without it (Bybit, or rows fetched before the field was added).
 * Never fabricates: an absent reading is an explicit "unknown", not a quiet 50%.
 */
export function computeAbsorption(
  spot: readonly OHLCVLike[],
  perp: readonly OHLCVLike[],
  intervalMs = 3_600_000,
  nowMs = Date.now(),
): AbsorptionReading {
  const unavailable: AbsorptionReading = {
    spotTakerPct: null, perpTakerPct: null,
    available: false,
    observation: 'Taker-buy data unavailable for this coin.',
  };

  if (spot.length === 0 || perp.length === 0) return unavailable;

  const closedSpot = dropForming(spot, intervalMs, nowMs);
  const closedPerp = dropForming(perp, intervalMs, nowMs);

  const perpByTime = new Map(closedPerp.map(c => [c.time, c]));
  const paired: Array<{ spotPct: number; perpPct: number }> = [];

  for (const s of closedSpot) {
    const p = perpByTime.get(s.time);
    if (!p) continue;
    if (s.takerBuyQuoteVolume == null || p.takerBuyQuoteVolume == null) continue;
    if (s.quoteVolume <= 0 || p.quoteVolume <= 0) continue;
    paired.push({
      spotPct: (s.takerBuyQuoteVolume / s.quoteVolume) * 100,
      perpPct:  (p.takerBuyQuoteVolume  / p.quoteVolume)  * 100,
    });
  }

  if (paired.length < MIN_BARS) return unavailable;

  const window = paired.slice(-ABSORPTION_WINDOW);
  const spotPct = window.reduce((s, x) => s + x.spotPct, 0) / window.length;
  const perpPct = window.reduce((s, x) => s + x.perpPct, 0) / window.length;
  const sp = Math.round(spotPct);
  const pp = Math.round(perpPct);
  const delta = sp - pp;

  /* 20pp threshold is internal — not an owner-blessed number. A spot-led gap
   * of 68% vs 34% (the owner's example, 34pp) clears it comfortably. */
  const observation =
    delta >= 20
      ? `Spot buying absorbing futures selling — ${sp}% taker-buy on spot against ${pp}% on perps.`
      : delta <= -20
      ? `Futures buyers leading spot — ${pp}% taker-buy on perps against ${sp}% on spot.`
      : `Spot and perps moving together — ${sp}% taker-buy on spot, ${pp}% on perps.`;

  return { spotTakerPct: spotPct, perpTakerPct: perpPct, available: true, observation };
}
