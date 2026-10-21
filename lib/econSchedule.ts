/* The US macro release schedule, as published by the agencies themselves (#1625).
 *
 * WHY THIS REPLACES THE COMPUTED RULES. The route used to derive CPI / NFP / PPI / PCE / GDP / Retail dates from patterns ("CPI is about the
 * 12th", "NFP is the first Friday"). Measured against the agencies on 2026-10-20 the patterns were wrong for most upcoming releases: CPI two
 * days late, NFP an hour late in November and on a holiday (Jan 1) in January, GDP three days early, PCE on the wrong day of every month.
 * A trader planning around a date is the one thing this page is for, so a pattern is not good enough and a guess must not be shown at all.
 * This table is the published schedule; there is no estimate path.
 *
 * SOURCES (read 2026-10-21; every release below is 08:30 ET, FOMC statements 14:00 ET):
 *   BLS  CPI            https://www.bls.gov/schedule/news_release/cpi.htm
 *   BLS  Employment Sit https://www.bls.gov/schedule/news_release/empsit.htm   (the jobs report, "NFP")
 *   BLS  PPI            https://www.bls.gov/schedule/news_release/ppi.htm
 *   BEA  GDP + Personal Income and Outlays (PCE)  https://www.bea.gov/news/schedule  (iCal: .../news/schedule/ics/online-calendar-subscription.ics)
 *   Census  Advance Monthly Retail Trade          https://www.census.gov/retail/release_schedule.html
 *   Fed  FOMC           https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm   (2027 dates are tentative until the preceding meeting)
 * bls.gov answers a scripted request with 403, so BLS cannot be read live from the server; that is why this is a checked-in table and not a fetch.
 * The BLS rows were read through a page reader (not by hand) and agree with the independent comparison on #1625 for Nov 2026 - Jan 2027;
 * BEA's are the iCal's own UTC timestamps (08:30 ET in both EDT and EST); Census and the Fed were read from their pages.
 *
 * TIMES. Dates are the ET calendar date as published; the UTC instant is computed from ET WITH daylight saving (EDT until 2026-11-01, EST after,
 * and the March / November switches in 2027), never from a fixed offset. See etToUtcMs.
 *
 * REFRESH. The agencies publish next year's schedule in the autumn. SCHEDULE_COVERS_THROUGH is the last date this table speaks for; past it the
 * route returns no events and says "unavailable" rather than showing an empty calendar as if nothing were scheduled.
 */

export type ReleaseType = 'NFP' | 'CPI' | 'PPI' | 'PCE' | 'GDP' | 'RETAIL' | 'FOMC';

export interface ScheduledRelease {
  type: ReleaseType;
  /** ET calendar date, YYYY-MM-DD, as published. */
  date: string;
  /** ET wall-clock time, HH:MM. */
  time: string;
}

/** When the table was last read from the agencies. */
export const SCHEDULE_READ_ON = '2026-10-21';
/** The last date every agency's schedule in this table reaches (the Dec 2027 jobs report, NFP, is the first release past it that is unpublished). */
export const SCHEDULE_COVERS_THROUGH = '2027-12-03';

const T0830 = '08:30';
const T1400 = '14:00';
const at = (type: ReleaseType, time: string, dates: readonly string[]): ScheduledRelease[] => dates.map(date => ({ type, date, time }));

export const SCHEDULE: readonly ScheduledRelease[] = [
  // BLS Employment Situation (NFP) - reference months Oct 2026 .. Nov 2027
  ...at('NFP', T0830, ['2026-11-06', '2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04',
    '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03']),
  // BLS CPI
  ...at('CPI', T0830, ['2026-11-10', '2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10',
    '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10']),
  // BLS PPI
  ...at('PPI', T0830, ['2026-11-13', '2026-12-15', '2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13', '2027-06-11',
    '2027-07-15', '2027-08-10', '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15']),
  // Census Advance Monthly Retail Trade (Dec 2027's release is "to be announced" and is not listed)
  ...at('RETAIL', T0830, ['2026-11-17', '2026-12-16', '2027-01-15', '2027-02-17', '2027-03-16', '2027-04-16', '2027-05-14', '2027-06-16',
    '2027-07-16', '2027-08-16', '2027-09-16', '2027-10-15', '2027-11-16', '2027-12-15']),
  // BEA: GDP (advance / second / third estimate) and Personal Income and Outlays (the PCE release) land on the same day
  ...at('GDP', T0830, ['2026-10-29', '2026-11-25', '2026-12-23', '2027-01-28', '2027-02-25', '2027-03-31', '2027-04-29', '2027-05-27',
    '2027-06-25', '2027-07-29', '2027-08-25', '2027-09-30', '2027-10-28', '2027-11-24', '2027-12-22']),
  ...at('PCE', T0830, ['2026-10-29', '2026-11-25', '2026-12-23', '2027-01-28', '2027-02-25', '2027-03-31', '2027-04-29', '2027-05-27',
    '2027-06-25', '2027-07-29', '2027-08-25', '2027-09-30', '2027-10-28', '2027-11-24', '2027-12-22']),
  // Fed FOMC: the second (decision) day of each meeting. Used when the live read of the Fed page returns nothing.
  ...at('FOMC', T1400, ['2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15',
    '2027-10-27', '2027-12-08']),
];

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

function etWallClock(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of ET_PARTS.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The UTC instant (ms) of an America/New_York wall-clock time, daylight saving included. EDT is UTC-4, EST is UTC-5: try both and keep the
 *  one that reads back as the wanted ET time. Throws on a time that does not exist in ET (the spring-forward gap), so a bad row fails loudly. */
export function etToUtcMs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const want = `${date}T${time}`;
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, hh + offset, mm);
    if (etWallClock(ms) === want) return ms;
  }
  throw new Error(`etToUtcMs: ${want} does not exist in America/New_York`);
}

export interface ScheduledInstant { type: ReleaseType; isoDate: string }

/** The scheduled releases that fall in [now - 24h, now + horizonDays], as UTC instants. */
export function scheduledInstants(now: Date, horizonDays = 90): ScheduledInstant[] {
  const lo = now.getTime() - 24 * 3600_000;
  const hi = now.getTime() + horizonDays * 24 * 3600_000;
  const out: ScheduledInstant[] = [];
  for (const r of SCHEDULE) {
    const ms = etToUtcMs(r.date, r.time);
    if (ms >= lo && ms <= hi) out.push({ type: r.type, isoDate: new Date(ms).toISOString() });
  }
  return out;
}
