import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

/* #2655 held migration 20261124b: the Arena alert bodies and one distribution warning STATE WHAT THE DATA SHOWS; they no longer tell the reader what to watch for or what is likely next (PM, 2026-11-19: "facts, never advice"). Written rule: 9 keys x en/ko/zh/ru/ar; en equals the shipped default; {rsi} and {pattern} intact; ko/zh/ru/ar each in their own script; nothing advises or forecasts.
 *   M1 PROD and DEV blocks identical, exactly the 9 keys x 5 locales, once each, upserts, only the two label tables, held header
 *   M2 en rows equal the shipped defaults, every key is registered, and this file is the newest row for each (key, locale)
 *   M3 placeholders: {rsi} in the two RSI keys, {pattern} in the two pattern keys, none elsewhere, in all five locales
 *   M4 each locale is in its own script (only RSI / CVD / OI / placeholders may be Latin)
 *   M5 the English defaults carry no advice or forecast vocabulary (watch for, avoid chasing, likely, expect, reversal, pullback, smart money, should)
 *   M6 the browser suite's proxy label fixture carries the same English as the new defaults (it served the old advice wording) */
const root = new URL('../', import.meta.url);
const dir = new URL('supabase/migrations/', root);
const FILE = '20261124b_labels_arena_alerts_facts.sql';
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const sql = readFileSync(new URL(FILE, dir), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const KEYS = ['ARENA_NOTIF_CVD_BODY_BULL', 'ARENA_NOTIF_CVD_BODY_BEAR', 'ARENA_NOTIF_RSI_OB_BODY', 'ARENA_NOTIF_RSI_OS_BODY', 'ARENA_NOTIF_PATTERN_BULL_BODY', 'ARENA_NOTIF_PATTERN_BEAR_BODY', 'ARENA_NOTIF_OI_UP_BODY', 'ARENA_NOTIF_OI_DOWN_BODY', 'ARENA_DIST_WARN_EARLY_WEAKNESS'];
const LOCS = ['en', 'ko', 'zh', 'ru', 'ar'];
type Row = { key: string; locale: string; value: string };
function block(table: string): Row[] {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(m![1].trim().split('\n').length, rows.length, `${table}: a row line did not parse`);
  return rows;
}
const prod = block('lhq_labels'), dev = block('lhq_dev_labels');
const val = (k: string, l: string) => prod.find((r) => r.key === k && r.locale === l)?.value ?? '';
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('M1. PROD = DEV, exactly 9 keys x 5 locales once each, only the label tables, held', () => {
  assert.deepEqual(prod, dev); assert.equal(prod.length, 45, `${prod.length} rows`);
  for (const k of KEYS) for (const l of LOCS) assert.equal(prod.filter((r) => r.key === k && r.locale === l).length, 1, `${k}/${l}`);
  assert.deepEqual([...new Set(prod.map((r) => r.key))].sort(), [...KEYS].sort());
  assert.ok(/NOT YET APPLIED TO ANY DATABASE/.test(sql), 'the held header is missing');
  assert.equal(/\b(delete|drop|alter|truncate)\b/i.test(sql.replace(/^--.*$/gm, '')), false, 'the migration does more than upsert labels'); assert.equal((sql.match(/\binsert into (\w+)/g) ?? []).sort().join('|'), 'insert into lhq_dev_labels|insert into lhq_labels');
});
test('M2. en equals the shipped default, every key is registered, and this file is the newest row', () => {
  const reg = new Set<string>(LABEL_KEYS as readonly string[]);
  for (const k of KEYS) { assert.ok(reg.has(k), `${k} is not registered`); assert.equal(val(k, 'en'), defaults[k], `${k}: the stored en differs from the shipped default`); }
  const later = readdirSync(dir).filter((f) => /_labels_.*\.sql$/.test(f) && f > FILE).sort();
  for (const f of later) { const t = readFileSync(new URL(f, dir), 'utf8'); for (const k of KEYS) assert.equal(new RegExp(`\\('${k}','[a-z]{2}'`).test(t), false, `${f} rewrites ${k} after this migration`); }
});
test('M3. placeholders intact in all five locales, and none invented', () => {
  const want: Record<string, string> = { ARENA_NOTIF_RSI_OB_BODY: 'rsi', ARENA_NOTIF_RSI_OS_BODY: 'rsi', ARENA_NOTIF_PATTERN_BULL_BODY: 'pattern', ARENA_NOTIF_PATTERN_BEAR_BODY: 'pattern' };
  for (const k of KEYS) for (const l of LOCS) assert.equal(ph(val(k, l)), want[k] ?? '', `${k}/${l}: placeholders [${ph(val(k, l))}] (the English carries [${want[k] ?? ''}])`);
});
test('M4. each locale is in its own script', () => {
  const S: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]{2,}/, ar: /[؀-ۿ]{2,}/ };
  for (const k of KEYS) for (const l of ['ko', 'zh', 'ru', 'ar']) {
    const v = val(k, l); assert.ok(S[l].test(v), `${k}/${l}: not in its script: ${v}`);
    const latin = (v.replace(/\{\w+\}/g, '').match(/[A-Za-z]+/g) ?? []).filter((w) => !['RSI', 'CVD', 'OI'].includes(w)); assert.deepEqual(latin, [], `${k}/${l}: Latin words besides RSI/CVD/OI: ${latin.join(' ')}`);
  }
});
test('M5. no advice or forecast vocabulary in the English defaults', () => {
  const bad = /watch for|avoid|chas(e|ing)|likely|expect|reversal|pullback|smart money|should|reduce size|wait for|consider|be careful|bounce|squeeze coming/i;
  for (const k of KEYS) assert.equal(bad.test(defaults[k]), false, `${k}: "${defaults[k]}" advises or forecasts`);
  for (const k of KEYS) assert.ok(defaults[k].split(/\s+/).length <= 10, `${k}: more than 10 words`);
});
test('M6. the proxy label fixture the browser suite serves carries the new English', () => {
  const fx = read('qa/fixtures/proxy/labels.json'); const stale: string[] = [];
  for (const k of KEYS) { const m = new RegExp(`"${k}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(fx); if (m && JSON.parse(`"${m[1]}"`) !== defaults[k]) stale.push(`${k}: "${JSON.parse(`"${m[1]}"`)}"`); }
  assert.deepEqual(stale, [], 'the fixture still serves the old wording for these keys');
});
