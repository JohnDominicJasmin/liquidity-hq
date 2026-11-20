/* #2443: news keywords match WORDS, not substrings (N1, N2), and the Telegram news alert escapes the headline and source (N3).
 *   W1-W5  lib/classify, REAL code with the headlines from the PR: the false positives that were Breaking / Macro / geo-tagged are not, the real ones still are
 *   W6     hasKeyword's rule: a keyword of 4 letters or fewer must be a whole word (plural s allowed); a longer one must START a word
 *   G1     the geo filter: "plan", "place", "daily" no longer pass; "PLA navy" and "Taiwan" still do; the three call sites use the word matcher
 *   T1     the Telegram alert wraps the headline and source in escapeHtml (and escapeHtml escapes & < >)
 * Both directions are asserted: a fix that stops matching real news would pass the false-positive cells alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyNews, hasKeyword, hasAnyKeyword, GEO_KEYWORDS } from '../lib/classify.ts';

test('W1. THE DEFECT: substrings no longer make a headline Breaking (bank, Urban, award, software, second, security, federal, crisis, lawsuit, hackathon, whether, solution)', () => {
  for (const h of ['Bank of England holds rates', 'Urban planning award for new software', 'Second quarter security review of the sector', 'Federal court ruling on second term', 'Hackathon winners announced', 'Whether the method is solid', 'A solution toward the flaw in the lawsuit', 'Bombshell interview about the crisis']) {
    assert.notEqual(classifyNews(h), 'red', `"${h}" is Breaking again (2 h on the ticker, a desktop notification and a Telegram Breaking Alert)`);
  }
});
test('W2. the real thing is still Breaking: hacked / hackers / hacking, bans / banned / banning, sanctions, a crash, an exchange hack', () => {
  for (const h of ['Hackers hacked an exchange', 'Exchange hacking spree continues', 'US bans crypto mixers', 'Regulator banned the token', 'New sanctions announced', 'Market crash wipes out billions', 'Emergency halt after hack']) assert.equal(classifyNews(h), 'red', `"${h}" is no longer Breaking`);
});
test('W3. "Bank of England holds rates" is not RED; a rate story is still classified by its own words, not lost', () => {
  assert.notEqual(classifyNews('Bank of England holds rates'), 'red');
  assert.equal(classifyNews('Council approves plan for stadium'), null);
});
test('W4. case does not matter, and a keyword at the start or end of the text matches', () => {
  assert.equal(classifyNews('HACK drains the vault'), 'red'); assert.equal(classifyNews('Exchange suffers hack'), 'red'); assert.equal(classifyNews('exchange HACKED'), 'red');
});
test('W5. a headline with no news keyword at all is unclassified', () => assert.equal(classifyNews('Daily recap of the weekend'), null));

test('W6. hasKeyword: <=4 letters = a whole word (plural s allowed); longer = the START of a word', () => {
  assert.equal(hasKeyword('Urban living', 'ban'), false); assert.equal(hasKeyword('Bank holds', 'ban'), false);
  assert.equal(hasKeyword('A ban on mixers', 'ban'), true); assert.equal(hasKeyword('Several bans announced', 'ban'), true, 'a plural s must be allowed');
  assert.equal(hasKeyword('The war began', 'war'), true); assert.equal(hasKeyword('An award for software', 'war'), false);
  assert.equal(hasKeyword('Hacked exchange', 'hack'), false, 'CONTROL: hack is 4 letters, so "hacked" is NOT a whole-word match: the explicit hacked/hacker/hacking entries are what keep it Breaking');
  assert.equal(hasKeyword('The sanctions list', 'sanction'), true); assert.equal(hasKeyword('Anti-sanctioning talk', 'sanction'), true);
  assert.equal(hasKeyword('Unsanctioned trade', 'sanction'), false, 'a longer keyword must START a word, not sit inside one');
  assert.equal(hasAnyKeyword('Council plan', ['pla navy', 'pla army']), false);
});

const geo = (h: string) => GEO_KEYWORDS.find((g) => hasAnyKeyword(h, g.kw))?.tag ?? null;
test('G1. the geo filter: plan / place / platform / play / daily do not pass; "PLA navy" and Taiwan do; a Fed speaker still tags FED SPEECH', () => {
  for (const h of ['Council approves plan for stadium', 'A new place to play on the platform', 'Daily recap']) assert.equal(geo(h), null, `"${h}" got a geo tag`);
  assert.match(String(geo('China PLA navy drills near Taiwan')), /TAIWAN/i); assert.match(String(geo('Taiwan holds exercises')), /TAIWAN/i);
  assert.equal(geo('Fed governor Waller speaks today'), 'FED SPEECH'); assert.equal(geo('Daly says rates stay'), 'FED SPEECH', 'the Fed official Daly must still match as a whole word');
});

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('G2. the three geo call sites use the word matcher (no kw.some(...includes) left), so the filter, the store and the page agree', () => {
  assert.ok(read('app/api/news/ingest/route.ts').includes('GEO_KEYWORDS.some(g => hasAnyKeyword(text, g.kw))'), 'the ingest filter is back to substring matching');
  assert.ok(read('components/NewsProvider.tsx').includes('GEO_KEYWORDS.find(group => hasAnyKeyword(hay, group.kw))'), 'NewsProvider tags by substring again');
  assert.ok(read('app/(main)/news/page.tsx').includes('if (hasAnyKeyword(h, g.kw)) return { tag: g.tag, note: g.note };'), 'the news page tags by substring again');
});

test('T1. the Telegram news alert escapes the headline and the source; escapeHtml covers & < >', () => {
  const s = read('app/api/telegram/alert/route.ts');
  /* RE-PINNED 2026-11-20 for #2734: the PR wraps both in String() and leaves the Source line out when the item has none (the old pin was the unguarded text that THREW on a missing source); the assertion is still that both are escaped. */
  assert.ok(s.includes('<b>${escapeHtml(String(item.headline))}</b>') && s.includes('Source: ${escapeHtml(String(item.source))}'), 'the headline or source goes into the HTML message raw: a "<" makes Telegram reject it and the alert is lost');
  assert.ok(s.includes("s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')"), 'escapeHtml no longer escapes & < >');
});
