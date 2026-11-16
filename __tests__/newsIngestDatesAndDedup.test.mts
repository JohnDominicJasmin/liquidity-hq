/* #2447: news ingest tells the truth about dates and does not merge or split stories wrongly. REAL lib/newsFeeds.parseRSS and lib/newsDedup code.
 *   D1-D4  dates: a CDATA-wrapped date parses (it used to be NaN and the item was dropped); <dc:date>, <published>, <updated> are read; an item with NO parseable date is SKIPPED (it used to be "now", so an old undated story sorted to the top as fresh)
 *   D5     RSS 2.0 <item>, RSS 1.0 <item rdf:about=...> and Atom <entry> are all read
 *   E1-E2  entities and links: &hellip; &eacute; curly quotes decode; a link with &amp; opens with both parameters
 *   K1-K3  dedup: templated headlines that differ only in a day/number are TWO stories; the same story with different punctuation (curly vs straight quotes, - vs an em dash, double spaces, a trailing ellipsis) is ONE; the key is capped at 160 characters
 *   L1-L2  links: an article id in the query (?p=123, ?id=9) is kept so a site's stories do not collapse; utm_* and other tracking are still stripped; parameter order does not matter
 *   F1     Finnhub (ingest route): no 'datetime ?? now', an article without a datetime is skipped, and its url becomes the row's link only when it is an http(s) URL (source anchors: the route runs against the database)
 * WHAT IT CANNOT PROVE: the route end to end, or the 12-hour overlap during the key transition (a story re-served with a new-form key can be stored once more; stated in the PR). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRSS } from '../lib/newsFeeds.ts';
import { headlineKey, normalizeLink, dedupKey } from '../lib/newsDedup.ts';

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const item = (title: string, extra = '') => `<item><title>${title}</title><link>https://example.test/a</link>${extra}</item>`;
const T0 = Date.parse('2026-11-16T10:00:00Z') / 1000;

test('D1. a CDATA-wrapped pubDate parses (it was NaN and the item was dropped silently)', () => {
  const r = parseRSS(rss(item('CDATA dated', '<pubDate><![CDATA[Mon, 16 Nov 2026 10:00:00 GMT]]></pubDate>')), 'S', 'crypto');
  assert.equal(r.length, 1, 'the CDATA-dated item was dropped'); assert.equal(r[0].pubDate, T0);
});
test('D2. <dc:date>, <published> and <updated> are read when there is no <pubDate>', () => {
  for (const tag of ['dc:date', 'published', 'updated']) {
    const r = parseRSS(rss(item('Dated by ' + tag, `<${tag}>2026-11-16T10:00:00Z</${tag}>`)), 'S', 'crypto');
    assert.equal(r.length, 1, `${tag}: the item was dropped`); assert.equal(r[0].pubDate, T0, `${tag}: wrong time`);
  }
});
test('D3. THE DEFECT: an item with NO date is skipped, never stamped "now" (an old undated story must not sort to the top as fresh)', () => {
  assert.equal(parseRSS(rss(item('Undated story')), 'S', 'crypto').length, 0, 'an undated item was stored with an invented date');
  assert.equal(parseRSS(rss(item('Garbage date', '<pubDate>not a date</pubDate>')), 'S', 'crypto').length, 0, 'an unparseable date was invented');
  assert.equal(parseRSS(rss(item('Empty date', '<pubDate></pubDate>')), 'S', 'crypto').length, 0);
});
test('D4. dated and undated items in one feed: only the dated one survives, with its own time', () => {
  const r = parseRSS(rss(item('Dated', '<pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>') + item('Undated')), 'S', 'crypto');
  assert.deepEqual(r.map((x) => x.title), ['Dated']); assert.equal(r[0].pubDate, T0);
});
test('D5. RSS 2.0 <item>, RSS 1.0 <item rdf:about> and Atom <entry> are all read', () => {
  const xml = `<rdf:RDF><item rdf:about="https://example.test/r1"><title>RDF story</title><link>https://example.test/r1</link><dc:date>2026-11-16T10:00:00Z</dc:date></item></rdf:RDF>`
    + `<feed><entry><title>Atom story</title><link href="https://example.test/atom1"/><updated>2026-11-16T10:00:00Z</updated></entry></feed>`
    + `<rss><channel><item><title>RSS story</title><link>https://example.test/rss1</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  assert.deepEqual(parseRSS(xml, 'S', 'crypto').map((x) => x.title).sort(), ['Atom story', 'RDF story', 'RSS story']);
});

test('E1-E2. entities decode (hellip, eacute, curly quotes) and a link with &amp; opens with BOTH parameters', () => {
  const r = parseRSS(rss(`<item><title>Caf&eacute; &ldquo;opens&rdquo;&hellip;</title><link>https://example.test/a?x=1&amp;y=2</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>`), 'S', 'crypto');
  assert.equal(r[0].title, 'Café “opens”…'); assert.equal(r[0].link, 'https://example.test/a?x=1&y=2', 'the stored link still carries &amp;: its second parameter is broken');
});

test('K1. THE DEFECT: templated headlines that differ only in the day are TWO stories (the 60-character prefix merged them and dropped the later one for 12 h)', () => {
  const mon = 'Bitcoin ETF sees $120M in net inflows as institutions add exposure again on Monday', tue = 'Bitcoin ETF sees $120M in net inflows as institutions add exposure again on Tuesday';
  assert.equal(mon.slice(0, 60).toLowerCase(), tue.slice(0, 60).toLowerCase(), 'CONTROL: the old 60-character prefix really would have merged these two');
  assert.notEqual(headlineKey(mon), headlineKey(tue), 'two distinct stories share a dedup key');
});
test('K2. ONE story with different punctuation is ONE key: curly vs straight quotes, hyphen vs em dash, double spaces, a trailing ellipsis', () => {
  const base = headlineKey('Fed holds rates - Powell says it "will wait"');
  for (const v of ['Fed holds rates — Powell says it “will wait”', 'Fed holds rates  -  Powell says it "will wait"…', 'FED HOLDS RATES - POWELL SAYS IT WILL WAIT.', 'Fed holds rates – Powell says it ‘will wait’']) assert.equal(headlineKey(v), base, `"${v}" is a different key`);
  assert.equal(base, 'fed holds rates powell says it will wait');
});
test('K3. the key is capped at 160 characters, and non-Latin headlines keep their letters (not reduced to nothing)', () => {
  assert.equal(headlineKey('a'.repeat(400)).length, 160);
  assert.ok(headlineKey('Биткоин вырос на 5% после решения ФРС').length > 10, 'a Cyrillic headline collapsed');
  assert.notEqual(headlineKey('Биткоин вырос'), headlineKey('Эфириум вырос'), 'two different non-Latin headlines share a key');
});

test('L1. an article id in the query is KEPT (?p=123, ?id=9), so a site\'s stories do not collapse to one host+path key', () => {
  assert.notEqual(normalizeLink('https://blog.example.test/?p=123'), normalizeLink('https://blog.example.test/?p=124'));
  assert.notEqual(normalizeLink('https://news.example.test/article.php?id=9'), normalizeLink('https://news.example.test/article.php?id=10'));
  assert.notEqual(dedupKey('h', 'https://blog.example.test/?p=1'), dedupKey('h', 'https://blog.example.test/?p=2'));
});
test('L2. tracking parameters are still stripped and the id parameters\' ORDER does not matter', () => {
  assert.equal(normalizeLink('https://example.test/a?utm_source=x&utm_medium=y'), normalizeLink('https://example.test/a'));
  assert.equal(normalizeLink('https://example.test/a?p=1&utm_campaign=z'), normalizeLink('https://example.test/a?p=1'));
  assert.equal(normalizeLink('https://example.test/a?id=1&story=2'), normalizeLink('https://example.test/a?story=2&id=1'));
});

const route = readFileSync(new URL('../app/api/news/ingest/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');   // block comments only: a line-comment strip would eat the rest of a line holding a regex with two slashes
test('F1. Finnhub: no "datetime ?? now", an article without a datetime is skipped (both branches), and its url is the row link only when http(s)', () => {
  assert.equal(/datetime\s*\?\?/.test(route), false, 'a missing Finnhub datetime is invented again');
  assert.equal(route.split("if (typeof a.datetime !== 'number' || !Number.isFinite(a.datetime) || a.datetime <= 0) continue;").length - 1, 2, 'one of the two Finnhub branches no longer skips an undated article');
  assert.equal(route.split("link: typeof a.url === 'string' && /^https?:\\/\\//i.test(a.url) ? a.url : null,").length - 1, 2, 'a Finnhub url is stored without the http(s) guard, or not stored (no open button)');
});
