/* #2572 F1: lib/dailySummaryPrefs.ts summaryDueNow(lastSentAtMs, chosenHour, timeZone, nowMs) and localDateTime(timeZone, ms), as PURE functions (no route, no network).
 * Rule written from the PM's sentence, not from the code: due only inside the chosen local hour (minutes 0-30) AND only if the last send was on an EARLIER local date in the user's CURRENT timezone (UTC for null or a zone Intl rejects).
 *   D1  a table of inputs: never sent, earlier date, same date, hour moved earlier / later, zones that cross midnight, 23:50 then 00:10, bad and null zones, a send "in the future"
 *   D2  a simulated cron (a tick every 5 minutes) over several days gives exactly ONE send per local date, in UTC and in Manila, Auckland and New York, for several hours
 *   D3  DST: a fall-back day (the hour repeats) still sends once; a spring-forward day (the hour does not exist) sends nothing that day and resumes the next
 *   D4  localDateTime reads the zone, not UTC
 * MUTATIONS (each must go red): compare UTC dates instead of the user's; compare with <= (a second send the same date); a 23 h cooldown instead of the date; ignore the window; treat undefined last as not due. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryDueNow, localDateTime } from '../lib/dailySummaryPrefs.ts';

const t = (iso: string) => Date.parse(iso);

test('D1. summaryDueNow: the table', () => {
  type Row = [string, number | undefined, number, string | null, string, boolean];
  const rows: Row[] = [
    ['never sent, inside the window', undefined, 9, 'UTC', '2026-11-18T09:05:00Z', true],
    ['never sent, 09:30 is inside', undefined, 9, 'UTC', '2026-11-18T09:30:00Z', true],
    ['never sent, 09:31 is outside', undefined, 9, 'UTC', '2026-11-18T09:31:00Z', false],
    ['never sent, 08:59 is outside', undefined, 9, 'UTC', '2026-11-18T08:59:00Z', false],
    ['a NaN last send counts as never', Number.NaN, 9, 'UTC', '2026-11-18T09:05:00Z', true],
    ['sent earlier the same date', t('2026-11-18T09:05:00Z'), 9, 'UTC', '2026-11-18T09:20:00Z', false],
    ['sent yesterday, same hour', t('2026-11-17T09:05:00Z'), 9, 'UTC', '2026-11-18T09:05:00Z', true],
    ['F1: sent 09:05, hour moved to 07, next day 07:05 (22 h later)', t('2026-11-17T09:05:00Z'), 7, 'UTC', '2026-11-18T07:05:00Z', true],
    ['hour moved later after today\'s send: nothing more today', t('2026-11-18T09:05:00Z'), 11, 'UTC', '2026-11-18T11:05:00Z', false],
    ['hour moved later, not yet sent today (sent yesterday)', t('2026-11-17T09:05:00Z'), 11, 'UTC', '2026-11-18T11:05:00Z', true],
    ['23:50 then 00:10 next day, hour 0, UTC', t('2026-11-18T23:50:00Z'), 0, 'UTC', '2026-11-19T00:10:00Z', true],
    ['00:10 then 00:25 the same date, hour 0', t('2026-11-19T00:10:00Z'), 0, 'UTC', '2026-11-19T00:25:00Z', false],
    ['Manila: 07:40 local (23:40Z the day before) then 08:10 local (00:10Z): SAME local date although the UTC date changed', t('2026-11-17T23:40:00Z'), 8, 'Asia/Manila', '2026-11-18T00:10:00Z', false],
    ['Manila: the next local day sends', t('2026-11-17T23:40:00Z'), 8, 'Asia/Manila', '2026-11-19T00:10:00Z', true],
    ['Manila hour 0: 16:05Z is 00:05 local; last send 15:59Z (23:59 the local day before) is an earlier date', t('2026-11-18T15:59:00Z'), 0, 'Asia/Manila', '2026-11-18T16:05:00Z', true],
    ['Manila hour 0: last send 16:01Z (00:01 the same local date)', t('2026-11-18T16:01:00Z'), 0, 'Asia/Manila', '2026-11-18T16:05:00Z', false],
    ['Auckland hour 7 (18:05Z = 07:05 NZDT): last send 24 h earlier', t('2026-11-17T18:05:00Z'), 7, 'Pacific/Auckland', '2026-11-18T18:05:00Z', true],
    ['New York hour 23 (04:05Z = 23:05 EST the day before)', t('2026-11-18T04:05:00Z'), 23, 'America/New_York', '2026-11-19T04:05:00Z', true],
    ['New York hour 23: same local date', t('2026-11-19T04:05:00Z'), 23, 'America/New_York', '2026-11-19T04:25:00Z', false],
    ['zone null is UTC', t('2026-11-17T09:05:00Z'), 9, null, '2026-11-18T09:05:00Z', true],
    ['zone null is UTC (same date)', t('2026-11-18T09:05:00Z'), 9, null, '2026-11-18T09:20:00Z', false],
    ['a zone Intl rejects is UTC', t('2026-11-17T09:05:00Z'), 9, 'Not/AZone', '2026-11-18T09:05:00Z', true],
    ['a zone Intl rejects is UTC (same date)', t('2026-11-18T09:05:00Z'), 9, 'Not/AZone', '2026-11-18T09:20:00Z', false],
    ['a last send in the FUTURE (clock moved back) is never an earlier date', t('2026-11-19T09:05:00Z'), 9, 'UTC', '2026-11-18T09:05:00Z', false],
    ['timezone changed: the new zone decides "today" (sent 09:05Z = 17:05 Manila the 18th; now 23:05Z the 18th = 07:05 Manila the 19th, hour 7)', t('2026-11-18T09:05:00Z'), 7, 'Asia/Manila', '2026-11-18T23:05:00Z', true],
  ];
  for (const [label, last, hour, tz, now, want] of rows) {
    assert.equal(summaryDueNow(last, hour, tz, t(now)), want, label);
  }
  // Auckland, written out: 17:50Z on the 18th is 06:50 NZDT on the 19th, 18:05Z is 07:05 NZDT the same 19th -> same local date -> not due.
  assert.equal(localDateTime('Pacific/Auckland', t('2026-11-18T17:50:00Z')).date, localDateTime('Pacific/Auckland', t('2026-11-18T18:05:00Z')).date);
  assert.equal(summaryDueNow(t('2026-11-18T17:50:00Z'), 7, 'Pacific/Auckland', t('2026-11-18T18:05:00Z')), false, 'Auckland: same local date');
});

/** A cron that ticks every 5 minutes from `fromIso` for `days` days; returns the sends per local date in `tz`. */
function simulate(tz: string | null, hour: number, fromIso: string, days: number): Map<string, number> {
  const out = new Map<string, number>(); let last: number | undefined;
  for (let ms = t(fromIso); ms < t(fromIso) + days * 86_400_000; ms += 5 * 60_000) {
    if (summaryDueNow(last, hour, tz, ms)) { last = ms; const d = localDateTime(tz, ms).date; out.set(d, (out.get(d) ?? 0) + 1); }
  }
  return out;
}

test('D2. a 5-minute cron over several days: exactly one send per local date, in UTC, Manila, Auckland and New York, for several hours', () => {
  for (const tz of ['UTC', 'Asia/Manila', 'Pacific/Auckland', 'America/New_York', null]) for (const hour of [0, 7, 9, 23]) {
    const sends = simulate(tz, hour, '2026-11-16T00:00:00Z', 5);
    assert.ok(sends.size >= 4, `${tz} hour ${hour}: only ${sends.size} dates sent`);
    for (const [d, n] of sends) assert.equal(n, 1, `${tz} hour ${hour}: ${n} sends on local date ${d}`);
  }
});

test('D3. DST: the repeated hour (fall-back) sends once; the missing hour (spring-forward) sends nothing that day and resumes the next', () => {
  const fall = simulate('America/New_York', 1, '2026-10-31T00:00:00Z', 3);   // 2026-11-01 01:00-02:00 happens twice in New York
  assert.equal(fall.get('2026-11-01'), 1, 'fall-back day: the repeated hour sent more or less than once');
  const spring = simulate('America/New_York', 2, '2027-03-12T00:00:00Z', 5);   // 2027-03-14 has no 02:xx in New York
  assert.equal(spring.get('2027-03-14') ?? 0, 0, 'spring-forward day: a send for an hour that does not exist');
  assert.equal(spring.get('2027-03-13'), 1); assert.equal(spring.get('2027-03-15'), 1, 'the day after resumes');
});

test('D4. localDateTime reads the zone: date, hour and minute', () => {
  assert.deepEqual(localDateTime('Asia/Manila', t('2026-11-18T16:05:00Z')), { date: '2026-11-19', hour: 0, min: 5 });
  assert.deepEqual(localDateTime('America/New_York', t('2026-11-19T04:05:00Z')), { date: '2026-11-18', hour: 23, min: 5 });
  assert.deepEqual(localDateTime('Pacific/Auckland', t('2026-11-18T18:05:00Z')), { date: '2026-11-19', hour: 7, min: 5 });
  assert.deepEqual(localDateTime(null, t('2026-11-18T23:59:00Z')), { date: '2026-11-18', hour: 23, min: 59 });
  assert.deepEqual(localDateTime('Not/AZone', t('2026-11-18T00:00:00Z')), { date: '2026-11-18', hour: 0, min: 0 }, 'midnight is hour 0, not 24');
});
