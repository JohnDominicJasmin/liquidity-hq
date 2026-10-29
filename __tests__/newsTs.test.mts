import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTs, notableOf, MAX_AGE_SEC, MAX_FUTURE_SEC } from '@/lib/newsTs';

/* #1651 / #1737: THE FEED-TIMESTAMP GUARD, AND THE RULE FOR WHICH REJECTIONS DESERVE A LOG LINE.
 *
 * A future-dated article was accepted and pinned itself to the top of the feed, because the client sorts on
 * `published_at` descending and all three ingest loops checked only `ts < cutoff`. Measured on a production
 * article at +24.07h on 2026-10-22.
 *
 * WHY THIS FILE EXISTS: Dev exercised eleven cases by hand, once, in a PR comment. That is not coverage - the
 * next person to adjust `MAX_FUTURE_SEC` gets no signal from a message. These are those cases plus the two
 * boundaries the table implied without stating, and the control that proves the suite can fail.
 *
 * `judgeTs` is pure - no request, no DOM, no credentials - which is why it can be asserted directly. */

const NOW = 1_780_000_000;                    // a fixed clock: a test that reads Date.now() has a different bug every day
const MIN = 60;
const HOUR = 3600;

test('B1: both boundaries are INCLUSIVE, which the eleven-case table implied and did not state', () => {
  /* The comparisons are `<` and `>`, so the exact edges are `ok` on both ends. This is the assertion that
     stops a future `<=` / `>=` "tidy-up" from silently narrowing the window. */
  assert.equal(judgeTs(NOW - MAX_AGE_SEC, NOW), 'ok', 'exactly the age cutoff must be accepted');
  assert.equal(judgeTs(NOW + MAX_FUTURE_SEC, NOW), 'ok', 'exactly the future tolerance must be accepted');

  /* And one second outside each edge must flip, or "inclusive" is untested in the only direction that matters. */
  assert.equal(judgeTs(NOW - MAX_AGE_SEC - 1, NOW), 'too_old');
  assert.equal(judgeTs(NOW + MAX_FUTURE_SEC + 1, NOW), 'too_new');
});

test('B2: the eleven measured cases, including the production article and the unpurgeable variant', () => {
  const cases: Array<[label: string, ts: number, expected: string]> = [
    ['+24.07h - the article measured on production 2026-10-22', NOW + Math.round(24.07 * HOUR), 'too_new'],
    ['+365d - the sticky variant the prune can never sweep',    NOW + 365 * 24 * HOUR,          'too_new'],
    ['+16min - just outside the tolerance',                     NOW + 16 * MIN,                 'too_new'],
    ['+14min - just inside it',                                 NOW + 14 * MIN,                 'ok'],
    ['+1min - ordinary clock skew between us and a feed',       NOW + 1 * MIN,                  'ok'],
    ['now exactly',                                             NOW,                            'ok'],
    ['-1h - an ordinary recent article',                        NOW - 1 * HOUR,                 'ok'],
    ['-6h01m - past the display window',                        NOW - (6 * HOUR + MIN),         'too_old'],
  ];
  for (const [label, ts, expected] of cases) {
    assert.equal(judgeTs(ts, NOW), expected, `${label}: expected ${expected}`);
  }
});

test('B3: anything that is not a finite number is unreadable, not accepted', () => {
  /* Cast through `unknown` deliberately: these are the shapes a FEED produces, and the function's own first
     line exists to catch them. A test that only passed numbers would never reach that line. */
  const bad: unknown[] = [NaN, Infinity, -Infinity, undefined, null, 'x', '', '1780000000', {}, [], true];
  for (const v of bad) {
    assert.equal(judgeTs(v as number, NOW), 'unreadable', `${JSON.stringify(v) ?? String(v)} must be unreadable`);
  }
});

test('B4 CONTROL: the OLD predicate accepted NaN, so B3 is a behaviour change and not a restatement', () => {
  /* The code this replaced was `if (ts < cutoff) continue`. `NaN < anything` is false, so an unparseable date
     fell THROUGH the guard and was stored. Asserting the old behaviour here is what makes B3 mean something:
     without it, "NaN is unreadable" could be describing a property the code always had.
     This is also the only test here that may be deleted once nobody remembers the old predicate - and it
     should not be, because it is the proof the bug was real. */
  const cutoff = NOW - MAX_AGE_SEC;
  assert.equal(NaN < cutoff, false, 'the old predicate did not reject NaN');
  assert.notEqual(judgeTs(NaN, NOW), 'ok', 'the new guard must not accept what the old one let through');
});

test('B5: the tolerance and the age window are pinned, so changing either is a deliberate edit', () => {
  /* Both numbers carry a written justification beside them in lib/newsTs.ts. Pinning them means a change has
     to come past this test and update that reasoning, rather than being nudged. */
  assert.equal(MAX_FUTURE_SEC, 15 * 60, 'the future tolerance is 15 minutes - see the paragraph above it');
  assert.equal(MAX_AGE_SEC, 6 * 3600, 'the age window is 6h and must match the client display cutoff');
});

test('B6: notableOf drops too_old and keeps everything else, keyed on the VERDICT prefix', () => {
  const rejected = {
    'too_old:rss:CoinDesk': 24,
    'too_old:rss:Decrypt': 40,
    'too_new:rss:CoinDesk': 1,
    'unreadable:finnhub:crypto:unknown': 2,
  };
  const notable = Object.fromEntries(notableOf(rejected));
  assert.deepEqual(notable, { 'too_new:rss:CoinDesk': 1, 'unreadable:finnhub:crypto:unknown': 2 });

  /* A run of only stale items - the NORMAL state of a feed, 123 of 147 items measured on the real sources -
     must produce nothing to warn about. This is the case that made the log line fire on every run. */
  assert.deepEqual(notableOf({ 'too_old:rss:CoinTelegraph': 30 }), [], 'a feed full of old items is not notable');
  assert.deepEqual(notableOf({}), [], 'an empty run is not notable');
});

test('B7: a FEED whose name contains "too_old" is still notable - the prefix is anchored, not searched', () => {
  /* The filter is `!key.startsWith('too_old:')`, so a source name containing the string cannot suppress a real
     rejection. Contrived, and it is the difference between an anchored prefix and a substring match - which is
     the kind of thing a later "simplification" to `.includes()` would break silently. */
  const notable = notableOf({ 'too_new:rss:too_old_times': 1, 'too_old:rss:too_old_times': 5 });
  assert.deepEqual(notable, [['too_new:rss:too_old_times', 1]], 'only the too_old-VERDICT entry may be dropped');
});

test('B8: notableOf does not mutate what it is given', () => {
  /* The caller returns the full `rejected` map in the response after computing the notable subset, so a
     filter that mutated its input would quietly strip too_old from the API payload too. */
  const rejected = { 'too_old:rss:A': 1, 'too_new:rss:B': 2 };
  const before = JSON.stringify(rejected);
  notableOf(rejected);
  assert.equal(JSON.stringify(rejected), before, 'the input map was modified');
});
