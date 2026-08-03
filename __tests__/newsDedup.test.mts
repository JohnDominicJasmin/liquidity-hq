import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupKey, normalizeLink, headlineKey, identitiesOf } from '../lib/newsDedup.ts';

// Does the ingest route's check: two items collide if they share ANY identity.
const collide = (
  a: { h: string; l?: string | null },
  b: { h: string; l?: string | null },
) => {
  const idsA = new Set(identitiesOf(a.h, a.l));
  return identitiesOf(b.h, b.l).some(id => idsA.has(id));
};

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

// This previously asserted the OPPOSITE - that a linkless item and a linked
// item never collide - and shipped that as intended behaviour. It was the bug:
// CoinDesk arrives via RSS with a link and via Finnhub with link: null, so the
// same story landed twice under two different keys. The two keys DO still
// differ (that part was never wrong); what was wrong was concluding they are
// different stories. Identity comparison is what the route must use.
test('same story from a linked feed and a linkless feed is one story', () => {
  assert.notEqual(
    dedupKey(HEADLINE_V1, null),
    dedupKey(HEADLINE_V1, NBC_URL),
    'stored keys legitimately differ - only the identity check can see past that',
  );
  assert.ok(
    collide({ h: HEADLINE_V1, l: null }, { h: HEADLINE_V1, l: NBC_URL }),
    'but they must be recognised as the same story',
  );
});

test('the real CoinDesk/Finnhub pair collapses', () => {
  const h = 'Bitcoin slips under $63,000 despite Iran deal hopes as Coldcard losses rattle market';
  const rss = { h, l: 'https://www.coindesk.com/markets/2026/08/03/bitcoin-slips-under-usd63-000-despite-iran-deal-hopes-as-coldcard-losses-rattle-market' };
  const finnhub = { h, l: null };
  assert.ok(collide(rss, finnhub));
});

test('a revised headline on one URL still collapses', () => {
  assert.ok(collide({ h: HEADLINE_V1, l: NBC_URL }, { h: HEADLINE_V2, l: NBC_URL }));
});

test('genuinely different stories still do not collide', () => {
  assert.ok(!collide(
    { h: 'Bitcoin slips under $63,000 as markets wobble', l: 'https://coindesk.com/a' },
    { h: 'Ethereum staking hits a new high this quarter', l: 'https://coindesk.com/b' },
  ));
  // Same headline prefix but different URLs is the one ambiguous case; treat
  // it as the same story, since a shared 60-char prefix on the same feed is
  // far more likely a repost than two distinct articles.
  assert.ok(collide(
    { h: 'Bitcoin slips under $63,000 as markets wobble today', l: 'https://coindesk.com/a' },
    { h: 'Bitcoin slips under $63,000 as markets wobble today', l: 'https://coindesk.com/b' },
  ));
});

test('headlineKey is the historical 60-char prefix, so it matches old rows', () => {
  assert.equal(headlineKey(HEADLINE_V1), HEADLINE_V1.slice(0, 60).toLowerCase());
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
