/* The "actual" a released economic event shows, read from FRED (St. Louis Fed).
 *
 * THREE WRONG-NUMBER DEFECTS FIXED HERE (PM audit, 2026-11-16):
 *  1. PREVIOUS PRINT AS THE ACTUAL. FRED dates a monthly row at the first of its REFERENCE month and publishes it hours to days after the
 *     agency. The old code took the newest row at or before the event time, so on release day, before FRED updated, the previous month's
 *     figure came back as the new release's actual - and was then cached and handed to the Arena prompt as "RELEASED ... ACTUAL". A row is
 *     now accepted only when it is the row for the release's own reference period; otherwise there is no actual yet.
 *  2. WRONG SERIES. GDP was NOMINAL GDP annualised (about 4-6% against a headline real figure near 2%), PCE was nominal consumption spending
 *     rather than the price index, and PPI was "all commodities" rather than final demand. They are now A191RL1Q225SBEA (real GDP growth,
 *     already an annualised percent), PCEPI and PPIFIS.
 *  3. IMPACT. Every event was labelled 'high'. */

export type FredFmt = 'rate' | 'mom_change' | 'mom_pct' | 'level_pct';

export const FRED_CFG: Record<string, { id: string; fmt: FredFmt; period: 'daily' | 'month' | 'quarter' }> = {
  FOMC:   { id: 'DFEDTARU',        fmt: 'rate',       period: 'daily' },    // Fed Funds target upper bound
  NFP:    { id: 'PAYEMS',          fmt: 'mom_change', period: 'month' },    // Nonfarm payrolls level (thousands)
  CPI:    { id: 'CPIAUCSL',        fmt: 'mom_pct',    period: 'month' },    // CPI, seasonally adjusted
  PPI:    { id: 'PPIFIS',          fmt: 'mom_pct',    period: 'month' },    // PPI final demand (the headline)
  PCE:    { id: 'PCEPI',           fmt: 'mom_pct',    period: 'month' },    // PCE price index
  GDP:    { id: 'A191RL1Q225SBEA', fmt: 'level_pct',  period: 'quarter' },  // real GDP growth, annualised percent
  RETAIL: { id: 'RSAFS',           fmt: 'mom_pct',    period: 'month' },    // Retail sales
};

/** UTC ms of the first day of the period a release published at `eventTs` reports on, or null for a daily series. */
export function referencePeriodStart(period: 'daily' | 'month' | 'quarter', eventTs: number): number | null {
  const d = new Date(eventTs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === 'month') return Date.UTC(y, m - 1, 1);
  if (period === 'quarter') {
    let q = Math.floor(m / 3) - 1, yy = y;
    if (q < 0) { q = 3; yy = y - 1; }
    return Date.UTC(yy, q * 3, 1);
  }
  return null;
}

const signed = (n: number, digits: number) => (n >= 0 ? '+' : '') + n.toFixed(digits);

/** The formatted actual, or undefined when FRED does not (yet) hold the row for this release's own period. */
export function fredActual(rows: [number, number][], eventTs: number, type: string): string | undefined {
  const cfg = FRED_CFG[type];
  if (!cfg || rows.length < 1) return undefined;

  if (cfg.period === 'daily') {
    let i = rows.length - 1;
    while (i >= 0 && rows[i][0] > eventTs) i--;
    return i >= 0 ? rows[i][1].toFixed(2) + '%' : undefined;
  }

  const want = referencePeriodStart(cfg.period, eventTs);
  const i = rows.findIndex(r => r[0] === want);
  if (i < 0) return undefined;
  const cur = rows[i][1];
  if (cfg.fmt === 'level_pct') return signed(cur, 1) + '%';
  if (i < 1) return undefined;
  const prev = rows[i - 1][1];
  if (cfg.fmt === 'mom_change') return signed(Math.round(cur - prev), 0) + 'K';
  if (!prev) return undefined;
  return signed(((cur - prev) / prev) * 100, 1) + '%';
}

/** Market impact per event type. FOMC, CPI and NFP move markets; the rest are scheduled data of lower weight. */
export function scheduledImpact(type: string): 'high' | 'med' {
  return type === 'FOMC' || type === 'CPI' || type === 'NFP' ? 'high' : 'med';
}
