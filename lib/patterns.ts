/* Candle and short-window formations, read from the last 25 bars.
 *
 * ── THE ADVICE CLAUSES ARE GONE, 2026-11-08 ─────────────────────────────────────────────────────
 *
 * These strings reach a user over Telegram and on the Arena. Six of them carried a prediction:
 *
 *     'Doji (indecision)'                                    -> 'Doji'
 *     'Hammer (bullish reversal)'                            -> 'Hammer'
 *     'Shooting star (bearish reversal)'                     -> 'Shooting star'
 *     'Double top (bearish reversal setup)'                  -> 'Double top'
 *     'Double bottom (bullish reversal setup)'               -> 'Double bottom'
 *     'Tight consolidation (compression - breakout pending)' -> 'Tight consolidation'
 *
 * PRODUCT.md rule 1 bans accuracy and outcome claims, and nothing here measured any of them.
 * "breakout pending" is the plainest: a flat prediction about the next bars, sent to a paying user,
 * with no evidence behind it. The NAMES stay because a name is a description; the parentheses were
 * the claim.
 *
 * This was found the other way round. #1818's teaching panel was written under a rule that it may
 * describe a shape and say what traders WATCH FOR, never what the shape does - and the owner's own
 * phrase "expected action" was refused on that basis. QA then measured that the OLD path was
 * already shipping exactly what the new one had been forbidden. Mirroring the two had to run in
 * this direction; the new layer adopting the old voice would have been the easy mistake.
 *
 * THE PATTERN-BIAS HELPER IS DELETED. It returned 'bullish' | 'bearish' | 'neutral' from a list of these
 * names - the most advice-shaped function in the codebase - and had ZERO callers across app/,
 * components/, lib/, qa/ and __tests__/. QA checked all five. Deleted rather than maintained: an
 * unused function that converts descriptions into a directional verdict is a loaded gun in a
 * drawer.
 *
 * ITS NAME IS DELIBERATELY NOT WRITTEN HERE. QA's review of this change made the point: a grep for
 * a removed identifier that still hits the comment documenting its removal reports it as live, and
 * #1263 already carries that trap from `useEMAStrategy.ts`. So the record stays and the token goes -
 * `git log -S` finds the deletion, and a search for callers finds nothing, which is the truth.
 *
 * ── WHAT THIS FILE IS AND IS NOT, now that #1818 exists ─────────────────────────────────────────
 *
 * 25 bars. `lib/chartPatterns.ts` needs about 200 before a rail fits, so the two are not rival
 * implementations of one idea - they answer different questions from different amounts of evidence.
 * One- and two-candle formations are honest here and `chartPatterns` does not detect them at all.
 *
 * The one genuine collision is `Bull flag` / `Bear flag`: both files emit those exact words, and on
 * the same 200 bars they disagree - this file says "Bull flag", `chartPatterns` says
 * `channel_rising`. That is a contradiction a user can see, and it is resolved by this file losing
 * them once the teaching panel is wired to a page. Removing them before then would mean nothing in
 * the product says "bull flag" at all, which is a worse state than the disagreement.
 */
/**
 * Chart pattern detection - pure OHLC logic.
 * Works in browser (MarketProvider, Arena) and Node.js (Telegram alert route).
 */

export interface Candle {
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
}

/**
 * Detect basic chart patterns from an array of OHLC candles (oldest → newest).
 * Returns array of pattern strings, empty if none found.
 */
export function detectPatterns(candles: Candle[]): string[] {
  if (candles.length < 6) return [];
  const found: string[] = [];

  const last = candles[candles.length - 1];

  // ── 1. Trend structure (last 10 candles - sequential highs/lows) ──
  const r10 = candles.slice(-10);
  const highs10 = r10.map(c => c.h);
  const lows10  = r10.map(c => c.l);
  /* MONOTONIC *AND* ACTUALLY HIGHER AT THE END (QA, #1263 defect 1).
   *
   * These were `>=` on both sides with no net-progress test, so TEN IDENTICAL CANDLES satisfied
   * both and a dead-flat market reported an uptrend. Verified: 12 candles of o=h=l=c=100 returned
   * 'Higher highs + higher lows (uptrend)'.
   *
   * IT WAS THE WORST POSSIBLE PLACE FOR IT. This is the first `found.push` in the function and
   * `app/api/telegram/alert/route.ts` sends `pats[0]`, so on a flat market this was not one label
   * among several - it was THE label a paying user received.
   *
   * Same shape as the RSI flat-series defect in #2015 this week: an unknown or absent reading
   * resolving to a confident directional answer. There, no price movement produced RSI 100
   * (maximally overbought); here, no price movement produced "uptrend".
   *
   * `>=` STAYS ON THE STEPS, and that is deliberate rather than a half-fix. Equal highs are
   * ordinary in real candles and demanding strict increase at every step would reject genuine
   * trends on any series with one repeated high. What was missing is net progress, so that is what
   * is added: non-decreasing throughout AND higher at the end than at the start. A flat series
   * fails on the second test, which is the one it should fail. */
  const allHH = highs10.every((h, i) => i === 0 || h >= highs10[i - 1]);
  const allHL = lows10.every ((l, i) => i === 0 || l >= lows10[i - 1]);
  const allLH = highs10.every((h, i) => i === 0 || h <= highs10[i - 1]);
  const allLL = lows10.every ((l, i) => i === 0 || l <= lows10[i - 1]);
  const roseNet = highs10[highs10.length - 1] > highs10[0] && lows10[lows10.length - 1] > lows10[0];
  const fellNet = highs10[highs10.length - 1] < highs10[0] && lows10[lows10.length - 1] < lows10[0];
  if (allHH && allHL && roseNet) found.push('Higher highs + higher lows (uptrend)');
  else if (allLH && allLL && fellNet) found.push('Lower highs + lower lows (downtrend)');

  // ── 2. Engulfing (last 2 candles) ──
  if (candles.length >= 2) {
    const [p, c] = candles.slice(-2);
    const pr = Math.abs(p.c - p.o);
    const cr = Math.abs(c.c - c.o);
    /* THE `cr >= pr * 0.8` RATIO IS GONE BECAUSE IT COULD NEVER FAIL (QA, #1263 defect 3).
     *
     * In the bearish case `pr = p.c - p.o` and `cr = c.o - c.c`, and the guards in front of it -
     * `c.o >= p.c` and `c.c <= p.o` - force `c.o - c.c >= p.c - p.o`, so `cr >= pr` holds
     * arithmetically and a 0.8 multiple of it cannot bind. The bullish branch is symmetric.
     * Measured: 200,000 generated inputs that passed the geometric guards, the ratio failed on 0.
     *
     * Harmless, but it READ as a tunable threshold and was not one - anyone loosening 0.8 to widen
     * engulfing detection would have changed nothing and gone looking elsewhere for the reason.
     *
     * HOW QA FOUND IT IS THE REUSABLE PART: it was a mutation their suite could not kill, and an
     * unkillable mutation is either a missing test or unreachable code. Only reading the source
     * says which. A line nobody can break is not necessarily covered - it may be dead. */
    if (p.c > p.o && c.c < c.o && c.o >= p.c && c.c <= p.o)
      found.push('Bearish engulfing');
    if (p.c < p.o && c.c > c.o && c.o <= p.c && c.c >= p.o)
      found.push('Bullish engulfing');
  }

  // ── 3. Doji - indecision (body < 10% of total range) ──
  const wick = last.h - last.l;
  if (wick > 0 && Math.abs(last.c - last.o) / wick < 0.1)
    found.push('Doji');

  // ── 4. Hammer / Shooting star (last candle) ──
  const body  = Math.abs(last.c - last.o);
  const lower = Math.min(last.o, last.c) - last.l;
  const upper = last.h - Math.max(last.o, last.c);
  if (body > 0 && lower >= body * 2 && upper < body * 0.5)
    found.push(last.c >= last.o ? 'Hammer' : 'Hanging man');
  if (body > 0 && upper >= body * 2 && lower < body * 0.5)
    found.push(last.c <= last.o ? 'Shooting star' : 'Inverted hammer');

  // ── 5. Tight consolidation → flag detection ──
  const last6  = candles.slice(-6);
  const rangeHi = Math.max(...last6.map(c => c.h));
  const rangeLo = Math.min(...last6.map(c => c.l));
  const tightRange = last6[last6.length - 1].c > 0 &&
    (rangeHi - rangeLo) / last6[last6.length - 1].c < 0.015;

  if (tightRange && candles.length >= 11) {
    // Check for flag pole (sharp move in prior 5 candles)
    const pole = candles.slice(-11, -6);
    const poleMove = pole.length > 0
      ? (pole[pole.length - 1].c - pole[0].o) / Math.abs(pole[0].o) * 100
      : 0;
    if (Math.abs(poleMove) > 3) {
      found.push(poleMove > 0
        ? 'Bull flag (sharp rally + tight consolidation)'
        : 'Bear flag (sharp drop + tight consolidation)');
    } else {
      found.push('Tight consolidation');
    }
  }

  // ── 6. Double top / Double bottom (last 20 candles) ──
  if (candles.length >= 20) {
    const r20 = candles.slice(-20);
    // Find two highest highs - if within 0.5% of each other with a valley between = double top
    let h1i = 0, h2i = 0;
    r20.forEach((c, i) => {
      if (c.h > r20[h1i].h) { h2i = h1i; h1i = i; }
      else if (c.h > r20[h2i].h && i !== h1i) h2i = i;
    });
    if (h1i !== h2i && Math.abs(h1i - h2i) >= 3) {
      const pctDiff = Math.abs(r20[h1i].h - r20[h2i].h) / r20[h1i].h;
      if (pctDiff < 0.005) found.push('Double top');
    }
    // Two lowest lows
    let l1i = 0, l2i = 0;
    r20.forEach((c, i) => {
      if (c.l < r20[l1i].l) { l2i = l1i; l1i = i; }
      else if (c.l < r20[l2i].l && i !== l1i) l2i = i;
    });
    if (l1i !== l2i && Math.abs(l1i - l2i) >= 3) {
      const pctDiff = Math.abs(r20[l1i].l - r20[l2i].l) / r20[l1i].l;
      if (pctDiff < 0.005) found.push('Double bottom');
    }
  }

  /* Ranked here rather than at the call site, so a consumer reading `pats[0]` cannot get the
     statement-order answer by forgetting to sort. See RANK. */
  return rankPatterns(found);
}

/* The order `detectPatterns` returns, most consequential first.
 *
 * WHY THIS EXISTS (QA, #1263 defect 2). `found` was built in source-statement order - trend,
 * engulfing, doji, hammer, consolidation, then double top/bottom LAST - and
 * `app/api/telegram/alert/route.ts` sends `pats[0]`. So a chart with both a trend and a double top
 * reported "uptrend", and double top, arguably the most consequential name in the set, was the
 * LEAST likely to ever be shown. The old comment read "show first pattern", so it was never a
 * priority decision at all; it was an accident of where the `if` blocks happened to sit.
 *
 * THE RANKING IS A JUDGEMENT AND IS WRITTEN DOWN AS ONE. More bars of evidence first, because a
 * 20-bar formation survives one noisy candle and a 1-bar one does not: double top and bottom (20),
 * then the flags (11), then the 10-bar trend read, then two-candle engulfing, then the
 * single-candle shapes, then tight consolidation - which is last because it describes an absence
 * of movement and is the least informative thing to lead with.
 *
 * A name missing from this list sorts to the end rather than being dropped, so adding a pattern
 * cannot silently remove it from the output. */
const RANK: readonly string[] = [
  'Double top',
  'Double bottom',
  'Bull flag (sharp rally + tight consolidation)',
  'Bear flag (sharp drop + tight consolidation)',
  'Higher highs + higher lows (uptrend)',
  'Lower highs + lower lows (downtrend)',
  'Bearish engulfing',
  'Bullish engulfing',
  'Shooting star',
  'Hammer',
  'Hanging man',
  'Inverted hammer',
  'Doji',
  'Tight consolidation',
];

/** `detectPatterns` ordered by RANK. Exported so a caller taking only the first item gets the most
 *  consequential one rather than whichever `if` block came first in the source. */
export function rankPatterns(names: readonly string[]): string[] {
  const at = (n: string) => { const i = RANK.indexOf(n); return i === -1 ? RANK.length : i; };
  return [...names].sort((a, b) => at(a) - at(b));
}

/** Convenience: returns comma-separated string or empty string */
export function detectPatternsStr(candles: Candle[]): string {
  return detectPatterns(candles).join('; ');
}

