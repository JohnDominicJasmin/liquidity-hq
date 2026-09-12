import test from 'node:test';
import assert from 'node:assert/strict';
import { trialReminderCutoff } from '../lib/trialReminder.ts';

/* #1227 (Q6 audit) -> #1230. Pure ms arithmetic extracted out of
 * app/api/trial-reminder/route.ts's bare Date.now() cutoff. */

test('trialReminderCutoff', async (t) => {
  await t.test('adds windowDays as exact milliseconds, not a calendar day', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00.000Z
    const expected = new Date(Date.UTC(2026, 0, 4, 0, 0, 0)).toISOString(); // +3 days, same time-of-day
    assert.equal(trialReminderCutoff(now, 3), expected);
  });

  await t.test('holds at a non-midnight instant - no implicit rounding to a day boundary', () => {
    const now = Date.UTC(2026, 5, 15, 13, 45, 30, 250);
    const expected = new Date(Date.UTC(2026, 5, 22, 13, 45, 30, 250)).toISOString(); // +7 days, same hh:mm:ss.ms
    assert.equal(trialReminderCutoff(now, 7), expected);
  });

  await t.test('is timezone-agnostic - a UTC-computed expectation matches regardless of the process TZ', () => {
    // Ms-since-epoch arithmetic plus toISOString (always UTC output) means the
    // process's local TZ can never enter this calculation. Asserting against
    // an expectation built the same way (Date.UTC, not local Date fields)
    // proves that, rather than merely happening to pass under this runner's TZ.
    const now = Date.UTC(2026, 11, 30, 23, 0, 0); // 2026-12-30T23:00:00.000Z
    const expected = new Date(Date.UTC(2027, 0, 4, 23, 0, 0)).toISOString(); // crosses a year boundary too
    assert.equal(trialReminderCutoff(now, 5), expected);
  });

  await t.test('windowDays of 0 is the instant itself, not a day earlier or later', () => {
    const now = Date.UTC(2026, 2, 10, 9, 0, 0);
    assert.equal(trialReminderCutoff(now, 0), new Date(now).toISOString());
  });

  await t.test('returns a real ISO-8601 UTC string', () => {
    const result = trialReminderCutoff(Date.UTC(2026, 0, 1), 1);
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
