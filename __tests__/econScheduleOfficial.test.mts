/* #1651 layer 4: the economic calendar's dates against the agencies' own published schedules, not against lib/econSchedule.ts itself.
 *
 * THE ORACLE was read by QA on 2026-10-21 (~20:45 UTC), independently of the table's own read, from each publisher:
 *   Fed FOMC     https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm   (decision = the meeting's second day, 14:00 ET)
 *   BLS CPI      https://www.bls.gov/schedule/news_release/cpi.htm                 (08:30 ET)
 *   BLS jobs     https://www.bls.gov/schedule/news_release/empsit.htm              (Employment Situation, "NFP", 08:30 ET)
 *   BLS PPI      https://www.bls.gov/schedule/news_release/ppi.htm                 (08:30 ET)
 *   Census       https://www.census.gov/retail/release_schedule.html               (Advance Monthly Retail Trade; Dec 2027 "to be announced")
 *   BEA          https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics   (GDP and Personal Income and Outlays = PCE, as UTC)
 * The dates are written below as the publisher prints them. BEA's iCal gives UTC instants, which are also the oracle for the ET->UTC
 * conversion across both daylight-saving switches (2026-11-01 and 2027-03-14 / 2027-11-07).
 *
 * D1 is the table, type by type, equal to the published list (nothing missing, nothing extra, nothing computed). D2 is every release's UTC
 * instant. D3 holds the rows to what every agency does: a weekday, never a US federal holiday, inside the window the table says it covers.
 *
 * REFRESH: when the agencies publish 2028, the table and this oracle are re-read together; a date that moves (agencies reschedule, e.g. after a
 * shutdown) fails here first, which is the point. WHAT IT CANNOT PROVE: the live read of the Fed page in app/api/econ-calendar/route.ts (it
 * prefers that read over the table's FOMC rows), or what the calendar panel draws. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULE, SCHEDULE_COVERS_THROUGH, etToUtcMs, type ReleaseType } from '../lib/econSchedule.ts';

const PUBLISHED: Record<ReleaseType, string[]> = {
  FOMC: ['2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08'],
  CPI: ['2026-11-10', '2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11',
    '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'],
  NFP: ['2026-11-06', '2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06',
    '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'],
  PPI: ['2026-11-13', '2026-12-15', '2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13', '2027-06-11', '2027-07-15', '2027-08-10',
    '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15'],
  RETAIL: ['2026-11-17', '2026-12-16', '2027-01-15', '2027-02-17', '2027-03-16', '2027-04-16', '2027-05-14', '2027-06-16', '2027-07-16', '2027-08-16',
    '2027-09-16', '2027-10-15', '2027-11-16', '2027-12-15'],
  GDP: ['2026-10-29', '2026-11-25', '2026-12-23', '2027-01-28', '2027-02-25', '2027-03-31', '2027-04-29', '2027-05-27', '2027-06-25', '2027-07-29',
    '2027-08-25', '2027-09-30', '2027-10-28', '2027-11-24', '2027-12-22'],
  PCE: ['2026-10-29', '2026-11-25', '2026-12-23', '2027-01-28', '2027-02-25', '2027-03-31', '2027-04-29', '2027-05-27', '2027-06-25', '2027-07-29',
    '2027-08-25', '2027-09-30', '2027-10-28', '2027-11-24', '2027-12-22'],
};
/* The rows dated before the oracle was read (2026-10-21) are past events the table no longer needs; a row on or after it must be published. */
const READ_ON = '2026-10-21';

test('D1. each release type in the table is exactly the publisher\'s list: none missing, none extra, none moved', () => {
  for (const type of Object.keys(PUBLISHED) as ReleaseType[]) {
    const table = SCHEDULE.filter((r) => r.type === type && r.date >= READ_ON).map((r) => r.date).sort();
    assert.deepEqual(table, PUBLISHED[type], `${type}: the table differs from the published schedule`);
  }
  const types = new Set(SCHEDULE.map((r) => r.type));
  assert.deepEqual([...types].sort(), Object.keys(PUBLISHED).sort(), 'a release type with no published oracle here');
});

test('D2. every release is at its published ET time and its UTC instant follows daylight saving (BEA\'s own UTC stamps)', () => {
  for (const r of SCHEDULE) assert.equal(r.time, r.type === 'FOMC' ? '14:00' : '08:30', `${r.type} ${r.date} is not at its published time`);
  const bea: Array<[string, string]> = [   // [ET date of an 08:30 release, BEA iCal DTSTART]
    ['2026-10-29', '2026-10-29T12:30:00.000Z'], ['2026-11-25', '2026-11-25T13:30:00.000Z'], ['2026-12-23', '2026-12-23T13:30:00.000Z'],
    ['2027-01-28', '2027-01-28T13:30:00.000Z'], ['2027-02-25', '2027-02-25T13:30:00.000Z'], ['2027-03-31', '2027-03-31T12:30:00.000Z'],
    ['2027-10-28', '2027-10-28T12:30:00.000Z'], ['2027-11-24', '2027-11-24T13:30:00.000Z'], ['2027-12-22', '2027-12-22T13:30:00.000Z'],
  ];
  for (const [date, utc] of bea) assert.equal(new Date(etToUtcMs(date, '08:30')).toISOString(), utc, `08:30 ET on ${date}`);
  // The FOMC statement, 14:00 ET, either side of the November switch, and both days of each 2027 switch.
  assert.equal(new Date(etToUtcMs('2026-10-28', '14:00')).toISOString(), '2026-10-28T18:00:00.000Z');
  assert.equal(new Date(etToUtcMs('2026-12-09', '14:00')).toISOString(), '2026-12-09T19:00:00.000Z');
  assert.equal(new Date(etToUtcMs('2027-03-13', '08:30')).toISOString(), '2027-03-13T13:30:00.000Z');
  assert.equal(new Date(etToUtcMs('2027-03-15', '08:30')).toISOString(), '2027-03-15T12:30:00.000Z');
  assert.throws(() => etToUtcMs('2027-03-14', '02:30'), /does not exist/, 'a time inside the spring-forward gap must fail loudly');
});

/* US federal holidays (observed dates) the table spans, from OPM's published list: no agency releases on these. */
const FEDERAL_HOLIDAYS = ['2026-11-11', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24'];

/* SCHEDULE_COVERS_THROUGH is the last date EVERY agency's schedule reaches, not the last row: later CPI / PPI / GDP rows are published, but the
   next jobs report is not, so past it the calendar would be missing a release. The jobs report is the earliest-ending published list. */
test('D3. every row is a weekday and never a federal holiday; the covered window ends at the earliest-ending published list', () => {
  for (const r of SCHEDULE) {
    const day = new Date(`${r.date}T12:00:00Z`).getUTCDay();
    assert.ok(day >= 1 && day <= 5, `${r.type} ${r.date} falls on a weekend`);
    assert.ok(!FEDERAL_HOLIDAYS.includes(r.date), `${r.type} ${r.date} is a federal holiday`);
  }
  const lastOfEach = Object.values(PUBLISHED).map((dates) => dates.at(-1)!).sort();
  assert.equal(SCHEDULE_COVERS_THROUGH, lastOfEach[0], 'the window claims more than every agency has published');
});
