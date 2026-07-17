// Pure, framework-agnostic Order Flow Setup scoring - replicates the 5 backtestable
// signals from components/StopLossZone.tsx's scoreBias/computeStop/computeTP (RSI on
// 15m/1h/4h, POC, VWAP, funding rate). OI trend, CVD divergence, and taker buy ratio
// are deliberately excluded - they require trade-level/positioning data that exchanges
// don't retain far enough back to backtest meaningfully (see app/backtest page notes).

import { OHLCV } from './strategyCore';
import { computeFibLevels } from './marketStore';

/* ── Windowed RSI(14) - matches MarketProvider.tsx's computeRSI14 exactly:
   a fresh average over the last 14 changes each time, not Wilder's continuous
   smoothing. This is deliberate - it's what the live Order Flow card actually uses. */
export function simpleRSI14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains  = changes.slice(-14).map(c => Math.max(c, 0));
  const losses = changes.slice(-14).map(c => Math.max(-c, 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  return avgLoss === 0 ? 100 : Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

/* Finds the index of the most recent item that has fully CLOSED by timeMs -
   item.time is an OPEN/event time, so it's closed once timeMs >= time + intervalMs
   (pass intervalMs=0 for point-in-time events like funding rate changes, where the
   value simply takes effect at its own timestamp). Binary search avoids leaking a
   same-bar or future value into a historical check. */
export function lastClosedIndexBefore(items: { time: number }[], timeMs: number, intervalMs: number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].time + intervalMs <= timeMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

/* ── Rolling volume profile (POC/VAH/VAL) + VWAP - matches MarketProvider.tsx's
   fetchKlines exactly: 60 buckets across the window's high/low range, volume spread
   across each candle's high-low span, POC = max-volume bucket, value area = expand
   from POC until 70% of volume captured, VWAP = typical-price weighted by base volume. */
export interface VolumeProfile { poc: number; vah: number; val: number; vwap: number }

export function computeVolumeProfile(window: OHLCV[]): VolumeProfile | null {
  if (window.length < 10) return null;
  const highs = window.map(c => c.high);
  const lows  = window.map(c => c.low);
  const allPrices = [...highs, ...lows];
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP;
  if (range <= 0) return null;
  const BUCKETS = 60;
  const bSize = range / BUCKETS;
  const buckets = new Array<number>(BUCKETS).fill(0);

  window.forEach(c => {
    const lo = Math.max(0, Math.floor((c.low - minP) / bSize));
    const hi = Math.min(BUCKETS - 1, Math.floor((c.high - minP) / bSize));
    const span = Math.max(1, hi - lo + 1);
    for (let b = lo; b <= hi; b++) buckets[b] += c.volume / span;
  });

  let maxVol = 0, pocBucket = 0;
  buckets.forEach((v, i) => { if (v > maxVol) { maxVol = v; pocBucket = i; } });
  const poc = minP + (pocBucket + 0.5) * bSize;

  const totalVol = buckets.reduce((a, b) => a + b, 0);
  let lo = pocBucket, hi = pocBucket, captured = buckets[pocBucket];
  while (captured < totalVol * 0.70 && (lo > 0 || hi < BUCKETS - 1)) {
    const addLo = lo > 0 ? buckets[lo - 1] : 0;
    const addHi = hi < BUCKETS - 1 ? buckets[hi + 1] : 0;
    if (addLo >= addHi && lo > 0) { lo--; captured += buckets[lo]; }
    else if (hi < BUCKETS - 1)    { hi++; captured += buckets[hi]; }
    else                           { lo--; captured += buckets[lo]; }
  }
  const val = minP + lo * bSize;
  const vah = minP + (hi + 1) * bSize;

  let sumTPV = 0, sumVol = 0;
  window.forEach(c => {
    const tp = (c.high + c.low + c.close) / 3;
    sumTPV += tp * c.volume;
    sumVol += c.volume;
  });
  const vwap = sumVol > 0 ? sumTPV / sumVol : poc;

  return { poc, vah, val, vwap };
}

/* ── Bias scoring - RSI15m + RSI1h + RSI4h + POC + VWAP + funding (5 of the live
   card's 8 signals; OI/CVD/taker excluded, see file header). Same thresholds as
   components/StopLossZone.tsx's scoreBias. ── */
export type OFBias = 'long' | 'short' | 'neutral';

export function scoreOrderFlowBias(
  rsi15m: number | null, rsi1h: number | null, rsi4h: number | null,
  price: number, poc: number | null, vwap: number | null,
  fundingRatePct: number | null, // already ×100, e.g. 0.04 = 0.04%
): { bias: OFBias; bull: number; bear: number; total: number } {
  let bull = 0, bear = 0;
  if (rsi15m != null) { if (rsi15m > 55) bull++; else if (rsi15m < 45) bear++; }
  if (rsi1h  != null) { if (rsi1h  > 55) bull++; else if (rsi1h  < 45) bear++; }
  if (rsi4h  != null) { if (rsi4h  > 55) bull++; else if (rsi4h  < 45) bear++; }
  if (poc  != null) { if (price > poc)  bull++; else bear++; }
  if (vwap != null) { if (price > vwap) bull++; else bear++; }
  if (fundingRatePct != null) {
    if (fundingRatePct >= 0.04) bear++;
    else if (fundingRatePct <= -0.02) bull++;
  }
  const total = bull + bear;
  if (bull > bear) return { bias: 'long', bull, bear, total };
  if (bear > bull) return { bias: 'short', bull, bear, total };
  return { bias: 'neutral', bull, bear, total };
}

/* ── Entry/SL/TP zone candidates - mirrors StopLossZone.tsx's candidatesBelow/Above
   and computeStop/computeTP, using only backtestable inputs (no order book walls). ── */
interface Level { price: number; label: string }

function nearest(arr: Level[], side: 'below' | 'above'): Level | null {
  if (!arr.length) return null;
  return arr.reduce((acc, c) => side === 'below' ? (c.price > acc.price ? c : acc) : (c.price < acc.price ? c : acc));
}

function candidatesBelow(price: number, vp: VolumeProfile, hi24: number, lo24: number): Level[] {
  const out: Level[] = [];
  if (vp.val  < price * 0.9975) out.push({ price: vp.val,  label: 'VAL'  });
  if (vp.poc  < price * 0.9975) out.push({ price: vp.poc,  label: 'POC'  });
  if (vp.vwap < price * 0.9975) out.push({ price: vp.vwap, label: 'VWAP' });
  if (hi24 > lo24) for (const f of computeFibLevels(hi24, lo24, price))
    if (f.price < price * 0.9975 && f.price > price * 0.84) out.push({ price: f.price, label: 'Fib ' + f.label });
  if (lo24 < price * 0.9975) out.push({ price: lo24, label: '24H Low' });
  return out;
}

function candidatesAbove(price: number, vp: VolumeProfile, hi24: number, lo24: number): Level[] {
  const out: Level[] = [];
  if (vp.vah  > price * 1.0025) out.push({ price: vp.vah,  label: 'VAH'  });
  if (vp.poc  > price * 1.0025) out.push({ price: vp.poc,  label: 'POC'  });
  if (vp.vwap > price * 1.0025) out.push({ price: vp.vwap, label: 'VWAP' });
  if (hi24 > lo24) for (const f of computeFibLevels(hi24, lo24, price))
    if (f.price > price * 1.0025 && f.price < price * 1.16) out.push({ price: f.price, label: 'Fib ' + f.label });
  if (hi24 > price * 1.0025) out.push({ price: hi24, label: '24H High' });
  return out;
}

export interface OrderFlowZones { sl: number; tp: number }

export function computeOrderFlowZones(
  bias: 'long' | 'short', price: number, vp: VolumeProfile, hi24: number, lo24: number,
): OrderFlowZones | null {
  if (bias === 'long') {
    const stopCand = nearest(candidatesBelow(price, vp, hi24, lo24), 'below');
    if (!stopCand) return null;
    const sl = stopCand.price * 0.9985;
    const all = candidatesAbove(price, vp, hi24, lo24);
    if (!all.length) return null;
    const minTP = price + (price - sl) * 1.5;
    const pool = all.filter(c => c.price >= minTP);
    const tpCand = nearest(pool.length ? pool : all, 'above');
    if (!tpCand) return null;
    return { sl, tp: tpCand.price };
  } else {
    const stopCand = nearest(candidatesAbove(price, vp, hi24, lo24), 'above');
    if (!stopCand) return null;
    const sl = stopCand.price * 1.0015;
    const all = candidatesBelow(price, vp, hi24, lo24);
    if (!all.length) return null;
    const minTP = price - (sl - price) * 1.5;
    const pool = all.filter(c => c.price <= minTP);
    const tpCand = nearest(pool.length ? pool : all, 'below');
    if (!tpCand) return null;
    return { sl, tp: tpCand.price };
  }
}
