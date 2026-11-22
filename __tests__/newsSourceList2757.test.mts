/* QA: PR #2757 (held, v2026.11.24), #1185: the /news source line stops naming Reuters and AP (their direct feeds were removed 2026-07-30) and names the feeds the code reads today.
 *
 * THE WRITTEN RULE (the PR body): "The page should not claim sources it does not read." The list uses the same ' · ' separator; the held migration writes the same value for ar / en / ko / ru / zh, once for PROD (lhq_labels) and once for DEV (lhq_dev_labels), as an upsert.
 *   N1  EVERY NAME IS A SOURCE THE CODE READS: each name in the default is an active feed in lib/newsFeeds.ts (BBC = the BBC World / Business feeds; Finnhub = its REST reader, which the news route imports), and neither Reuters nor AP is left
 *   N2  the shape: exactly 8 names, separated by ' · ' (U+00B7 with spaces), no placeholder braces
 *   N3  THE MIGRATION AGREES WITH THE DEFAULT: two blocks (PROD lhq_labels, DEV lhq_dev_labels), each with ar, en, ko, ru, zh exactly once, every value character-identical to the default, upsert on (key, locale)
 *   N4  NOTHING LATER OVERWRITES IT: no migration sorted after 20261129e sets NEWS_SOURCE_LIST, and the older seeds that name Reuters / AP are all older than it (the later row wins)
 *   N5  the line is shown through the label on both places the news page prints it
 *   N6  CONTROL: the old value is the one the PR replaced (Reuters / AP present, 17 characters shorter), so N1 can go red
 * OBSERVED, not asserted: feeds the code reads but the line does not name (Fox News Politics, NBC News, Politico): the line is a subset, which the written rule allows.
 * WHAT THIS CANNOT PROVE: the 390 px render with the longer line in ar / ko / ru / zh / en (a browser cell; QA runs it before PM applies the rows). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DEFAULTS = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>; const VALUE = DEFAULTS.NEWS_SOURCE_LIST;
const FEEDS = read('lib/newsFeeds.ts'); const MIG_NAME = '20261129e_labels_news_source_list.sql'; const MIG = read(`supabase/migrations/${MIG_NAME}`);
const OLD = 'Reuters · AP · BBC · CoinDesk · CoinTelegraph · Decrypt · The Block · Finnhub';
const NAMES = VALUE.split(' · ');
const activeFeedSources = FEEDS.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => /source:\s*'([^']+)'/.exec(l)?.[1]).filter((s): s is string => !!s);

test('N1. every named source is one the code reads; Reuters and AP are gone', () => {
  assert.ok(activeFeedSources.length >= 8, `CONTROL: only ${activeFeedSources.length} active feeds parsed`);
  for (const n of NAMES) {
    if (n === 'Finnhub') { assert.match(FEEDS, /export async function fetchFinnhubCategory\(/); continue; }
    assert.ok(activeFeedSources.some((s) => s === n || (n === 'BBC' && /^BBC /.test(s))), `"${n}" is named on /news but is not an active feed (${activeFeedSources.join(', ')})`);
  }
  assert.doesNotMatch(VALUE, /Reuters|\bAP\b/);
  const unnamed = activeFeedSources.filter((s) => !NAMES.some((n) => s === n || (n === 'BBC' && /^BBC /.test(s)))); console.log(`[N1] active feeds not named on the line: ${JSON.stringify(unnamed)}`);
});

test('N2. 8 names, the ` · ` separator, no placeholders', () => {
  assert.equal(NAMES.length, 8, VALUE); assert.ok(NAMES.every((n) => n.trim() === n && n.length > 1), 'a name has stray spaces'); assert.ok(VALUE.includes(' · ')); assert.doesNotMatch(VALUE, /[{}]/);
});

test('N3. the migration writes the default, five locales, both projects, as an upsert', () => {
  const prodAt = MIG.indexOf('insert into lhq_labels'), devAt = MIG.indexOf('insert into lhq_dev_labels'); assert.ok(prodAt > 0 && devAt > prodAt, 'the PROD and DEV blocks are missing or out of order');
  for (const [name, block] of [['PROD lhq_labels', MIG.slice(prodAt, devAt)], ['DEV lhq_dev_labels', MIG.slice(devAt)]] as const) {
    const rows = [...block.matchAll(/\('NEWS_SOURCE_LIST','([a-z]{2})','([^']*)'\)/g)]; assert.deepEqual(rows.map((r) => r[1]).sort(), ['ar', 'en', 'ko', 'ru', 'zh'], `${name}: locales`);
    for (const r of rows) assert.equal(r[2], VALUE, `${name} ${r[1]}: the value differs from the default`);
    assert.match(block, /on conflict \(key, locale\) do update set value = excluded\.value/, `${name}: not an upsert`);
  }
});

test('N4. nothing later overwrites it', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const files = readdirSync(dir).sort(); assert.ok(files.includes(MIG_NAME), 'CONTROL: the migration is not in the folder');
  const touching = files.filter((f) => /NEWS_SOURCE_LIST/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.ok(touching.length >= 2, 'CONTROL: the older seeds were not found');
  assert.equal(touching[touching.length - 1], MIG_NAME, `a later migration also sets NEWS_SOURCE_LIST: ${touching.slice(touching.indexOf(MIG_NAME) + 1).join(', ')}`);
});

test('N5. the news page prints the line through the label, twice', () => {
  const page = read('app/(main)/news/page.tsx'); const uses = page.split('\n').filter((l) => l.includes("t('NEWS_SOURCE_LIST')")); assert.equal(uses.length, 2, 'the line is printed in ' + uses.length + ' places');
  assert.ok(!/Reuters · AP/.test(page), 'a hard-coded old list is still in the page');
});

test('N6. CONTROL: the old value is what the PR replaced', () => {
  assert.match(OLD, /Reuters/); assert.ok(VALUE.length - OLD.length === 17, `the new line is ${VALUE.length - OLD.length} characters longer (the PR says 17)`);
  assert.notEqual(VALUE, OLD);
});
