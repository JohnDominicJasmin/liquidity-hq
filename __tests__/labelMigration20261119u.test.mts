/* QA: migration 20261119u (labels for the daily summary and the test-alert button), read from the file.
 *   U1 the PROD block (lhq_labels) and the DEV block (lhq_dev_labels) are the same rows, row for row
 *   U2 seven keys x 5 locales (en ko zh ru ar), no duplicate (key, locale), each key present in every locale
 *   U3 the en value of every key equals lib/labelDefaults.en.json (what ships) and every key is in lib/labelKeys.ts
 *   U4 placeholders ({time}, {zone}) are the same set in every locale of a key, and the same as the English one
 *   U5 the statement ends in the same on-conflict upsert the other label migrations use, and only touches lhq_labels / lhq_dev_labels */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('../supabase/migrations/20261119u_labels_daily_summary.sql');
const defaults = JSON.parse(read('../lib/labelDefaults.en.json')) as Record<string, string>;
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];
const KEYS = ['ALERTS_DAILY_SUMMARY_DESC', 'ALERTS_DAILY_SUMMARY_HOUR_LABEL', 'ALERTS_DAILY_SUMMARY_TZ_NOTE', 'ALERTS_SEND_TEST_ALERT_BUTTON', 'ALERTS_TEST_ALERT_SENT', 'ALERTS_TEST_ALERT_FAILED', 'ALERTS_TEST_ALERT_LIMIT'];

function block(table: string) {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]+)','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(m![1].trim().split('\n').length, rows.length, `${table}: a row line did not parse (unquoted apostrophe?)`);
  return rows;
}
const prod = block('lhq_labels'); const dev = block('lhq_dev_labels');
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('U1. the PROD block and the DEV block are the same rows in the same order', () => { assert.deepEqual(prod, dev); assert.equal(prod.length, 35); });
test('U2. seven keys x five locales, no duplicates, nothing else', () => {
  assert.deepEqual([...new Set(prod.map((r) => r.key))].sort(), [...KEYS].sort());
  const seen = new Set<string>(); for (const r of prod) { const id = `${r.key}/${r.locale}`; assert.ok(!seen.has(id), `duplicate ${id}`); seen.add(id); }
  for (const k of KEYS) for (const l of LOCALES) assert.ok(seen.has(`${k}/${l}`), `missing ${k}/${l}`);
  for (const r of prod) assert.ok(r.value.trim().length > 0, `empty value ${r.key}/${r.locale}`);
});
test('U3. en equals lib/labelDefaults.en.json and every key is in LABEL_KEYS', () => {
  for (const r of prod.filter((x) => x.locale === 'en')) { assert.equal(r.value, defaults[r.key], `${r.key}: en differs from the shipped default`); assert.ok((LABEL_KEYS as readonly string[]).includes(r.key), `${r.key} not in labelKeys.ts`); }
});
test('U4. placeholders match the English value in every locale', () => {
  for (const k of KEYS) { const en = prod.find((r) => r.key === k && r.locale === 'en')!.value; for (const l of LOCALES) assert.equal(ph(prod.find((r) => r.key === k && r.locale === l)!.value), ph(en), `${k}/${l}: placeholders ${ph(prod.find((r) => r.key === k && r.locale === l)!.value)} vs en ${ph(en)}`); }
  assert.equal(ph(defaults.ALERTS_DAILY_SUMMARY_DESC), 'time'); assert.equal(ph(defaults.ALERTS_DAILY_SUMMARY_TZ_NOTE), 'zone');
});
test('U5. only lhq_labels / lhq_dev_labels are written, and nothing is deleted or altered', () => {
  const code = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.deepEqual([...code.matchAll(/\b(insert into|update|delete from|alter table|drop|truncate|grant)\s+(\w+)/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`).filter((s) => s !== 'update set'), ['insert into lhq_labels', 'insert into lhq_dev_labels']);
});
