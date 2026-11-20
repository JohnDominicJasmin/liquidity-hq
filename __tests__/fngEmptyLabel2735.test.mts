/* QA: PR #2735 (off-site failing-text sweep leftover, PM 2026-11-20): the Fear & Greed browser notification body leaves NO stray "()" when the label is empty.
 *
 * THE WRITTEN RULE (PR body + PM): the label text is "Fear & Greed: {fng} ({label}) - {suffix}" (in every locale the label sits inside parentheses). The Arena passes the rendered body through
 * `.replace(/\s*[(（]\s*[)）]/g, '')`, so an empty label drops its parentheses with them: no "()", no double space; a label that is present is untouched. No new label.
 *   F1  the call site: the ONLY use of ARENA_NOTIF_FNG_BODY in the Arena page is wrapped in that replace (the regex is read out of the source as written)
 *   F2  empty label -> exactly "Fear & Greed: 12 - S" (single spaces, no parentheses); a whitespace-only label too; ASCII and full-width parentheses, also mixed
 *   F3  a label that is present is unchanged, including one that itself carries parentheses
 *   F4  every locale's seeded template with an empty label comes out with no empty parentheses, and the raw template DOES carry them (control: the replace is what removes them)
 * WHAT THIS CANNOT PROVE: the notification actually shown by the browser (needs a permission prompt); it proves the string handed to it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('app/(main)/arena/page.tsx');
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/* the regex literal exactly as the call site wrote it: from the replace that closes the t('ARENA_NOTIF_FNG_BODY', {...}) call */
function siteRegex(): RegExp {
  const sites = page.split("t('ARENA_NOTIF_FNG_BODY'").length - 1;
  assert.equal(sites, 1, `ARENA_NOTIF_FNG_BODY is used ${sites} times in the Arena page, expected exactly 1`);
  const at = page.indexOf("t('ARENA_NOTIF_FNG_BODY'");
  const m = /\}\)\.replace\((\/(?:[^/\n\\]|\\.)+\/[a-z]*), ''\)/.exec(page.slice(at, at + 700));
  assert.ok(m, 'the Fear & Greed body is not wrapped in `.replace(<regex>, \'\')`: an empty label leaves "()"');
  const lit = m![1], last = lit.lastIndexOf('/');
  return new RegExp(lit.slice(1, last), lit.slice(last + 1));
}
const clean = (s: string) => s.replace(siteRegex(), '');

test('F1. the only Fear & Greed body in the Arena page goes through the empty-parentheses replace', () => {
  const re = siteRegex(); assert.ok(re.global, 'the replace must be global');
  assert.equal('A () B'.replace(re, ''), 'A B', 'CONTROL: the extracted regex must remove "()" and its leading space');
});

test('F2. an empty or blank label leaves no parentheses and no double space', () => {
  const tpl = 'Fear & Greed: {fng} ({label}) - {suffix}';
  assert.equal(clean(fill(tpl, { fng: 12, label: '', suffix: 'S' })), 'Fear & Greed: 12 - S');
  assert.equal(clean(fill(tpl, { fng: 12, label: '   ', suffix: 'S' })), 'Fear & Greed: 12 - S', 'a whitespace-only label');
  assert.equal(clean('Fear & Greed: 12 （） - S'), 'Fear & Greed: 12 - S', 'full-width parentheses');
  assert.equal(clean('Fear & Greed: 12 (） - S'), 'Fear & Greed: 12 - S', 'mixed parentheses');
  assert.equal(clean('Fear & Greed: 12 (　) - S'), 'Fear & Greed: 12 - S', 'an ideographic space inside');
  const out = clean(fill(tpl, { fng: 12, label: '', suffix: 'S' })); assert.doesNotMatch(out, /\(\s*\)|\s{2,}/);
});

test('F3. a label that is present is untouched', () => {
  const tpl = 'Fear & Greed: {fng} ({label}) - {suffix}';
  assert.equal(clean(fill(tpl, { fng: 12, label: 'Extreme Fear', suffix: 'S' })), 'Fear & Greed: 12 (Extreme Fear) - S');
  assert.equal(clean(fill(tpl, { fng: 88, label: 'Extreme Greed', suffix: 'S' })), 'Fear & Greed: 88 (Extreme Greed) - S');
  assert.equal(clean(fill(tpl, { fng: 12, label: 'Fear (extreme)', suffix: 'S' })), 'Fear & Greed: 12 (Fear (extreme)) - S', 'a label with its own parentheses');
  assert.equal(clean('Fear & Greed: 12 - S'), 'Fear & Greed: 12 - S', 'a body with no parentheses at all');
});

test('F4. every seeded locale: the raw template carries the parentheses and the cleaned empty-label body has none', () => {
  const rows = [...[read('lib/labelDefaults.en.json').match(/"ARENA_NOTIF_FNG_BODY":\s*"([^"]+)"/)![1]].map((tpl) => ['en', tpl]),
    ...[...read('supabase/migrations/20260731a_labels_seed_translation_ko.sql').matchAll(/\('ARENA_NOTIF_FNG_BODY','(\w+)','([^']+)'\)/g)].map((m) => [m[1], m[2]])];
  assert.ok(rows.length >= 2, 'CONTROL: expected the en default and at least one seeded locale');
  for (const [loc, tpl] of rows) {
    const empty = fill(tpl, { fng: 12, label: '', suffix: 'S' });
    assert.match(empty, /[(（]\s*[)）]/, `${loc}: CONTROL, the raw template with an empty label must carry empty parentheses, else the replace proves nothing`);
    assert.doesNotMatch(clean(empty), /[(（]\s*[)）]/, `${loc}: empty parentheses survive the replace: ${clean(empty)}`);
    assert.doesNotMatch(clean(empty), /\s{2,}/, `${loc}: a double space survives: ${clean(empty)}`);
  }
});
