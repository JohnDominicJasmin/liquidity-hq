/* #2426: the daily 7am summary goes to each recipient in the FIRST 30 MINUTES of THEIR local 7 o'clock (it was 10 minutes: the cron ticks every 5 minutes and two missed or slow ticks in a row skipped the whole day's
 * briefing). At 07:25 local it sends, at 07:31 it does not.
 *
 * TWO PINS, because the check lives inside the cron route and a whole route run per probe costs 10-14 s against the stand-in (the route's own limit is 28 s): a route cell with several probes was flaky on a loaded
 * machine and was dropped.
 *   W1  the SOURCE carries exactly one comparison, \`hour !== 7 || min > 30\`, and no other minute limit in the summary's eligibility loop;
 *   W2  the RULE, as an oracle written from the sentence above and evaluated through Intl in UTC and in other zones: 07:00-07:30 local inclusive is inside, 06:59 and 07:31 are outside, and a recipient
 *       in another zone is judged by their own local time, not by UTC.
 * W2 does not run the route; W1 is what ties the oracle's constant to the shipped code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

test('W1. the summary eligibility loop has exactly one window comparison: local hour 7 and minute at most 30', () => {
  const at = code.indexOf('async function checkDailySummary(');
  assert.ok(at > 0, 'checkDailySummary moved: re-read the route');
  const body = code.slice(at, at + 2500);
  const cmp = body.match(/if \(hour !== 7 \|\| min > (\d+)\) continue;/g) ?? [];
  assert.equal(cmp.length, 1, 'the window comparison is not there exactly once');
  assert.match(body, /hour !== 7 \|\| min > 30\) continue;/, 'the window is not 30 minutes (it was 10)');
  assert.ok(body.indexOf('hour !== 7') < body.indexOf('onCooldown(cdKey'), 'the cooldown check must come AFTER the window so a recipient outside it is never marked');
});

/** The rule from the sentence above. */
const inWindow = (zone: string, instantIso: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(instantIso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value); const min = Number(parts.find((p) => p.type === 'minute')?.value);
  return hour === 7 && min <= 30;
};

test('W2. the rule: 07:00-07:30 local is inside; 06:59 and 07:31 are outside; each recipient is judged by their own zone', () => {
  for (const [label, iso, want] of [['06:59', '2026-11-16T06:59:00Z', false], ['07:00', '2026-11-16T07:00:00Z', true], ['07:25', '2026-11-16T07:25:00Z', true], ['07:30', '2026-11-16T07:30:59Z', true], ['07:31', '2026-11-16T07:31:00Z', false], ['08:00', '2026-11-16T08:00:00Z', false]] as const) {
    assert.equal(inWindow('UTC', iso), want, `UTC ${label}`);
  }
  // New York is UTC-5 in mid-November: 07:25 there is 12:25Z, and 07:25Z is NOT its morning
  assert.equal(inWindow('America/New_York', '2026-11-16T12:25:00Z'), true); assert.equal(inWindow('America/New_York', '2026-11-16T12:31:00Z'), false); assert.equal(inWindow('America/New_York', '2026-11-16T07:25:00Z'), false);
  // Manila is UTC+8: 07:25 there is 23:25Z the day before
  assert.equal(inWindow('Asia/Manila', '2026-11-15T23:25:00Z'), true); assert.equal(inWindow('Asia/Manila', '2026-11-15T23:31:00Z'), false);
});
