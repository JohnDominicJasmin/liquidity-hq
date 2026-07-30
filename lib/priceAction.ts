// Market-structure signals derived from price alone - no moving averages.
//
// Deliberately SEPARATE from the EMA Ribbon markers in lib/useEMAStrategy.ts.
// That rule (arm on EMA9/20 cross, confirm on a close across EMA50, strict
// alternation, PERSIST=4 whipsaw filter) is traded manually and its markers
// must keep matching exactly, so nothing here feeds back into it. These are an
// independent second opinion, rendered and alerted separately, so it is always
// clear which system fired.
//
// Swing detection uses the same lookback=3 pivot convention as
// computeSRLevels() in KLineProChart and SWING_LOOKBACK in lib/divergence.ts.
// A third convention would mean the chart's S/R lines and these signals
// disagreed about where the swings are, which is worse than either choice.

export interface PACandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * BOS  - Break Of Structure: price continues the existing trend by taking out
 *        the prior swing in the SAME direction it was already going.
 * CHOCH- Change of Character: price takes out a swing AGAINST the prevailing
 *        trend. The first genuine hint the trend may be turning.
 */
export type PAKind = 'BOS' | 'CHOCH';

export interface PASignal {
  timestamp: number;
  /** Close of the candle that broke the level. */
  price: number;
  /** The swing level that was taken out. */
  level: number;
  dir: 'bull' | 'bear';
  kind: PAKind;
  /** Volume of the breaking candle vs the trailing average, when volume exists. */
  volumeRatio: number | null;
  /** True when the break came on above-average volume - a stronger break. */
  volumeBacked: boolean;
}

const LOOKBACK = 3;
const VOL_WINDOW = 20;
// A break needs volume above the recent average to count as participation. 1.2
// rather than 1.0 because half of all candles clear a plain average by
// definition, which would make the flag meaningless.
const VOL_CONFIRM = 1.2;

interface Pivot { index: number; price: number }

/**
 * Confirmed swing pivots. A pivot is only knowable LOOKBACK bars after it
 * forms - the bars to its right are what confirm it - so the most recent
 * LOOKBACK bars can never contain one. That lag is inherent to swing
 * detection, not a limitation worth engineering around: acting on an
 * unconfirmed pivot means acting on a high that may not be the high.
 */
export function findPivots(candles: PACandle[]): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = LOOKBACK; i < candles.length - LOOKBACK; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - LOOKBACK; j <= i + LOOKBACK; j++) {
      if (j === i) continue;
      if (candles[j].high > hi) isHigh = false;
      if (candles[j].low < lo) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: hi });
    if (isLow) lows.push({ index: i, price: lo });
  }
  return { highs, lows };
}

function avgVolume(candles: PACandle[], upToIndex: number): number | null {
  const start = Math.max(0, upToIndex - VOL_WINDOW);
  const slice = candles.slice(start, upToIndex);
  const vols = slice.map(c => c.volume).filter((v): v is number => v != null && isFinite(v) && v > 0);
  if (vols.length < 5) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

/**
 * Walks the candles once, tracking the most recent confirmed swing high and
 * low, and emits a signal whenever a candle CLOSES beyond one of them.
 *
 * Close, not wick: a wick through a level is exactly the graze the EMA rule's
 * persistence filter exists to reject, and the same reasoning applies here.
 *
 * After a break the broken level is retired, so one swing cannot fire twice as
 * price oscillates around it - the next signal needs a genuinely new pivot.
 */
export function detectStructureSignals(candles: PACandle[]): PASignal[] {
  if (!candles || candles.length < LOOKBACK * 2 + 5) return [];

  const { highs, lows } = findPivots(candles);
  const signals: PASignal[] = [];

  /**
   * Trend read from the SWING SEQUENCE, not from the last signal.
   *
   * Higher highs AND higher lows is an uptrend; lower highs AND lower lows a
   * downtrend; anything else is a range with no trend to continue or reverse.
   *
   * This started out as "whichever way the last break went", which quietly
   * made CHoCH meaningless: since consecutive breaks alternate direction about
   * half the time, half of all signals came back labelled CHoCH (38 of 74 on
   * 1000 bars of BTC 1h). A change of character is supposed to be the rare,
   * notable event where price breaks AGAINST an established structure - if it
   * fires every other signal it tells you nothing.
   */
  const trendAt = (i: number): 'up' | 'down' | null => {
    const hs = highs.filter(p => p.index + LOOKBACK < i);
    const ls = lows.filter(p => p.index + LOOKBACK < i);
    if (hs.length < 2 || ls.length < 2) return null;
    const [h1, h0] = [hs[hs.length - 1], hs[hs.length - 2]];
    const [l1, l0] = [ls[ls.length - 1], ls[ls.length - 2]];
    if (h1.price > h0.price && l1.price > l0.price) return 'up';
    if (h1.price < h0.price && l1.price < l0.price) return 'down';
    return null;
  };
  // Index of the last pivot consumed on each side. A pivot fires at most once,
  // but ANY later pivot is eligible regardless of its price.
  //
  // This was originally a price ratchet (usedHigh/usedLow), which was wrong in
  // a way only long history exposed: once a high at 65,913 had been broken, no
  // bull signal could ever fire again unless price exceeded that number, so in
  // a range-bound market the signals simply stopped. Over a 300-bar window the
  // ratchet reset often enough to look fine; over the ~1000 bars the chart
  // actually loads, the newest signal was nine days stale.
  let usedHighIdx = -1;
  let usedLowIdx = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Only pivots confirmed strictly before this candle are eligible; using a
    // pivot at or after i would be lookahead, and would make a backtest of this
    // look far better than live trading ever could.
    const lastHigh = [...highs].reverse().find(p => p.index + LOOKBACK < i && p.index > usedHighIdx);
    const lastLow = [...lows].reverse().find(p => p.index + LOOKBACK < i && p.index > usedLowIdx);

    if (lastHigh && c.close > lastHigh.price) {
      const avg = avgVolume(candles, i);
      const ratio = avg && c.volume != null ? c.volume / avg : null;
      signals.push({
        timestamp: c.timestamp,
        price: c.close,
        level: lastHigh.price,
        dir: 'bull',
        // CHoCH only when the break opposes an ESTABLISHED trend. In a range
        // (trend null) there is no character to change, so it is a plain BOS.
        kind: trendAt(i) === 'down' ? 'CHOCH' : 'BOS',
        volumeRatio: ratio,
        volumeBacked: ratio != null && ratio >= VOL_CONFIRM,
      });
      usedHighIdx = lastHigh.index;
      continue;
    }

    if (lastLow && c.close < lastLow.price) {
      const avg = avgVolume(candles, i);
      const ratio = avg && c.volume != null ? c.volume / avg : null;
      signals.push({
        timestamp: c.timestamp,
        price: c.close,
        level: lastLow.price,
        dir: 'bear',
        kind: trendAt(i) === 'up' ? 'CHOCH' : 'BOS',
        volumeRatio: ratio,
        volumeBacked: ratio != null && ratio >= VOL_CONFIRM,
      });
      usedLowIdx = lastLow.index;
    }
  }

  return signals;
}

/** Most recent signal, or null. What the alert cron and prompts care about. */
export function latestStructureSignal(candles: PACandle[]): PASignal | null {
  const all = detectStructureSignals(candles);
  return all.length ? all[all.length - 1] : null;
}

/** One-line summary for AI prompts and alert bodies. */
export function describeStructureSignal(s: PASignal | null): string {
  if (!s) return '-';
  const what = s.kind === 'CHOCH'
    ? (s.dir === 'bull' ? 'bullish reversal hint (CHoCH)' : 'bearish reversal hint (CHoCH)')
    : (s.dir === 'bull' ? 'bullish continuation (BOS)' : 'bearish continuation (BOS)');
  const vol = s.volumeRatio == null ? ''
    : s.volumeBacked ? ` on ${s.volumeRatio.toFixed(1)}x volume`
    : ` on light ${s.volumeRatio.toFixed(1)}x volume`;
  return `${what} - closed ${s.dir === 'bull' ? 'above' : 'below'} swing ${s.dir === 'bull' ? 'high' : 'low'} $${Number(s.level.toPrecision(6))}${vol}`;
}
