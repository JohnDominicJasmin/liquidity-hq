/* Funding history on one basis (#1651): every figure per 8 hours, and ranges measured in time.
 *
 * Contracts settle every 1, 2, 4 or 8 hours. The rate an exchange lists for one settlement covers that interval only, so a 4-hour coin's
 * rows are half the per-8h figure the "Current" column shows, and "the last 21 rows" is three and a half days, not seven. */

const HOUR_MS = 3_600_000;

export interface FundingPoint {
  /** Per 8 hours. */
  rate: number;
  ts: number;
  /** The settlement interval this row covered, in hours. */
  hours: number;
}

const INTERVALS = [1, 2, 4, 8];

/** The interval a gap between two settlements stands for. A gap longer than 8 h is a missing row, read as 8. */
function intervalOf(gapMs: number): number {
  const h = gapMs / HOUR_MS;
  return INTERVALS.reduce((best, i) => (Math.abs(i - h) < Math.abs(best - h) ? i : best), 8);
}

/**
 * Raw rows (oldest first) to per-8h points. Each row's interval is the gap since the row before it, so a contract that changed its
 * interval part way is scaled row by row. The first row takes the gap to the second; a lone row is taken as 8 h.
 */
export function perEightHours(rows: ReadonlyArray<{ rate: number; ts: number }>): FundingPoint[] {
  return rows.map((r, i) => {
    const gap = i > 0 ? r.ts - rows[i - 1].ts : rows.length > 1 ? rows[1].ts - r.ts : 8 * HOUR_MS;
    const hours = intervalOf(gap);
    return { rate: r.rate * (8 / hours), ts: r.ts, hours };
  });
}

/** The points of the last `days` days, counted back from the newest settlement. */
export function lastDays<P extends { ts: number }>(points: ReadonlyArray<P>, days: number): P[] {
  if (!points.length) return [];
  const from = points[points.length - 1].ts - days * 24 * HOUR_MS;
  return points.filter(p => p.ts > from);
}

/** The average per-8h rate over time: each row counts for the hours it covered. */
export function timeAverage(points: ReadonlyArray<{ rate: number; hours?: number }>): number | null {
  let sum = 0, hours = 0;
  for (const p of points) {
    const h = p.hours ?? 8;
    sum += p.rate * h;
    hours += h;
  }
  return hours > 0 ? sum / hours : null;
}
