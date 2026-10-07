/* /alerts copy must not name a funding alert (#1113, #1519, #1525).
 *
 * The page subtitle and the locked "Connect Telegram" card used to list "funding" among the things /alerts alerts on.
 * There is no funding alert: funding is only an input to the sentiment and squeeze alerts. PM/DevOps made the copy call
 * on #1113 under the owner's rule that copy says only what exists, and 20261001i rewrote both keys in all five locales.
 *
 * WHAT THIS GUARDS. The label table is the record, and each locale's row comes from the LATEST migration that wrote it.
 * A later migration, or a re-run of an older seed, can bring the funding word back in one locale with no test failing
 * (the Russian row did exactly that: it was live, said "фандинга", and no migration file had ever written it). So this
 * resolves, for each of the two keys and each locale, the effective row from the migration files in filename order, and
 * requires that (a) no locale is missing, (b) none of them names funding in that locale's word, (c) English equals the
 * shipped default. It reads the live (uncommented) rows only; the dev-table blocks are comments.
 *
 * NOT CHECKED: the live database. This guards the files and the English default. Whether production serves the same
 * rows needs a read of /api/labels, which QA did on qa for #1519 (en and ru) but not for ko, zh and ar. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const KEYS = ['ALERTS_PAGE_SUBTITLE', 'ALERTS_LOCKED_FEATURE_DESC'] as const;
const LOCALES = ['en', 'ko', 'zh', 'ar', 'ru'] as const;
/* How each locale writes "funding" in the rows this PR series removed it from (read from the older seed files). */
const FUNDING_WORD: Record<(typeof LOCALES)[number], RegExp> = {
  en: /funding/i,
  ko: /펀딩/,
  zh: /资金费率/,
  ar: /التمويل/,
  ru: /фандинг/i,
};
const ROW = /^\('(ALERTS_PAGE_SUBTITLE|ALERTS_LOCKED_FEATURE_DESC)','(\w+)','(.*)'\)[,;]?\s*$/;

type Row = { file: string; key: string; locale: string; value: string };
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const rows: Row[] = [];
for (const file of files) {
  for (const line of readFileSync(new URL(file, DIR), 'utf8').split(/\r?\n/)) {
    const m = line.match(ROW);
    if (m) rows.push({ file, key: m[1], locale: m[2], value: m[3].split("''").join("'") });
  }
}
const effective = new Map<string, Row>();
for (const r of rows) effective.set(`${r.key}|${r.locale}`, r);
const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

test('A1. CONTROL: the scan finds the rows it is meant to guard, including older seeds that DID say funding', () => {
  assert.ok(files.length > 100, `CONTROL: only ${files.length} migration files were read`);
  assert.ok(rows.length >= 20, `CONTROL: only ${rows.length} rows for the two keys; the row pattern may have stopped matching`);
  const older = rows.filter((r) => r.file < '20261001i' && r.locale === 'ko');
  assert.ok(older.some((r) => FUNDING_WORD.ko.test(r.value)), 'CONTROL: no older Korean row names funding, so the ko pattern is unproven');
  assert.ok(rows.some((r) => r.file < '20261001i' && r.locale === 'ru' && FUNDING_WORD.ru.test(r.value)), 'CONTROL: no older Russian row names funding, so the ru pattern is unproven');
});

test('A2. every locale has an effective row for both keys, so none falls back to an older, funding-bearing seed by accident', () => {
  for (const key of KEYS) for (const locale of LOCALES) {
    assert.ok(effective.has(`${key}|${locale}`), `no migration writes ${key} for ${locale}`);
  }
});

for (const key of KEYS) {
  for (const locale of LOCALES) {
    test(`A3. ${key} (${locale}): the effective row does not name a funding alert`, () => {
      const r = effective.get(`${key}|${locale}`);
      assert.ok(r, `no row for ${key} ${locale}`);
      assert.equal(FUNDING_WORD[locale].test(r.value), false, `${r.file} sets ${key} (${locale}) to a value that names funding again: ${r.value.slice(0, 80)}`);
    });
  }
}

test('A4. the English row equals the shipped default, so the build-time fallback and the table say the same thing', () => {
  for (const key of KEYS) {
    const r = effective.get(`${key}|en`);
    assert.ok(r, `no English row for ${key}`);
    assert.equal(r.value, defaults[key], `${key}: migration ${r.file} and lib/labelDefaults.en.json differ`);
    assert.equal(FUNDING_WORD.en.test(defaults[key]), false, `the English default of ${key} names funding`);
  }
});

test('A5. what stays: the alerts that really take funding as an input still say so (this guard is for the two keys only)', () => {
  for (const key of ['ALERTS_SENTIMENT_EXTREMES_DESC', 'ALERTS_DISTRIBUTION_DESC']) {
    assert.ok(typeof defaults[key] === 'string', `CONTROL: ${key} is gone, re-read the migration header`);
  }
  assert.match(defaults.ALERTS_SENTIMENT_EXTREMES_DESC + defaults.ALERTS_DISTRIBUTION_DESC, /funding/i, 'funding was removed from the alerts that DO use it as an input: over-correction');
});
