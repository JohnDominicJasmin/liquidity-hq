/* Correlation maths for /correlation, kept out of the component so it can be pinned.
 *
 * Three things the component did wrong, all giving a confident-looking number from bad input:
 *  - ALIGNMENT. It paired the OLDEST bar of the longer series with the OLDEST bar of the shorter one (slice(0, n)).
 *    Both series end at the newest bar, so the right edge is the one they share: a coin with a shorter history was
 *    paired with the wrong dates of the other. Right-align (slice(-n)).
 *  - NON-FINITE INPUT. A bad or zero close made a NaN or Infinity return; NaN passes `denom < 1e-10` and came out as
 *    NaN, which then landed on the "Alts Lockstep" panel. Any non-finite term now returns null.
 *  - SAMPLE SIZE. Five returns were enough to print r to two decimals. The floor is MIN_RETURNS.
 * The newest kline is still open, so `closedCloses` drops it. */

export const MIN_RETURNS = 20;

/** Closes of finished bars only: the last bar from the exchange is still forming. */
export function closedCloses(closes: number[]): number[] {
  return closes.slice(0, -1);
}

/** Simple returns. A non-finite close, or a zero previous close, makes the whole series unusable (empty). */
export function pctReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1], cur = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return [];
    r.push((cur - prev) / prev);
  }
  return r;
}

/** Pearson r over the most recent overlap of two return series, or null when it cannot be stated honestly. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < MIN_RETURNS) return null;
  const xs = a.slice(-n), ys = b.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (!Number.isFinite(denom) || denom < 1e-10) return null;
  const r = num / denom;
  if (!Number.isFinite(r)) return null;
  return Math.max(-1, Math.min(1, r));
}

/** The BTC-vs-alts average, or null unless at least half of the alts have a usable correlation. */
export function btcAltAverage(vsBtc: (number | null)[], altCount: number): number | null {
  const ok = vsBtc.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length === 0 || ok.length * 2 < altCount) return null;
  return ok.reduce((s, v) => s + v, 0) / ok.length;
}

/** Least-correlated first: a pair at -0.8 is a strong relationship, so rank by distance from zero. */
export function weakestPairs<T extends { r: number }>(pairs: T[], take: number): T[] {
  return [...pairs].sort((x, y) => Math.abs(x.r) - Math.abs(y.r)).slice(0, take);
}
