/* #861 / PR #1493: the /about subtitle said "Liquidity Hunter HQ - crypto trading intelligence" after the
 * landing page and the link-preview title (#1485, "LiquidityHQ - Crypto Market Analytics") had both moved
 * to "market analytics". Owner's rule for the Polar review: describe the tool as market analytics, never
 * as trading instructions. QA's review of #1485 found this was the last place still saying otherwise.
 *
 * The fix is label-only, no code: lib/labelDefaults.en.json's ABOUT_PAGE_SUBTITLE becomes
 * "Liquidity Hunter HQ - crypto market analytics", and migration 20261001e_labels_about_market_analytics.sql
 * rewrites the same key in all five locales (`do update`, because 20260917a already inserted the old rows).
 * The ko/zh/ar/ru values are machine-translated and not checked by a native speaker - this file pins that
 * they CHANGED and that the dev block matches the prod block, not that the translations are good.
 *
 * Why the shipped default and the migration must agree EXACTLY: the label system paints the code default
 * first and the database row replaces it, so a mismatch shows as the subtitle changing a moment after load.
 *
 * Source + data structure only: the page is a client component reading t() and there is no DOM test
 * library in this repo, so A7 pins that it renders the key rather than a hard-coded string. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

const KEY = 'ABOUT_PAGE_SUBTITLE';
const NEW_EN = 'Liquidity Hunter HQ - crypto market analytics';
const LOCALES = ['en', 'ko', 'zh', 'ar', 'ru'];
const MIGRATION = 'supabase/migrations/20261001e_labels_about_market_analytics.sql';
const BEFORE_MIGRATION = 'supabase/migrations/20260917a_labels_audit001_pr_b_landing_claims.sql';

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

type Row = { key: string; locale: string; value: string };
/* One ('KEY','locale','value') tuple per line, the house format. `commented` reads the `-- (` dev block
   instead of the active SQL. SQL's '' is unescaped to ' so values compare against the JSON as shipped. */
function rows(sql: string, commented: boolean): Row[] {
  const out: Row[] = [];
  for (const raw of sql.split('\n')) {
    let line = raw.trim();
    if (commented) {
      if (!line.startsWith('-- (\'')) continue;
      line = line.slice(3);
    } else if (!line.startsWith('(\'')) continue;
    const parts = line.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length === 3) out.push({ key: parts[0], locale: parts[1], value: parts[2].split("''").join("'") });
  }
  return out;
}
const byLocale = (rs: Row[]) => Object.fromEntries(rs.filter((r) => r.key === KEY).map((r) => [r.locale, r.value]));

const migrationSql = read(MIGRATION);
const prodRows = byLocale(rows(migrationSql, false));
const devRows = byLocale(rows(migrationSql, true));
const beforeRows = byLocale(rows(read(BEFORE_MIGRATION), false));

/* ══ The shipped English default ═════════════════════════════════════════════════════════════════════ */

test('A1. the shipped English default says "crypto market analytics" and no longer "trading intelligence" - the wording the owner set for the Polar review (#861)', () => {
  assert.equal(defaults[KEY], NEW_EN);
  assert.doesNotMatch(defaults[KEY], /trading intelligence/i, 'the default still describes the product as trading intelligence');
});

test('A1b. CONTROL: 20260917a really holds the old "crypto trading intelligence" English row the new migration\'s header says it replaces - so A1\'s "no longer" is measured against the real before, not a remembered one', () => {
  assert.equal(beforeRows.en, 'Liquidity Hunter HQ - crypto trading intelligence');
  assert.notEqual(defaults[KEY], beforeRows.en);
});

test('A2. ABOUT_PAGE_SUBTITLE is a registered label key (lib/labelKeys.ts), exactly once', () => {
  anchorOnce(read('lib/labelKeys.ts'), `'${KEY}'`, 'the key in labelKeys.ts');
});

/* ══ The migration ═══════════════════════════════════════════════════════════════════════════════════ */

test('A3. the migration\'s English row equals the shipped default EXACTLY - a mismatch would paint the default, then swap to the database row a moment after load', () => {
  assert.ok(prodRows.en, `${MIGRATION} has no active English row for ${KEY}`);
  assert.equal(prodRows.en, defaults[KEY], 'migration and shipped default differ');
});

test('A4. all five locales are rewritten, each one actually differs from its 20260917a value (none carried forward unchanged), and the commented dev block is row-for-row the prod block', () => {
  assert.deepEqual(Object.keys(prodRows).sort(), [...LOCALES].sort(), 'the prod insert does not cover exactly en/ko/zh/ar/ru');
  for (const loc of LOCALES) {
    assert.ok(beforeRows[loc], `CONTROL: 20260917a has no ${loc} row to compare against - the premise moved`);
    assert.notEqual(prodRows[loc], beforeRows[loc], `the ${loc} row is unchanged from 20260917a - that locale still shows the old wording`);
    assert.doesNotMatch(prodRows[loc], /trading intelligence/i);
  }
  assert.deepEqual(devRows, prodRows, 'the lhq_dev_labels block differs from the lhq_labels block - dev/qa/staging would show different text from production');
});

test('A5. the active statement is `do update` against lhq_labels and the dev block is `do update` against lhq_dev_labels - the rows already exist (20260917a), so `do nothing` would leave every database on the old text', () => {
  const active = migrationSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  anchorOnce(active, 'insert into lhq_labels (key, locale, value) values', 'the active insert');
  anchorOnce(active, 'on conflict (key, locale) do update set value = excluded.value', 'the active conflict clause');
  assert.doesNotMatch(active, /do nothing/i);
  assert.doesNotMatch(active, /lhq_dev_labels/, 'the dev table write is active, not commented - it is a separate, gated apply');
  const devBlock = migrationSql.split('\n').filter((l) => l.trim().startsWith('-- ')).map((l) => l.trim().slice(3)).join('\n');
  anchorOnce(devBlock, 'insert into lhq_dev_labels (key, locale, value) values', 'the commented dev insert');
  anchorOnce(devBlock, 'on conflict (key, locale) do update set value = excluded.value', 'the commented dev conflict clause');
});

test('A6. 20261001e is the LAST migration writing the English subtitle, so nothing applied after it puts the old text back - with a positive control that the scan sees the earlier writers at all', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const writers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => rows(readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/).join('\n'), false).some((r) => r.key === KEY && r.locale === 'en'));
  assert.ok(writers.includes('20260723d_labels_seed_about.sql'), 'positive control: the scan did not find the original seed - the parser is blind, not the migrations');
  assert.ok(writers.includes('20260917a_labels_audit001_pr_b_landing_claims.sql'), 'positive control: the scan did not find 20260917a');
  assert.equal(writers.at(-1), '20261001e_labels_about_market_analytics.sql', `a later migration writes the English subtitle: ${writers.at(-1)}`);
});

/* ══ The page ════════════════════════════════════════════════════════════════════════════════════════ */

test('A7. the About page renders the subtitle through t(\'ABOUT_PAGE_SUBTITLE\'), not a hard-coded string - otherwise the label and the migration change nothing on screen and no locale but English could ever show', () => {
  const page = stripComments(read('app/about/page.tsx'));
  anchorOnce(page, `{t('${KEY}')}`, 'the subtitle render');
  assert.doesNotMatch(page, /Liquidity Hunter HQ/, 'the page hard-codes the product name line');
  assert.doesNotMatch(page, /market analytics|trading intelligence/i, 'the page hard-codes subtitle wording');
});
