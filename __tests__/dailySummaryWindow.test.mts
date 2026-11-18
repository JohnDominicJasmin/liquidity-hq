/* #2426 + #2572: the daily summary goes to each recipient in the FIRST 30 MINUTES of THEIR chosen local hour (was a fixed local 07:00; the hour is now user_settings.daily_summary_hour, null = 7). At 07:25 local it sends, at 07:31 it does not.
 * The window used to be 10 minutes: the cron ticks every 5 minutes and two missed or slow ticks in a row skipped the whole day's briefing.
 *
 * TWO PINS plus one rule check, because the check lives inside the cron route and a whole route run per probe costs 10-14 s against the stand-in (the route's own limit is 28 s). The route itself is run in
 * qa/harness/telegramDailySummary.test.mts.
 *   W1  the SOURCE of the summary's loop asks summaryDueNow(lastSentAt(daily_summary_<chat>), chosen hour or 7, zone, now): the fixed hour gate and the 23 h cooldown (onCooldown / CD.daily) are GONE from it (QA F1, 4fb7bbe1)
 *       (the route harness cells F1-F6 in qa/harness/telegramDailySummary.test.mts run the behaviour; dailySummaryDue.test.mts tests summaryDueNow as a pure function)
 *   W2  the RULE, as an oracle written from the sentence above and evaluated through Intl in UTC and in other zones: the chosen local hour, minutes 0-30 inclusive, is inside; the minute before and 31 are outside
 *   W3  lib's inSummaryWindow agrees with that oracle for EVERY hour 0-23 at minutes 0, 29, 30, 31, 59, and the constants are 7 and 30
 * MUTATIONS (each must go red): old comparison restored in the route -> W1; window constant 30 -> 10 or 31 -> W3; chosen hour ignored (compare to 7) -> W3. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inSummaryWindow, DAILY_SUMMARY_WINDOW_MIN, DEFAULT_DAILY_SUMMARY_HOUR } from '../lib/dailySummaryPrefs.ts';

const src = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

test('W1. the summary loop asks summaryDueNow(lastSentAt(daily_summary_<chat>), chosen hour or 7, zone, now) and nothing else; the fixed 7 o\'clock gate and the 23 h cooldown for the summary are GONE (QA F1)', () => {
  const at = code.indexOf('async function checkDailySummary(');
  assert.ok(at > 0, 'checkDailySummary moved: re-read the route');
  const end = code.indexOf('\n}\n', at); const body = code.slice(at, end);
  // positive: the new shape
  assert.equal((body.match(/summaryDueNow\(/g) ?? []).length, 1, 'the due check is not made exactly once');
  assert.match(body, /const chosen = hourByUser\.get\(r\.userId\) \?\? DEFAULT_DAILY_SUMMARY_HOUR;/, 'the chosen hour does not fall back to 7');
  assert.match(body, /if \(!summaryDueNow\(lastSentAt\(`daily_summary_\$\{r\.chatId\}`\), chosen, zone, d\.getTime\(\)\)\) continue;/, 'the loop does not judge "due" with the last send, the chosen hour, the zone and now');
  assert.match(body, /const zone = CHAT_TZ\.get\(r\.chatId\) \|\| 'UTC';/, 'the zone does not fall back to UTC');
  // negative: the old behaviour is gone
  assert.doesNotMatch(body, /onCooldown\(/, 'the summary is judged by a cooldown again (a 23 h cooldown skips a day when the hour moves earlier)');
  assert.doesNotMatch(body, /CD\.daily/, 'CD.daily is back in the summary');
  assert.doesNotMatch(code, /\n\s*daily:\s+\d+ \* 3600_000/, 'a "daily" cooldown entry is back in CD');
  assert.doesNotMatch(body, /hour !== 7/, 'the old fixed 7 o\'clock gate is back');
  assert.doesNotMatch(body, /min > \d+/, 'a hand-written minute limit is in the loop again');
  assert.doesNotMatch(body, /getUTCHours|getHours|localHourMinute\(/, 'the loop reads the clock by itself again instead of through summaryDueNow');
  assert.doesNotMatch(body, /inSummaryWindow\(/, 'the loop judges the window by itself again instead of through summaryDueNow');
  // the mark: only after Telegram accepted it, under the same ledger key
  assert.match(body, /if \(res\.sent > 0\) markSent\(`daily_summary_\$\{r\.chatId\}`\);/, 'a send is marked even if Telegram refused it');
});

/** The rule from the sentence above, for any chosen hour. */
const inWindow = (zone: string, instantIso: string, chosen = 7) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instantIso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value); const min = Number(parts.find((p) => p.type === 'minute')?.value);
  return hour === chosen && min <= 30;
};

test('W2. the rule: chosen hour, minutes 0-30, is inside; the minute before and 31 are outside; each recipient is judged by their own zone', () => {
  for (const [label, iso, want] of [['06:59', '2026-11-16T06:59:00Z', false], ['07:00', '2026-11-16T07:00:00Z', true], ['07:25', '2026-11-16T07:25:00Z', true], ['07:30', '2026-11-16T07:30:59Z', true], ['07:31', '2026-11-16T07:31:00Z', false], ['08:00', '2026-11-16T08:00:00Z', false]] as const) {
    assert.equal(inWindow('UTC', iso), want, `UTC ${label}`);
  }
  assert.equal(inWindow('UTC', '2026-11-16T09:30:00Z', 9), true); assert.equal(inWindow('UTC', '2026-11-16T09:31:00Z', 9), false); assert.equal(inWindow('UTC', '2026-11-16T08:59:00Z', 9), false);
  assert.equal(inWindow('UTC', '2026-11-16T23:10:00Z', 23), true); assert.equal(inWindow('UTC', '2026-11-17T00:10:00Z', 23), false); assert.equal(inWindow('UTC', '2026-11-17T00:10:00Z', 0), true);
  // New York is UTC-5 in mid-November: 07:25 there is 12:25Z, and 07:25Z is NOT its morning
  assert.equal(inWindow('America/New_York', '2026-11-16T12:25:00Z'), true); assert.equal(inWindow('America/New_York', '2026-11-16T12:31:00Z'), false); assert.equal(inWindow('America/New_York', '2026-11-16T07:25:00Z'), false);
  // Manila is UTC+8: 07:25 there is 23:25Z the day before; hour 0 there is 16:xxZ
  assert.equal(inWindow('Asia/Manila', '2026-11-15T23:25:00Z'), true); assert.equal(inWindow('Asia/Manila', '2026-11-15T23:31:00Z'), false); assert.equal(inWindow('Asia/Manila', '2026-11-16T16:05:00Z', 0), true);
});

test('W3. lib inSummaryWindow agrees with the oracle for every hour 0-23 at minutes 0, 29, 30, 31, 59; the constants are 7 and 30', () => {
  assert.equal(DEFAULT_DAILY_SUMMARY_HOUR, 7); assert.equal(DAILY_SUMMARY_WINDOW_MIN, 30);
  for (let chosen = 0; chosen < 24; chosen++) for (let h = 0; h < 24; h++) for (const m of [0, 29, 30, 31, 59]) {
    const iso = `2026-11-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
    assert.equal(inSummaryWindow(h, m, chosen), inWindow('UTC', iso, chosen), `chosen ${chosen} at ${h}:${m}`);
  }
});
