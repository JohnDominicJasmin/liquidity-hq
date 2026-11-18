/* QA pin for the #1631 label migration 20261119z3: the PROD and DEV blocks are the same rows, each key has en/ko/zh/ru/ar, the en row equals the shipped default, the key is registered in LABEL_KEYS, and no row carries a placeholder the other locales lack.
 * Expectations are from the PR body ("3 keys x 5 locales, PROD and DEV blocks, en equals defaults"), not from running the code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261119z3_labels_ai_tracker.sql', import.meta.url), 'utf8');
const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
const keysSrc = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8');

const KEYS = ['BACKTEST_SR_NO_SAMPLE_NOTE', 'TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE', 'TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE'];
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];

function block(table: string): { key: string; locale: string; value: string }[] {
  const re = new RegExp(`insert into ${table} \\(key, locale, value\\) values([\\s\\S]*?)on conflict`);
  const m = re.exec(sql);
  assert.ok(m, `no insert block for ${table}`);
  return [...m[1].matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
}
const prod = block('lhq_labels');
const dev = block('lhq_dev_labels');

test('L1. PROD and DEV blocks are the same 15 rows', () => {
  assert.equal(prod.length, 15);
  assert.deepEqual(dev, prod);
});
test('L2. every key has exactly the five locales', () => {
  for (const k of KEYS) assert.deepEqual(prod.filter((r) => r.key === k).map((r) => r.locale).sort(), [...LOCALES].sort(), k);
});
test('L3. the en row equals lib/labelDefaults.en.json', () => {
  for (const k of KEYS) assert.equal(prod.find((r) => r.key === k && r.locale === 'en')!.value, defaults[k], k);
});
test('L4. each key is registered in LABEL_KEYS exactly once', () => {
  for (const k of KEYS) assert.equal(keysSrc.split(`'${k}'`).length - 1, 1, k);
});
test('L5. no empty value, no placeholder braces, no vendor name in any locale', () => {
  for (const r of prod) {
    assert.ok(r.value.trim().length > 0, `${r.key}/${r.locale} empty`);
    assert.ok(!/[{}]|%s|%d/.test(r.value), `${r.key}/${r.locale} has a placeholder`);
    assert.ok(!/grok|xai|x\.ai|anthropic|claude|openai|gpt/i.test(r.value), `${r.key}/${r.locale} names a vendor`);
  }
});
test('L6. en word budgets: note <= 15 words, thesis note <= 12', () => {
  const w = (s: string) => s.trim().split(/\s+/).length;
  assert.ok(w(defaults.BACKTEST_SR_NO_SAMPLE_NOTE) <= 15);
  assert.ok(w(defaults.TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE) <= 15);
  assert.ok(w(defaults.TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE) <= 12);
});
