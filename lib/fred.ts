/* FRED (St. Louis Fed) series fetching.
 *
 * Extracted from app/api/econ-calendar/route.ts when /api/macro needed the same
 * thing for the 10Y real yield (#311). One CSV parser, not two.
 *
 * The graph CSV endpoint needs no API key and no account, which is the reason
 * this is a fetch rather than a client library. It returns:
 *
 *     DATE,DFII10
 *     2026-08-07,1.83
 *     2026-08-08,.            <- a real row, on a day with no observation
 *
 * That `.` is FRED's no-data marker and it appears on weekends, US market
 * holidays, and occasionally mid-week. parseFloat('.') is NaN, so the filter
 * below drops those rows rather than letting a NaN reach a caller doing
 * arithmetic on it - which would produce a NaN yield rendered as a confident
 * dash, the "responded fine, told us nothing" case again.
 */

const _cache: Record<string, { rows: FredRow[]; ts: number }> = {};

/** [observation date in ms UTC, value]. Oldest first, as FRED returns them. */
export type FredRow = [number, number];

export const FRED_TTL_DEFAULT = 12 * 3600_000;

/** Parse a FRED graph CSV body. Exported for tests - no network involved. */
export function parseFredCsv(text: string): FredRow[] {
  return text.split('\n').slice(1)
    .filter(l => l.includes(','))
    .map(l => {
      const [d, v] = l.trim().split(',');
      return [new Date(d + 'T00:00:00Z').getTime(), parseFloat(v)] as FredRow;
    })
    .filter(([d, v]) => !isNaN(d) && !isNaN(v));
}

/**
 * Fetch a FRED series as rows, module-cached.
 *
 * Returns `[]` on any failure and never throws. Callers must treat an empty
 * array as "could not measure" and say so, rather than rendering it as a
 * value - see the `unknown` handling in lib/realYield.ts.
 *
 * `ttlMs` is the module cache; daily series that publish on a schedule want a
 * shorter one than the 12h default, or the new observation sits unread for
 * most of a day after it lands.
 */
export async function fetchFredRows(seriesId: string, ttlMs = FRED_TTL_DEFAULT): Promise<FredRow[]> {
  const c = _cache[seriesId];
  if (c && Date.now() - c.ts < ttlMs) return c.rows;
  try {
    const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`,
      { next: { revalidate: Math.floor(ttlMs / 1000) } });
    if (!r.ok) return [];
    const rows = parseFredCsv(await r.text());
    _cache[seriesId] = { rows, ts: Date.now() };
    return rows;
  } catch { return []; }
}
