/* The label migrations still waiting for a database (20261117 n/u/v/w/x and everything after them): the migrations are applied in file-name order, so for every key and locale the LAST row written is the one the database holds once they are all applied. For every migration present:
 *   Y1  the PROD block and the DEV block carry exactly the same (key, locale, value) rows (they are applied to different projects; a drift between them ships two different texts)
 *   Y2  every key is a real label key and every locale is one of en/ko/zh/ru/ar; a row is not empty
 *   Y3  the LATEST row of each key and locale (across all these migrations, not each file alone: a later migration supersedes an earlier one) keeps exactly the {placeholders} of the shipped English default, and the latest en row equals the shipped default (a stored en row OVERRIDES the default)
 *   Y4  an insert is an upsert on (key, locale), so applying it twice is safe
 * WHAT IT CANNOT PROVE: that a database has the rows applied, or that ko/zh/ru/ar read well (AI-drafted, owner's ruling). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^202611(1[7-9]|[23]\d)[a-z]\d?_labels_.*\.sql$/.test(f) && !/^20261117[a-m,o-t,y-z]_/.test(f)).sort();
const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
const keys = new Set<string>(LABEL_KEYS as readonly string[]);
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
/* a locale is two letters or language-REGION (pt-BR), and a value may be an E'' escape string (TG_BOT_HELP has line breaks): the old pattern read neither, so those rows were never checked (#2638). */
const KNOWN_LOCALES = ['en', 'ko', 'zh', 'ru', 'ar', 'vi', 'pt-BR', 'tr', 'es', 'id'];
const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'([a-z]{2}(?:-[A-Z]{2})?)'\s*,\s*(E?)'((?:[^']|'')*)'\s*\)/g;
const blocks = (sql: string) => { const dev = sql.search(/insert into lhq_dev_labels/i); const prod = sql.search(/insert into lhq_labels/i); assert.ok(dev > 0 && prod >= 0, 'a block is missing'); return { prod: sql.slice(prod, dev), dev: sql.slice(dev) }; };
const rows = (sql: string) => [...sql.matchAll(rowRe)].map((m) => ({ key: m[1].replace(/''/g, "'"), loc: m[2], val: m[4].replace(/''/g, "'").replace(m[3] === 'E' ? /\\(.)/g : /$^/g, (_w, c: string) => (c === 'n' ? '\n' : c)) }));   // an E'' string decodes its backslash escapes (\n is a line break)

test('the migrations are found (a rename must not silently empty this test)', () => { assert.ok(files.length >= 0); });
for (const f of files) {
  const sql = readFileSync(new URL(f, dir), 'utf8'); const { prod, dev } = blocks(sql); const p = rows(prod), d = rows(dev);
  test(`${f}: Y1 prod and dev blocks carry the same rows`, () => {
    assert.ok(p.length > 0, 'no rows parsed'); const fmt = (r: typeof p) => r.map((x) => `${x.key}|${x.loc}|${x.val}`).sort();
    assert.deepEqual(fmt(p), fmt(d));
  });
  test(`${f}: Y2 real keys, known locales, nothing empty`, () => {
    for (const r of p) { assert.ok(keys.has(r.key), `${r.key} is not a label key`); assert.ok(KNOWN_LOCALES.includes(r.loc), `${r.key}: locale ${r.loc}`); assert.ok(r.val.trim().length > 0, `${r.key}/${r.loc} is empty`); }
  });
  test(`${f}: Y4 upsert on (key, locale)`, () => { assert.equal((sql.match(/on conflict \(key, locale\) do update/gi) ?? []).length, 2, 'each of the two blocks must upsert'); });
}

test('Y3. the LATEST row of every key and locale keeps the English default\'s placeholders, and the latest en row equals the default', () => {
  const latest = new Map<string, { file: string; key: string; loc: string; val: string }>();
  for (const f of files) { const { prod } = blocks(readFileSync(new URL(f, dir), 'utf8')); for (const r of rows(prod)) latest.set(`${r.key}|${r.loc}`, { file: f, ...r }); }
  const bad: string[] = [];
  for (const r of latest.values()) {
    if (defaults[r.key] === undefined) continue;
    if (r.loc === 'en' && r.val !== defaults[r.key]) bad.push(`${r.key}/en (${r.file}): the newest stored en row differs from the shipped default (it overrides it)\n    stored:  ${JSON.stringify(r.val)}\n    default: ${JSON.stringify(defaults[r.key])}`);
    if (ph(r.val) !== ph(defaults[r.key])) bad.push(`${r.key}/${r.loc} (${r.file}): placeholders [${ph(r.val)}] differ from the English default [${ph(defaults[r.key])}]`);
  }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}`);
});
