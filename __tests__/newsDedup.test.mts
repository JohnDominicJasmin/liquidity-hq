import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupKey, normalizeLink } from '../lib/newsDedup.ts';

// The bug this file exists for: NBC published one story twice on 2026-08-03
// with a revised headline. Same source, same published_at, same URL - but the
// old first-60-characters key produced two different keys, so /news rendered
// the same story twice.
const NBC_URL = 'https://www.nbcnews.com/politics/justice-department/todd-blanche-deal-holdout-senators-rcna12345';
const HEADLINE_V1 = 'Todd Blanche reaches deal with holdout senators to scrap ‘anti-weaponization’ fund';
const HEADLINE_V2 = 'Acting AG Todd Blanche reaches deal with holdout senators to end $1.8B ‘anti-weaponization’ fund';

test('a revised headline on the same URL keeps one key', () => {
  assert.equal(dedupKey(HEADLINE_V1, NBC_URL), dedupKey(HEADLINE_V2, NBC_URL));
});

test('the old headline-prefix approach would have split them (regression guard)', () => {
  // Proves the two headlines really are distinct in the first 60 chars, so
  // this test is exercising the actual failure and not a coincidence.
  assert.notEqual(HEADLINE_V1.slice(0, 60).toLowerCase(), HEADLINE_V2.slice(0, 60).toLowerCase());
});

test('different articles keep different keys', () => {
  assert.notEqual(
    dedupKey('a', 'https://nbcnews.com/politics/one'),
    dedupKey('a', 'https://nbcnews.com/politics/two'),
  );
});

test('tracking params, fragment, scheme, www and trailing slash all collapse', () => {
  const base = 'https://www.nbcnews.com/politics/story';
  const variants = [
    'http://nbcnews.com/politics/story',
    'https://www.nbcnews.com/politics/story/',
    'https://www.nbcnews.com/politics/story?utm_source=rss&utm_medium=feed',
    'https://www.nbcnews.com/politics/story#section',
    'https://WWW.NBCNews.com/Politics/Story',
  ];
  for (const v of variants) {
    assert.equal(normalizeLink(v), normalizeLink(base), `should match base: ${v}`);
  }
});

test('a different host with the same path stays distinct', () => {
  assert.notEqual(
    normalizeLink('https://nbcnews.com/politics/story'),
    normalizeLink('https://cnn.com/politics/story'),
  );
});

test('linkless items (Finnhub) fall back to the headline prefix', () => {
  // Both Finnhub branches in the ingest route pass link: null.
  assert.equal(dedupKey(HEADLINE_V1, null), HEADLINE_V1.slice(0, 60).toLowerCase());
  assert.equal(dedupKey(HEADLINE_V1, undefined), HEADLINE_V1.slice(0, 60).toLowerCase());
  assert.equal(dedupKey(HEADLINE_V1, ''), HEADLINE_V1.slice(0, 60).toLowerCase());
});

test('a linkless item and a linked item never collide', () => {
  assert.notEqual(dedupKey(HEADLINE_V1, null), dedupKey(HEADLINE_V1, NBC_URL));
});

test('unparseable links still yield a stable key rather than throwing', () => {
  assert.equal(normalizeLink('not a url'), 'not a url');
  assert.equal(dedupKey('headline', 'not a url'), 'not a url');
});

test('whitespace-only and empty links fall through to the headline', () => {
  assert.equal(normalizeLink('   '), null);
  assert.equal(dedupKey('Some headline', '   '), 'some headline');
});

test('keys stay bounded for absurdly long URLs', () => {
  const long = 'https://example.com/' + 'a'.repeat(5000);
  assert.ok((normalizeLink(long) ?? '').length <= 300);
});
