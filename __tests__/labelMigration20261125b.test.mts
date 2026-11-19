/* QA: migration 20261125b (the Russian trial banner, two shorter rows), read from the file. PR #2662, #1185.
 * THE WRITTEN RULE (the PR body): TRIAL_BANNER_LABEL ru "Пробный период Pro" -> "Пробный Pro"; TRIAL_BANNER_DAYS_LEFT ru "осталось {days} дн." -> "ещё {days} дн." ({days} intact); the English defaults do not change; no code change.
 *   R1  PROD block (lhq_labels) and DEV block (lhq_dev_labels) are the same two rows, row for row
 *   R2  the rows are EXACTLY the two the PR names, Russian only (no en row: a stored en row would override the shipped default; no other locale is touched)
 *   R3  {days} is intact in the countdown, and the label carries no placeholder
 *   R4  each Russian value is in the right script (Cyrillic words; only the product name "Pro" is Latin) and is strictly SHORTER than the row it supersedes (that is the whole point of the change)
 *   R5  this file is the NEWEST row for each key in ru: no later migration rewrites them, and the superseded rows are the ones in 20260803g
 *   R6  the English defaults are unchanged and both keys are registered in lib/labelKeys.ts
 *   R7  only lhq_labels / lhq_dev_labels are written; nothing deleted or altered; the held header is present (so the generic held-migration guard reads this file)
 * WHAT THIS CANNOT PROVE: that the banner is two lines at 360 and 390 px (a browser measurement, run on GitHub CI), or that the Russian reads well (AI-drafted, not native-reviewed). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const dir = new URL('../supabase/migrations/', import.meta.url);
const FILE = '20261125b_labels_ru_trial_banner_short.sql';
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
const sql = read(FILE);
const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

function block(table: string) {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]{2}(?:-[A-Z]{2})?)','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(m![1].trim().split('\n').length, rows.length, `${table}: a row line did not parse`);
  return rows;
}
const prod = block('lhq_labels'); const dev = block('lhq_dev_labels');
const val = (rows: typeof prod, key: string) => rows.find((r) => r.key === key && r.locale === 'ru')?.value;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

test('R1. the PROD block and the DEV block are the same two rows in the same order', () => {
  assert.deepEqual(prod, dev);
  assert.equal(prod.length, 2);
});
test('R2. exactly the two rows the PR names, Russian only', () => {
  assert.deepEqual(prod, [
    { key: 'TRIAL_BANNER_LABEL', locale: 'ru', value: 'Пробный Pro' },
    { key: 'TRIAL_BANNER_DAYS_LEFT', locale: 'ru', value: 'ещё {days} дн.' },
  ]);
});
test('R3. {days} survives in the countdown; the label has no placeholder', () => {
  assert.deepEqual(ph(val(prod, 'TRIAL_BANNER_DAYS_LEFT')!), ['days']);
  assert.deepEqual(ph(val(prod, 'TRIAL_BANNER_LABEL')!), []);
  assert.deepEqual(ph(defaults.TRIAL_BANNER_DAYS_LEFT), ['days'], 'CONTROL: the English countdown carries {days}');
});
test('R4. Cyrillic words, only "Pro" is Latin, and each value is shorter than the one it replaces', () => {
  const label = val(prod, 'TRIAL_BANNER_LABEL')!, days = val(prod, 'TRIAL_BANNER_DAYS_LEFT')!;
  for (const [k, v] of [['TRIAL_BANNER_LABEL', label], ['TRIAL_BANNER_DAYS_LEFT', days]] as const) {
    assert.match(v, /[Ѐ-ӿ]{2,}/, `${k}: no Cyrillic word`);
    const latin = (v.replace(/\{days\}/g, '').match(/[A-Za-z]+/g) ?? []).filter((w) => w !== 'Pro');
    assert.deepEqual(latin, [], `${k}: Latin text other than the product name`);
  }
  /* the superseded rows come from the file that seeded them: the PR's "was" values are checked against the repo, not taken on trust */
  const old = read('20260803g_labels_i18n_trial_banner_telegram.sql');
  const oldRow = (k: string) => new RegExp(`\\('${k}','ru','([^']*)'\\)`).exec(old)?.[1];
  assert.equal(oldRow('TRIAL_BANNER_LABEL'), 'Пробный период Pro', 'CONTROL: the PR describes the wrong "was" value for the label');
  assert.equal(oldRow('TRIAL_BANNER_DAYS_LEFT'), 'осталось {days} дн.', 'CONTROL: the PR describes the wrong "was" value for the countdown');
  assert.ok(label.length < oldRow('TRIAL_BANNER_LABEL')!.length, 'the label is not shorter than before');
  assert.ok(days.length < oldRow('TRIAL_BANNER_DAYS_LEFT')!.length, 'the countdown is not shorter than before');
});
test('R5. no migration after this one rewrites these two ru rows, and this one is the newest of those that do', () => {
  const files = readdirSync(dir).filter((f) => /_labels_.*\.sql$/.test(f)).sort();
  assert.ok(files.includes(FILE), 'CONTROL: the migration is not in the directory listing');
  const touching = files.filter((f) => /\('TRIAL_BANNER_(LABEL|DAYS_LEFT)','ru',/.test(read(f).split('\n').filter((l) => !l.startsWith('--')).join('\n')));
  assert.equal(touching[touching.length - 1], FILE, `a later migration ${touching[touching.length - 1]} rewrites the same ru rows`);
  assert.ok(touching.length >= 2, 'CONTROL: the earlier seed was not found, so "newest" proves nothing');
});
test('R6. the English defaults are unchanged and both keys are registered', () => {
  assert.equal(defaults.TRIAL_BANNER_LABEL, 'Pro trial');
  assert.equal(defaults.TRIAL_BANNER_DAYS_LEFT, '{days} days left');
  for (const k of ['TRIAL_BANNER_LABEL', 'TRIAL_BANNER_DAYS_LEFT']) assert.ok((LABEL_KEYS as readonly string[]).includes(k), `${k} is not in labelKeys.ts`);
});
test('R7. only the two label tables are written, nothing deleted or altered, and the file is marked held', () => {
  const code = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.deepEqual([...code.matchAll(/\b(insert into|update|delete from|alter table|drop|truncate|grant)\s+(\w+)/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`).filter((s) => s !== 'update set'), ['insert into lhq_labels', 'insert into lhq_dev_labels']);
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/);
  assert.match(sql, /qdpwhnvmhqgzijuwopso/, 'the header names the PROD project');
  assert.match(sql, /wdtjhrilakoitfcezxpx/, 'the header names the DEV project');
});
