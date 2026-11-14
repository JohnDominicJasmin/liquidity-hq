import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* QA's cells for #2323: /privacy must not imply a self-serve delete-account control (there is none): "If you ask us to delete your account", in the English default and in the migration's five locales, both projects. */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const KEY = 'PRIVACY_SECTION_DATA_RETENTION_BODY';
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const sql = read('supabase/migrations/20261114n_labels_privacy_deletion_request.sql');
const rows = (block: string) => Object.fromEntries([...block.matchAll(/\('PRIVACY_SECTION_DATA_RETENTION_BODY','([a-z]{2})','((?:[^']|'')*)'\)/g)].map(m => [m[1], m[2].replace(/''/g, "'")]));
const prod = rows(sql.slice(0, sql.indexOf('-- ============ DEV')));
const dev = rows(sql.slice(sql.indexOf('-- ============ DEV')));
const LOCALES = ['ar', 'en', 'ko', 'ru', 'zh'];

test('P1. the English default says "if you ASK us to delete", never "if you delete", and keeps the 30-day commitment and the legal-retention carve-out', () => {
  assert.match(en[KEY], /If you ask us to delete your account/); assert.doesNotMatch(en[KEY], /If you delete your account/);
  assert.match(en[KEY], /within 30 days/); assert.match(en[KEY], /required by law/);
});
test('P2. the migration has the key for en, ko, zh, ru and ar in BOTH the prod and the dev block, and the two blocks carry the same text', () => {
  assert.deepEqual(Object.keys(prod).sort(), LOCALES); assert.deepEqual(Object.keys(dev).sort(), LOCALES);
  for (const l of LOCALES) { assert.ok(prod[l].length > 60, `${l} prod row is empty or tiny`); assert.equal(prod[l], dev[l], `${l}: prod and dev differ`); }
});
test('P3. the migration English row equals the shipped English default (a stale DB row would keep the old sentence on screen)', () => {
  assert.equal(prod.en, en[KEY]);
});
test('P4. every locale keeps the 30-day figure; the five texts are different languages (no locale is a copy of English); ru has Cyrillic, ko Hangul, zh Han, ar Arabic', () => {
  assert.match(prod.ko, /30일/); assert.match(prod.zh, /30\s*天/); assert.match(prod.ru, /30 дн/); assert.match(prod.ar, /30\s*يوم/);
  for (const l of ['ko', 'zh', 'ru', 'ar']) assert.notEqual(prod[l], prod.en, l);
  assert.match(prod.ru, /[\u0400-\u04FF]{4,}/); assert.match(prod.ko, /[\uAC00-\uD7AF]{4,}/); assert.match(prod.zh, /[\u4E00-\u9FFF]{4,}/); assert.match(prod.ar, /[\u0600-\u06FF]{4,}/);
});
test('P5. the migration upserts only this key and is not destructive', () => {
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i);
  const keys = new Set([...sql.matchAll(/\('([A-Z_]+)','[a-z]{2}'/g)].map(m => m[1])); assert.deepEqual([...keys], [KEY]);
  assert.equal((sql.match(/on conflict \(key, locale\) do update/g) || []).length, 2);
});
test('P6. no other shipped default still says the user deletes the account themselves', () => {
  const hits = Object.entries(en).filter(([k, v]) => k !== KEY && /\bif you delete your account\b/i.test(v)).map(([k]) => k);
  assert.deepEqual(hits, [], `still implies a delete control: ${hits.join(', ')}`);
});
