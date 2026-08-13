import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAlertTally } from '../lib/alertTally.ts';

/* #82. The alert cron's one line of output could not distinguish correct
 * filtering from a total delivery outage - both printed `fired=7 sent=0
 * failed=0`. It cost part of an investigation on 2026-08-08.
 *
 * The counts were split then. QA's ask, and the reason this file exists:
 *
 *   > Please add the regression test in the same PR. A log format nobody
 *   > asserts on drifts back within a month, and the whole point of this issue
 *   > is that the drift is invisible.
 *
 * Correct: nothing fails when a log line stops answering a question. It just
 * stops answering it, and you find out during the next incident.
 */

const RUN = {
  fired: ['ema_1h', 'structure_4h'],
  queued: 2,
  eligible: 2,
  sent: 1,
  failed: 0,
  recipients: 3,
};

test('the alert tally line', async (t) => {
  await t.test('carries every stage', () => {
    const line = formatAlertTally(RUN);
    for (const key of ['fired=', 'queued=', 'eligible=', 'sent=', 'failed=', 'recipients=']) {
      assert.ok(line.includes(key), `${key} is missing - the line stops answering a question`);
    }
  });

  /* The rule keys are what makes a structure alert visible without a database
     query. Dropping them is the other way this line quietly gets less useful. */
  await t.test('names the rules that fired', () => {
    assert.match(formatAlertTally(RUN), /fired=2 \(ema_1h,structure_4h\)/);
  });

  await t.test('omits the empty parenthesis when nothing fired', () => {
    assert.match(formatAlertTally({ ...RUN, fired: [] }), /fired=0 queued=/);
  });
});

/* THE ASSERTION THIS ISSUE IS ABOUT.
 *
 * Not "the line has six numbers" - a format can keep all six and still collapse
 * the two states, which is what happens if someone decides `eligible` is
 * redundant with `queued`. So this compares the two states directly and demands
 * they render differently.
 *
 * Both runs below fired the same rules to the same recipients. One filtered
 * everything correctly. The other could not deliver anything. Under the old
 * three-number format they were the same string. */
test('correct filtering and a delivery outage cannot render alike', async (t) => {
  const fired = ['ema_1h', 'ema_4h', 'rsi_1h'];

  const allFiltered = formatAlertTally({
    fired, queued: 3, eligible: 0, sent: 0, failed: 0, recipients: 4,
  });
  const totalOutage = formatAlertTally({
    fired, queued: 3, eligible: 3, sent: 0, failed: 3, recipients: 4,
  });

  await t.test('the two lines differ', () => {
    assert.notEqual(allFiltered, totalOutage,
      'a fully-filtered run and a total delivery outage print the same line - ' +
      'this is #82, and it has come back');
  });

  /* And they differ at the number that carries the meaning, not incidentally
     somewhere else. `eligible` is the discriminator: 0 means the filters did
     their job, >0 with sent=0 means delivery is broken. */
  await t.test('they differ at `eligible`, which is the discriminator', () => {
    assert.match(allFiltered, /eligible=0 /);
    assert.match(totalOutage, /eligible=3 /);
  });

  /* The old format, reconstructed. If a future line only carries these, the
     collapse is back regardless of what else changed. */
  await t.test('the three old numbers alone are still ambiguous', () => {
    const old = (l: string) => l.match(/fired=\d+|sent=\d+|failed=\d+/g)?.join(' ');
    assert.equal(old(allFiltered), 'fired=3 sent=0 failed=0');
    assert.notEqual(old(allFiltered), old(totalOutage),
      'sanity: the old numbers differ here because failed differs - the ' +
      'genuinely identical case is covered by the test above');
  });
});

/* The formatter is only worth anything if the route uses it. Comments stripped
   first - the sixth suite in this repo to scan source, and the habit exists
   because four of the previous five passed a mutation on their own prose. */
test('the cron route logs through the formatter', () => {
  const src = readFileSync(
    new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.match(src, /console\.log\(formatAlertTally\(/,
    'the route builds the line inline again - the format is no longer asserted anywhere');
  assert.doesNotMatch(src, /`\[alert\] fired=/,
    'an inline [alert] template literal is back alongside the formatter');
});
