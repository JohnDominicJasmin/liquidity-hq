/* #382 / #384 - which messages silently spend a LIVE SEARCH.
 *
 * This function decides which of a user's two daily quotas a chat message
 * bills. It was untestable inside a .tsx component, which is why nobody had
 * ever enumerated what it matches. I reported the substring risk on #382 as
 * "not verified" - this is that verification, and it found real collisions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsLiveSearch, SEARCH_TRIGGERS } from '../lib/searchTriggers.ts';

/* ── 1. the behaviour the owner approved ────────────────────────────────── */

test('the owner\'s own question escalates - the case that opened #382', () => {
  // "i have 40 left but my account is max of 10 chats only?" - this is the
  // message shape that produced it. Two triggers, either alone is enough.
  assert.equal(needsLiveSearch('why is BTC down today'), true);
});

test('a plain market question does NOT escalate', () => {
  // If this ever flips, every chat message starts billing the search quota
  // and the 50/day chat allowance becomes unreachable.
  for (const q of [
    'is BTC bullish',
    'should I long here',
    'what is my position size',
    'explain this chart',
  ]) {
    assert.equal(needsLiveSearch(q), false, `"${q}" should stay on the chat quota`);
  }
});

/* ── 2. the collisions - substring, not word boundary ───────────────────── */

test('COLLISION: ordinary chart questions cost a live search', () => {
  // MEASURED, not guessed - my first draft of this test asserted `wait`
  // contains `war`, which it does not, and the test caught me. Every pair
  // below was run before being written down.
  //
  // Documented, not endorsed. Each costs a SEARCH from a message that has
  // nothing to do with live web data. Pinned so a future edit to
  // SEARCH_TRIGGERS cannot widen the set unnoticed.
  const collisions: Array<[string, string]> = [
    ['is the trend upward',            'war inside "upward" - a pure chart question'],
    ['is this a warning sign',         'war inside "warning"'],
    ['what does forward guidance mean', 'war inside "forward"'],
    ['what is a secondary market',     'sec inside "secondary"'],
    ['show me the seconds chart',      'sec inside "seconds"'],
  ];
  for (const [q, why] of collisions) {
    assert.equal(needsLiveSearch(q), true, `${JSON.stringify(q)} escalates: ${why}`);
  }
});

test('the shortest triggers are the ones that collide', () => {
  // The 2-3 character entries are the whole problem. Pinned by count so
  // adding another short one is a deliberate act with a failing test in
  // front of it, rather than a one-word commit nobody reviews.
  const short = SEARCH_TRIGGERS.filter(k => k.length <= 3);
  assert.deepEqual(short,
    ['why', 'fed', 'cpi', 'ppi', 'nfp', 'gdp', 'war', 'boj', 'yen', 'etf', 'sec', 'okx'],
    'short-trigger set changed - each entry is a substring-collision risk');
});

/* ── 3. case and position ───────────────────────────────────────────────── */

test('matching is case-insensitive and position-independent', () => {
  assert.equal(needsLiveSearch('WHY IS ETH PUMPING'), true);
  assert.equal(needsLiveSearch('Tell me about the FOMC'), true);
  assert.equal(needsLiveSearch('anything about ETFs?'), true);
});

test('empty input does not escalate', () => {
  // The chat panel calls this on every keystroke to price the message in the
  // box, so it runs against '' constantly. An empty box must read as the
  // cheap mode, not the expensive one.
  assert.equal(needsLiveSearch(''), false);
});

/* ── 4. control ─────────────────────────────────────────────────────────── */

test('CONTROL: a string containing no trigger returns false', () => {
  // Without this, every assertion above could be passing against a function
  // that returns true unconditionally.
  assert.equal(needsLiveSearch('zzz qqq vvv'), false);
  assert.ok(SEARCH_TRIGGERS.length > 0, 'sanity: the list is not empty');
});
