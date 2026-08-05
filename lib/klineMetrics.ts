import { computeRSI14 } from './rsi';
import { detectPatterns } from './patterns';

/* Everything MarketProvider used to derive from a coin's 15-minute candles,
 * lifted out verbatim so app/api/market/snapshot can compute it once on the
 * server instead of every visitor computing it in their own browser.
 *
 * Pure: klines in, numbers out. No fetching, no React, no store. That is the
 * whole reason it can live in both places without drifting - the previous
 * version of this problem (computeRSI14) was two copies of the same maths, and
 * a one-line difference there would have moved coins across the 30/70 badge
 * thresholds silently.
 *
 * Binance kline array indices, since they are otherwise unreadable:
 *   [1] open  [2] high  [3] low  [4] close
 *   [5] base volume     [7] quote volume     [9] taker buy base volume
 */

export interface KlineMetrics {
  volRatio: number;
  ma20: number;
  rsi14: number | null;
  poc: number;
  vah: number;
  val: number;
  vwap: number | null;
  takerBuyRatio: number | null;
  chartPattern: string | null;
}

/** Volume-profile resolution. 60 buckets over the high-low range. */
const BUCKETS = 60;
/** Value area = the price band holding this share of traded volume. */
const VALUE_AREA_SHARE = 0.70;
/** Taker buy/sell window: 8 candles at 15m is about two hours. */
const TAKER_WINDOW = 8;
/** Pattern detection reads the most recent candles only. */
const PATTERN_WINDOW = 25;

/** Needs at least 15 closes for RSI14; fewer and the whole set is unreliable. */
export const MIN_KLINES = 15;

export function computeKlineMetrics(klines: string[][]): KlineMetrics | null {
  if (!Array.isArray(klines) || klines.length < MIN_KLINES) return null;

  const closes = klines.map(k => parseFloat(k[4]));
  const highs  = klines.map(k => parseFloat(k[2]));
  const lows   = klines.map(k => parseFloat(k[3]));
  const vols   = klines.map(k => parseFloat(k[7]));   // quote volume

  /* Volume ratio: the last CLOSED candle against the average of everything
     before it. Index -2, not -1, because the final candle is still forming and
     would always look low. */
  const current = vols[vols.length - 2];
  const avg = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1);

  const ma20Slice = closes.slice(-20);
  const ma20 = ma20Slice.reduce((a, b) => a + b, 0) / ma20Slice.length;

  const rsi14 = computeRSI14(closes);

  /* ── Volume profile: POC and value area ── */
  const allPrices = [...highs, ...lows];
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const bSize = (maxP - minP) / BUCKETS;
  const buckets = new Array<number>(BUCKETS).fill(0);

  klines.forEach((_k, i) => {
    const h = highs[i], l = lows[i], v = vols[i];
    const lo = Math.max(0, Math.floor((l - minP) / bSize));
    const hi = Math.min(BUCKETS - 1, Math.floor((h - minP) / bSize));
    const span = Math.max(1, hi - lo + 1);
    for (let b = lo; b <= hi; b++) buckets[b] += v / span;
  });

  let maxVol = 0, pocBucket = 0;
  buckets.forEach((v, i) => { if (v > maxVol) { maxVol = v; pocBucket = i; } });
  const poc = minP + (pocBucket + 0.5) * bSize;

  /* Expand outward from the POC, always taking the heavier neighbour, until
     VALUE_AREA_SHARE of volume is inside. */
  const totalVol = buckets.reduce((a, b) => a + b, 0);
  let lo = pocBucket, hi = pocBucket, captured = buckets[pocBucket];
  while (captured < totalVol * VALUE_AREA_SHARE && (lo > 0 || hi < BUCKETS - 1)) {
    const addLo = lo > 0 ? buckets[lo - 1] : 0;
    const addHi = hi < BUCKETS - 1 ? buckets[hi + 1] : 0;
    if (addLo >= addHi && lo > 0) { lo--; captured += buckets[lo]; }
    else if (hi < BUCKETS - 1)    { hi++; captured += buckets[hi]; }
    else                           { lo--; captured += buckets[lo]; }
  }
  const val = minP + lo * bSize;
  const vah = minP + (hi + 1) * bSize;

  /* Taker buy/sell aggression over the recent window.
     >0.55 = buyers lifting offers, <0.45 = sellers hitting bids. */
  let totalBuyVol = 0, totalBaseVol = 0;
  klines.slice(-TAKER_WINDOW).forEach(k => {
    totalBuyVol  += parseFloat(k[9]);
    totalBaseVol += parseFloat(k[5]);
  });
  const takerBuyRatio = totalBaseVol > 0 ? totalBuyVol / totalBaseVol : null;

  /* VWAP on BASE volume, not quote. Quote volume biases the average toward
     high-price candles and does not give a true VWAP. */
  let sumTPV = 0, sumVol = 0;
  klines.forEach((k, i) => {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const baseVol = parseFloat(k[5]);
    sumTPV += tp * baseVol;
    sumVol += baseVol;
  });
  const vwap = sumVol > 0 ? sumTPV / sumVol : null;

  const patternCandles = klines.slice(-PATTERN_WINDOW).map(k => ({
    o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]),
  }));
  const patterns = detectPatterns(patternCandles);

  return {
    volRatio: avg > 0 ? current / avg : 1,
    ma20, rsi14, poc, vah, val, vwap, takerBuyRatio,
    chartPattern: patterns.length > 0 ? patterns.join('; ') : null,
  };
}
