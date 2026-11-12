/* #2177 / #2107: the tour's step 5 body no longer claims real-time scanning. The shipped default is what a user sees
 * unless a production label row overrides it, so the default must be true on its own. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EN = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

test('T1. tour step 5 says the major coins are checked every few minutes, not in real time', () => {
  const body = EN.SPOTLIGHT_TOUR_STEP5_BODY;
  assert.ok(typeof body === 'string' && body.length > 0, 'SPOTLIGHT_TOUR_STEP5_BODY has no English default');
  assert.match(body, /every few minutes/i, 'step 5 no longer says how often the coins are checked');
  assert.doesNotMatch(body, /real.?time|every second|instant|live scores/i, 'step 5 claims real-time scanning again');
});

test('T2. CONTROL: the claim pattern matches the sentence it forbids, so T1 can fail', () => {
  assert.match('Scores update in real-time for every coin', /real.?time|every second|instant|live scores/i);
});
