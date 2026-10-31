/* WHICH GROUP A CANDLE WINDOW BELONGS IN, DECIDED AGAINST A NULL MODEL RATHER THAN A THRESHOLD.
 *
 * The spec (#1818) needs three groups: A unambiguous structure, B structureless, C ordinary. If I
 * pick those by eye the whole test rests on my taste, and group A's job - proving the harness and
 * the prompt are sound - collapses. So the classifier uses the same geometry that will score the
 * engines: `findSwingPivots`, `fitLine`, `measureFit`.
 *
 * ── TWO EARLIER VERSIONS OF THIS FILE WERE WRONG, AND BOTH FAILURES ARE WHY THE SURROGATE BELOW
 *    EXISTS. Recorded because each returned a confident, plausible, useless number. ──
 *
 * **V1 scored `r2 x touchCount` and found ZERO structureless windows.** `fitLine` on exactly three
 * points, chosen as the best of ~1000 combinations, returns r2 ~ 1.0 by construction - this file's
 * own source warns that a 2-point line is exact and says nothing, and best-of-N over 3-point fits
 * is the same defect with more arithmetic. Measured: the winning line on a BTC 4h window had
 * r2 = 0.99998. **r2 carried no information at all**, so every window looked like group A.
 *
 * **V2 dropped r2 and classified on touch count alone. That found zero structureless windows too.**
 * Measured across 78 windows and 26 coin/timeframe pairs: the best line's touch count ran 36 to
 * 109 out of 200, median 52. **Every window in the sample contains a line a quarter of its candles
 * touch.** That is not a property of those markets - it is the multiple-comparisons problem.
 * Searching ~1000 three-point combinations on both sides of any series will find something.
 *
 * ── SO THE QUESTION IS NOT "HOW GOOD IS THE BEST LINE" BUT "IS IT BETTER THAN THE BEST LINE THE
 *    SAME SEARCH FINDS IN NOISE WITH THIS WINDOW'S OWN VOLATILITY" ──
 *
 * For each window the identical search runs against SURROGATES: the bar-to-bar returns shuffled
 * and a price path rebuilt from them, each bar keeping its own high/low range. That preserves the
 * volatility and the candle shapes and destroys the ordering that makes structure, which is the
 * null this test needs. A window whose best line is no better than its own noise is group B,
 * however good it looks.
 *
 * **THE LIMIT THIS STILL HAS, stated rather than hidden.** The engines are scored by the same
 * geometry that chose the fixtures, so a real structure our code is blind to is filed under B and
 * an engine that finds it is marked as fabricating. The spec accepts that by making Phase 0 the
 * scorer. It bounds the claim: this measures agreement with OUR definition of structure, not with
 * the market's.
 */
import { findSwingPivots, fitLine, measureFit } from '../../lib/chartStructures.ts';

/** Average true range. Used as the touch tolerance so the band scales with the window's own
 *  volatility instead of being a fixed percentage - wide on BTC, narrow on a sub-cent coin. */
export function atrOf(candles) {
  const tr = candles.slice(1).map((b, i) => Math.max(
    b.high - b.low,
    Math.abs(b.high - candles[i].close),
    Math.abs(b.low - candles[i].close),
  ));
  return tr.reduce((a, b) => a + b, 0) / tr.length;
}

/**
 * The best 3-pivot line in a window, by how many candles touch it.
 *
 * Exhaustive over combinations on purpose: with 15-25 pivots a side this is a few hundred, and
 * sampling would make the answer depend on the sample. The separation floor is what stops three
 * pivots a bar apart at one price, which `chartStructures` warns fit perfectly and mean nothing.
 */
export function bestLine(candles, tolerance) {
  const { highs, lows } = findSwingPivots(candles, 3, 3);
  const minSpan = Math.floor(candles.length / 2);
  let best = null;
  for (const [pivots, side] of [[highs, 'high'], [lows, 'low']]) {
    for (let i = 0; i < pivots.length - 2; i++) {
      for (let j = i + 1; j < pivots.length - 1; j++) {
        for (let k = j + 1; k < pivots.length; k++) {
          const pts = [pivots[i], pivots[j], pivots[k]].map(p => ({ index: p.index, price: p.price }));
          if (pts[2].index - pts[0].index < minSpan) continue;
          const fit = fitLine(pts);
          if (!fit) continue;
          const q = measureFit(candles, fit, { side, tolerance: { abs: tolerance } });
          if (!best || q.touchCount > best.touchCount) {
            best = { touchCount: q.touchCount, side, fit, points: pts, quality: q };
          }
        }
      }
    }
  }
  return best;
}

/** Seeded mulberry32, so the classification is reproducible. A fixture set that reclassifies
 *  between runs cannot be committed as the basis of a comparison. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One surrogate: the same bars with their returns shuffled.
 *
 * Each bar keeps its own wick lengths and body size, so the surrogate has this window's candle
 * shapes and this window's volatility. Only the ORDER of the moves changes, which is exactly what
 * makes a trendline. Drawing returns from a normal distribution instead would also destroy the fat
 * tails, and the null would then be easier to beat than reality.
 */
function surrogate(candles, rand) {
  const rets = candles.slice(1).map((b, i) => Math.log(b.close / candles[i].close));
  const shapes = candles.map(b => ({
    up: b.high - Math.max(b.open, b.close),
    dn: Math.min(b.open, b.close) - b.low,
    body: b.close - b.open,
  }));
  for (let i = rets.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rets[i], rets[j]] = [rets[j], rets[i]];
  }
  const out = [];
  let close = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) close = close * Math.exp(rets[i - 1]);
    const s = shapes[i];
    const open = close - s.body;
    out.push({
      timestamp: candles[i].timestamp,
      open,
      close,
      high: Math.max(open, close) + Math.max(0, s.up),
      low: Math.min(open, close) - Math.max(0, s.dn),
    });
  }
  return out;
}

const SURROGATES = 24;

/**
 * The verdict for one window, as a z-score against its own noise.
 *
 * `z` is how many surrogate standard deviations the real window's best touch count sits above the
 * surrogate mean. **That is the number a fixed threshold could not give.**
 */
export function classifyWindow(candles, seed = 1) {
  const tol = atrOf(candles);
  const real = bestLine(candles, tol);
  const rand = rng(seed);
  const nullTouches = [];
  for (let s = 0; s < SURROGATES; s++) {
    const b = bestLine(surrogate(candles, rand), tol);
    nullTouches.push(b ? b.touchCount : 0);
  }
  const mean = nullTouches.reduce((a, b) => a + b, 0) / nullTouches.length;
  const sd = Math.sqrt(nullTouches.reduce((a, b) => a + (b - mean) ** 2, 0) / nullTouches.length);
  const touches = real ? real.touchCount : 0;
  /* sd of 0 means every surrogate returned the same count. A z of Infinity would then decide a
     group on a degenerate null, so it is null and the window falls through to C. */
  const z = sd > 0 ? (touches - mean) / sd : null;

  const summary = {
    touches,
    side: real ? real.side : null,
    r2: real && real.fit.r2 !== null ? Number(real.fit.r2.toFixed(4)) : null,
    nullMean: Number(mean.toFixed(1)),
    nullSd: Number(sd.toFixed(2)),
    nullMax: Math.max(...nullTouches),
    z: z === null ? null : Number(z.toFixed(2)),
    atr: Number(tol.toPrecision(6)),
  };

  /* A is "a line our geometry cannot argue with": far outside what this window's own noise
     produces. B is "no better than noise". The gap is wide on purpose, so nothing lands in either
     by a rounding margin and everything between is honestly C. */
  if (z !== null && z >= 3) return { group: 'A', ...summary };
  if (z !== null && z <= 0.5) return { group: 'B', ...summary };
  return { group: 'C', ...summary };
}
