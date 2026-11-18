/* QA's pin on the PURE quiet-hours / snooze / pause rule of #2567 (lib/alertQuiet.ts), to the millisecond, written against the owner's wording (a window runs from its start hour up to, not including, its end hour; a window with start later than end crosses midnight), not against the code.
 *   A1  a wrapping window 22-7 in UTC: 21:59:59.999 free, 22:00:00.000 held, 06:59:59.999 held, 07:00:00.000 free
 *   A2  a plain window 1-7: 00:59:59.999 free, 01:00:00.000 held, 06:59:59.999 held, 07:00:00.000 free
 *   A3  the hour is read in the account's own zone (Manila UTC+8, New York in winter UTC-5 and in summer UTC-4); null / empty / invalid zones are UTC
 *   A4  no window: start == end, either bound null, either bound outside 0-23 or not a whole number, NaN, strings
 *   A5  snooze: held strictly before the instant (1 ms before is held, the instant itself is free); unparseable or null never holds
 *   A6  precedence: paused beats snooze beats quiet, and every hold reports its own name
 *   A7  the zone's day change (DST) does not break the hour: Europe/London on the clock-change night
 *   A8  /status-side validators agree with the cron: isQuietHour accepts exactly the integers 0-23
 *   A9  every job that sends Telegram alerts to the stored chats (alert cron, its Web Push, macro-event cron) is filtered by the held set; a NEW route that talks to Telegram fails this scan until it honours the held set or is listed on purpose
 * WHAT IT CANNOT PROVE: the cron's wiring (qa/harness/telegramQuietSnooze.test.mts) or the database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertHoldAt, inQuietWindow, isQuietHour, isQuietNow, localHourIn } from '../lib/alertQuiet.ts';

const ms = (s: string) => Date.parse(s);
const held = (s: Parameters<typeof alertHoldAt>[0], t: string) => alertHoldAt(s, ms(t));

test('A1. wrapping window 22-7 (UTC), exact edges', () => {
  const s = { alert_quiet_start: 22, alert_quiet_end: 7, timezone: 'UTC' };
  assert.equal(held(s, '2026-11-18T21:59:59.999Z'), null); assert.equal(held(s, '2026-11-18T22:00:00.000Z'), 'quiet'); assert.equal(held(s, '2026-11-18T23:59:59.999Z'), 'quiet');
  assert.equal(held(s, '2026-11-19T00:00:00.000Z'), 'quiet'); assert.equal(held(s, '2026-11-19T06:59:59.999Z'), 'quiet'); assert.equal(held(s, '2026-11-19T07:00:00.000Z'), null); assert.equal(held(s, '2026-11-19T12:00:00.000Z'), null);
});
test('A2. plain window 1-7, exact edges', () => {
  const s = { alert_quiet_start: 1, alert_quiet_end: 7, timezone: 'UTC' };
  assert.equal(held(s, '2026-11-18T00:59:59.999Z'), null); assert.equal(held(s, '2026-11-18T01:00:00.000Z'), 'quiet'); assert.equal(held(s, '2026-11-18T06:59:59.999Z'), 'quiet'); assert.equal(held(s, '2026-11-18T07:00:00.000Z'), null); assert.equal(held(s, '2026-11-18T23:00:00.000Z'), null);
  const zero = { alert_quiet_start: 0, alert_quiet_end: 23, timezone: 'UTC' }; assert.equal(held(zero, '2026-11-18T00:00:00.000Z'), 'quiet'); assert.equal(held(zero, '2026-11-18T22:59:59.999Z'), 'quiet'); assert.equal(held(zero, '2026-11-18T23:00:00.000Z'), null);
  const wrapZero = { alert_quiet_start: 23, alert_quiet_end: 0, timezone: 'UTC' }; assert.equal(held(wrapZero, '2026-11-18T23:30:00.000Z'), 'quiet'); assert.equal(held(wrapZero, '2026-11-19T00:00:00.000Z'), null);
});
test('A3. the account zone decides the hour; null, empty and invalid zones read as UTC', () => {
  const w = (timezone: string | null) => ({ alert_quiet_start: 22, alert_quiet_end: 7, timezone });
  assert.equal(held(w('Asia/Manila'), '2026-11-18T14:00:00.000Z'), 'quiet', '22:00 Manila'); assert.equal(held(w('Asia/Manila'), '2026-11-18T13:59:59.999Z'), null); assert.equal(held(w('Asia/Manila'), '2026-11-18T23:00:00.000Z'), null, '07:00 Manila');
  assert.equal(held(w('America/New_York'), '2026-11-19T03:00:00.000Z'), 'quiet', '22:00 EST'); assert.equal(held(w('America/New_York'), '2026-07-19T02:00:00.000Z'), 'quiet', '22:00 EDT'); assert.equal(held(w('America/New_York'), '2026-07-19T01:59:59.999Z'), null, '21:59 EDT');
  for (const tz of [null, '', 'Not/AZone', 'GMT+99']) { assert.equal(held(w(tz), '2026-11-18T23:00:00.000Z'), 'quiet', JSON.stringify(tz)); assert.equal(held(w(tz), '2026-11-18T12:00:00.000Z'), null, JSON.stringify(tz)); }
  assert.equal(localHourIn('Asia/Kolkata', ms('2026-11-18T18:30:00.000Z')), 0, 'a half-hour zone: 00:00 next day'); assert.equal(localHourIn('Pacific/Kiritimati', ms('2026-11-18T10:00:00.000Z')), 0, 'UTC+14');
  for (let h = 0; h < 24; h++) assert.ok(localHourIn('UTC', Date.UTC(2026, 10, 18, h, 30)) === h, `hour ${h} (the 24 vs 0 midnight form)`);
});
test('A4. no window when start == end, either bound is null, or a bound is not a whole hour 0-23', () => {
  for (const [a, b] of [[5, 5], [null, 7], [22, null], [null, null], [24, 3], [3, 24], [-1, 5], [5, -1], [7.5, 9], [9, 12.5], [NaN, 3], [3, NaN], [Infinity, 3]] as Array<[number | null, number | null]>) assert.equal(inQuietWindow(a, b, 4), false, `${a}-${b}`);
  for (const [a, b] of [['22', 7], [22, '7'], [true, 3], [{}, 3], [[], 3], [undefined, 7]] as Array<[unknown, unknown]>) assert.equal(inQuietWindow(a as number, b as number, 4), false, `${String(a)}-${String(b)}`);
  assert.equal(held({ alert_quiet_start: 22, alert_quiet_end: 22, timezone: 'UTC' }, '2026-11-18T22:30:00.000Z'), null);
});
test('A5. snooze: held until the instant (1 ms before is held, the instant is free); null and unparseable never hold', () => {
  const until = '2026-11-18T15:00:00.000Z'; const s = { alert_snooze_until: until };
  assert.equal(held(s, '2026-11-18T14:59:59.999Z'), 'snoozed'); assert.equal(held(s, '2026-11-18T15:00:00.000Z'), null); assert.equal(held(s, '2026-11-18T15:00:00.001Z'), null); assert.equal(held(s, '2026-11-17T15:00:00.000Z'), 'snoozed', 'a snooze a day ahead holds');
  for (const bad of [null, '', 'garbage', '2026-13-45T99:99:99Z']) assert.equal(held({ alert_snooze_until: bad }, '2026-11-18T14:00:00.000Z'), null, JSON.stringify(bad));
  assert.equal(held({ alert_snooze_until: '9999-12-31T23:59:59.999Z' }, '2026-11-18T14:00:00.000Z'), 'snoozed', 'the pure rule holds for any future snooze; the 7-day cap is enforced where it is saved (settingsAlertControls V5)');
});
test('A6. precedence: paused > snoozed > quiet, each reported by name; paused null/false does nothing', () => {
  const all = { alert_paused: true, alert_snooze_until: '2026-11-18T20:00:00.000Z', alert_quiet_start: 22, alert_quiet_end: 7, timezone: 'UTC' }; const t = '2026-11-18T23:00:00.000Z';
  assert.equal(held(all, t), 'paused'); assert.equal(held({ ...all, alert_paused: false }, t), 'quiet', 'the snooze ended at 20:00, quiet still holds'); assert.equal(held({ ...all, alert_paused: false, alert_snooze_until: '2026-11-19T20:00:00.000Z' }, t), 'snoozed');
  assert.equal(held({ ...all, alert_paused: null, alert_quiet_start: null }, t), null); assert.equal(isQuietNow(all, ms(t)), true); assert.equal(isQuietNow(null, ms(t)), false); assert.equal(isQuietNow(undefined, ms(t)), false); assert.equal(isQuietNow({}, ms(t)), false);
  for (const nonBool of ['true', 1, 'yes']) assert.equal(held({ alert_paused: nonBool as unknown as boolean }, t), null, `alert_paused ${String(nonBool)} must not hold (only boolean true)`);
});
test('A7. a clock-change night does not break the hour: Europe/London 2026-10-25 (01:00-02:00 repeats) and 2026-03-29 (01:00-02:00 skipped)', () => {
  const s = { alert_quiet_start: 1, alert_quiet_end: 2, timezone: 'Europe/London' };
  assert.equal(held(s, '2026-10-25T00:30:00.000Z'), 'quiet', '01:30 BST'); assert.equal(held(s, '2026-10-25T01:30:00.000Z'), 'quiet', '01:30 GMT, the repeated hour'); assert.equal(held(s, '2026-10-25T02:00:00.000Z'), null);
  assert.equal(held(s, '2026-03-29T00:59:59.999Z'), null, '00:59 GMT'); assert.equal(held(s, '2026-03-29T01:00:00.000Z'), null, '02:00 BST: the 01:00 hour never happened');
});
test('A8. isQuietHour accepts exactly the whole numbers 0-23', () => {
  for (let h = 0; h < 24; h++) assert.equal(isQuietHour(h), true, String(h));
  for (const bad of [-1, 24, 23.5, NaN, Infinity, '5', null, undefined, true, {}, []]) assert.equal(isQuietHour(bad), false, String(bad));
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const routes = (dir: string): string[] => readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((n) => { const rel = `${dir}/${n}`; return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? routes(rel) : /^route\.ts$/.test(n) ? [rel] : []; });
test('A9. every job that SENDS Telegram alerts to the stored chats is filtered by the held set (pause / snooze / quiet hours): the alert cron, its Web Push, and the macro-event cron; any other route that talks to Telegram is on a short list of user-initiated or bot-plumbing routes', () => {
  const alertRoute = src('app/api/telegram/alert/route.ts'); const macro = src('app/api/macro-alert/route.ts');
  assert.match(alertRoute, /HELD_USERS = await loadHeldUserIds\(Date\.now\(\)\)/, 'the alert cron no longer loads the held users');
  assert.equal((alertRoute.match(/HELD_USERS\.has\(/g) ?? []).length >= 3, true, 'the alert cron filters by the held set in fewer than three places (price alerts, recipients, push)');
  const push = alertRoute.slice(alertRoute.indexOf('async function dispatchPush'), alertRoute.indexOf('async function dispatchPush') + 6000);
  assert.match(push, /\.filter\(s => proUserIds\.has\(s\.user_id\) && !HELD_USERS\.has\(s\.user_id\)\)/, 'dispatchPush (Web Push) is not filtered by the held set');
  assert.match(macro, /import \{ loadHeldUserIds \} from '@\/lib\/telegramAlertHolds'/); assert.match(macro, /held\.has\(row\.user_id as string\)/, 'the macro-event cron does not skip held users');
  const TELEGRAM_OK = new Set(['app/api/telegram/alert/route.ts', 'app/api/macro-alert/route.ts', 'app/api/telegram/webhook/route.ts', 'app/api/telegram/send/route.ts', 'app/api/telegram/test/route.ts', 'app/api/telegram/link-code/route.ts', 'app/api/telegram/test-alert/route.ts' /* #2572: "Send test alert" is a user TAP on the Alerts page: it must arrive even while paused, snoozed or in quiet hours, or a paused user tests and sees nothing (Dev + QA agree) */, 'app/api/telegram/setup-webhook/route.ts', 'app/api/telegram/bot-info/route.ts']);
  const talkers = routes('app').filter((r) => src(r).includes('api.telegram.org'));
  assert.deepEqual(talkers.filter((r) => !TELEGRAM_OK.has(r)), [], 'a new route sends to Telegram: it must honour the held set (lib/telegramAlertHolds.ts loadHeldUserIds) or be added to this list on purpose');
  assert.ok(talkers.includes('app/api/macro-alert/route.ts'), 'CONTROL: the scan found the macro-event cron');
});
