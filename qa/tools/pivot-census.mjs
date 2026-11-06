/* WHY #1818's DETECTION FINDS NOTHING ON 1h, 1d AND 1w — the measurement, not the guess.
 *
 * Dev and I both guessed pivot starvation: slower rungs have fewer pivots in 499 bars, so the 3/4/5
 * candidate windows span a far longer period and a straight line describes it worse. **That guess is
 * wrong and this tool is what refuted it.**
 *
 * Measured, 8 coins x 5 timeframes, 499 closed bars, pivotStrength 3/3:
 *
 *     TF    bars  highs min/med/max  lows min/med/max   pivot-starved cells
 *     15m   499   49/56/62           46/49/61           0 of 8
 *     1h    499   45/50/55           48/50/57           0 of 8
 *     4h    499   45/50/52           42/53/58           0 of 8
 *     1d    499   44/48/52           50/54/58           0 of 8
 *     1w    407   29/41/48           32/46/54           0 of 8
 *
 * **Every timeframe has about 50 pivots per side against a minimum of 3. Nothing is starved**, and
 * the counts are essentially FLAT across the ladder — which is the opposite of what the hypothesis
 * required. A longer window cannot be the fix for a shortage that does not exist.
 *
 * WHAT ACTUALLY REFUSES: R², in 22 of 24 cells. The candidate search is the most recent 3, 4 and 5
 * pivots by recency, so with ~50 available it only ever looks at the last few — and on a daily or
 * weekly chart those are simply not collinear. Measured R² on the best candidate per side:
 *
 *     1d   0.844  0.900  0.961  0.937  0.982  0.983  0.998  0.976
 *     1w   0.167  0.377  0.998  0.836  0.558  0.472  0.945  0.833
 *
 * **That is arguably CORRECT behaviour rather than a defect** — a line through five non-collinear
 * swings is not a trendline and refusing is the non-negotiable rule. But it means the feature
 * produces nothing on the daily chart, which is the timeframe traders look at most, and that is a
 * product fact worth stating rather than a bug to fix by loosening a gate.
 *
 * ── AND A SECOND DEFECT THIS TURNED UP, WHICH IS NOT ABOUT TIMEFRAMES ─────────────────────────────
 *
 * `touchCount - pointCount` GOES NEGATIVE ON THE SLOPED PATH with live data: measured -1 to -5
 * across 4h, 1d and 1w. BTCUSDT 1w, the worst:
 *
 *     fitted pivots n=5, r2 = 0.166984
 *     pointCount = 5   touchCount = 2   => excess = -3
 *
 *     idx 439  pivot 97924.49  rail 88115.65  |diff|  9808.84  band 264.35  OFF
 *     idx 448  pivot 76000.00  rail 85103.52  |diff|  9103.52  band 255.31  OFF
 *     idx 455  pivot 82850.00  rail 82760.75  |diff|    89.25  band 248.28  ON
 *     idx 466  pivot 66956.15  rail 79079.26  |diff| 12123.11  band 237.24  OFF
 *     idx 475  pivot 87395.67  rail 76067.12  |diff| 11328.55  band 228.20  OFF
 *
 * **`pointCount` means two different things on the two paths.** On a DERIVED rail Dev changed it to
 * count the pivots actually ON the rail — which is what made his -39 legible. On the SLOPED path it
 * is still the number of pivots FITTED, so a poor fit reports 5 points while only 1 of them is
 * within tolerance of the resulting line.
 *
 * Consequences, in order of how much they matter:
 *
 *   1. The two rails of one channel report metrics that are not comparable, because the same field
 *      name counts different things on each.
 *   2. `excess` is emitted on the output and is meaningless when negative.
 *   3. It fails SAFE — the gate needs >= 5, so a negative value is refused — which is exactly why
 *      nobody noticed. A metric can be absurd and harmless at the same time, and then stop being
 *      harmless when something starts reading it.
 *
 * This is QA's finding, not a QA fix: the field belongs to the detector.
 *
 * USAGE:  node qa/tools/pivot-census.mjs
 *         node qa/tools/pivot-census.mjs BTCUSDT,ETHUSDT 1d,1w
 */
import { findSwingPivots, fitLine, measureFit, lineValueAt } from '../../lib/chartStructures.ts';
import {
  CANDIDATE_PIVOT_COUNTS, MIN_TRENDLINE_PIVOTS, MIN_TRENDLINE_R2,
  MIN_EXTRA_TOUCHES, DEFAULT_TOLERANCE,
} from '../../lib/chartStructureDetect.ts';

const SYMBOLS = (process.argv[2] ?? 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,ADAUSDT,DOGEUSDT,LINKUSDT')
  .split(',').map(s => s.trim()).filter(Boolean);
const TFS = (process.argv[3] ?? '15m,1h,4h,1d,1w').split(',').map(s => s.trim()).filter(Boolean);

async function klines(symbol, interval) {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`);
  if (!res.ok) throw new Error(`${symbol} ${interval}: HTTP ${res.status}`);
  const raw = await res.json();
  return raw.slice(0, -1).map(k => ({
    timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
  }));
}

const pad = (v, n) => String(v ?? '-').padEnd(n);
const quart = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return `${b[0]}/${b[Math.floor(b.length / 2)]}/${b[b.length - 1]}`;
};

console.log(`gates: r2 >= ${MIN_TRENDLINE_R2}, excess >= ${MIN_EXTRA_TOUCHES}, min pivots ${MIN_TRENDLINE_PIVOTS}`);
console.log(`candidate windows: ${CANDIDATE_PIVOT_COUNTS.join('/')} most recent pivots\n`);

console.log('── 1. IS ANYTHING PIVOT-STARVED? ───────────────────────────────────────');
console.log(pad('TF', 6) + pad('BARS', 6) + pad('highs min/med/max', 20) + pad('lows min/med/max', 20) + 'starved');
const negatives = [];
for (const tf of TFS) {
  const H = [], L = []; let bars = 0, starved = 0;
  for (const s of SYMBOLS) {
    try {
      const c = await klines(s, tf);
      bars = c.length;
      const p = findSwingPivots(c, 3, 3);
      H.push(p.highs.length); L.push(p.lows.length);
      if (p.highs.length < MIN_TRENDLINE_PIVOTS && p.lows.length < MIN_TRENDLINE_PIVOTS) starved++;

      /* While the candles are here: which gate refuses, and does excess go negative? */
      for (const side of ['high', 'low']) {
        const piv = side === 'high' ? p.highs : p.lows;
        for (const n of CANDIDATE_PIVOT_COUNTS) {
          if (piv.length < n) continue;
          const f = fitLine(piv.slice(piv.length - n).map(x => ({ index: x.index, price: x.price })));
          if (!f) continue;
          const q = measureFit(c, f, { side, tolerance: DEFAULT_TOLERANCE });
          const excess = q.touchCount - f.pointCount;
          if (excess < 0) negatives.push({ tf, s, side, n, r2: f.r2, points: f.pointCount, touches: q.touchCount, excess });
        }
      }
    } catch (e) { /* a fetch failure is not a measurement */ }
    await new Promise(r => setTimeout(r, 110));
  }
  console.log(pad(tf, 6) + pad(bars, 6) + pad(quart(H), 20) + pad(quart(L), 20) + `${starved} of ${SYMBOLS.length}`);
}

console.log('\n── 2. NEGATIVE EXCESS ON THE SLOPED PATH ───────────────────────────────');
if (!negatives.length) {
  console.log('  none — if this is empty the second defect is fixed, or the market changed shape.');
} else {
  console.log(`  ${negatives.length} candidate fits report touchCount < pointCount.`);
  console.log('  ' + pad('TF', 5) + pad('SYMBOL', 10) + pad('side', 6) + pad('n', 3) + pad('r2', 11) + pad('points', 8) + pad('touches', 9) + 'excess');
  for (const x of negatives.slice(0, 12)) {
    console.log('  ' + pad(x.tf, 5) + pad(x.s, 10) + pad(x.side, 6) + pad(x.n, 3) +
      pad(x.r2 === null ? 'null' : x.r2.toFixed(6), 11) + pad(x.points, 8) + pad(x.touches, 9) + x.excess);
  }
  console.log('\n  A fit reporting more points than touches means `pointCount` is the pivots FITTED');
  console.log('  rather than the pivots ON the rail — see this file\'s header.');
}
