/* #2568: page subtitles. /about and /journal render no subtitle; /alerts, /correlation, /funding and four Trade Journal tool tabs carry one short factual line.
 * Migration 20261119s writes the 7 keys x 5 locales and deletes the retired TRADE_JOURNAL_PAGE_SUBTITLE rows, per project block.
 * Source + data only (no DB, no DOM): what it pins is that the shipped English default, the migration rows, the key registry and the renderers agree. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPath } from './_appPath.mts';

const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').split(/\r?\n/).join('\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MIG = 'supabase/migrations/20261119s_labels_page_subtitles.sql';
const KEYS = [
  'ALERTS_PAGE_SUBTITLE', 'CORRELATION_PAGE_SUBTITLE', 'FUNDING_PAGE_SUBTITLE',
  'TRADE_JOURNAL_RULES_PAGE_SUBTITLE', 'TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE',
  'TRADE_JOURNAL_BIAS_PAGE_SUBTITLE', 'TRADE_JOURNAL_THESIS_PAGE_SUBTITLE',
];
const RETIRED = 'TRADE_JOURNAL_PAGE_SUBTITLE';
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];
const EXPECT_EN: Record<string, string> = {
  ALERTS_PAGE_SUBTITLE: 'Checked every 5 minutes.',
  CORRELATION_PAGE_SUBTITLE: 'Based on {range} returns.',
  FUNDING_PAGE_SUBTITLE: 'Red: longs paying. Green: shorts paying.',
  TRADE_JOURNAL_RULES_PAGE_SUBTITLE: 'Trades that break a rule are flagged when logged and in History.',
  TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE: 'AI reads your trade history for your implicit rules and patterns.',
  TRADE_JOURNAL_BIAS_PAGE_SUBTITLE: 'Checks your trades for four biases, with estimated P&L drag per bias.',
  TRADE_JOURNAL_THESIS_PAGE_SUBTITLE: 'AI checks whether your thesis assumptions still hold. Health score 1-10.',
};

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const sql = read(MIG);
const [prodPart, devPart] = sql.split(/^-- =+ DEV =+$/m);
const prodBlock = prodPart.split(/^-- =+ PROD =+$/m)[1];

type Row = { key: string; locale: string; value: string };
function rows(block: string): Row[] {
  const out: Row[] = [];
  for (const raw of block.split('\n')) {
    const l = raw.trim();
    if (!l.startsWith("('")) continue;
    const p = l.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (p.length === 3) out.push({ key: p[0], locale: p[1], value: p[2].split("''").join("'") });
  }
  return out;
}
const prodRows = rows(prodBlock);
const devRows = rows(devPart);

test('P1. CONTROL: the parser sees both blocks (35 rows each) and the two insert targets', () => {
  assert.equal(prodRows.length, 35);
  assert.equal(devRows.length, 35);
  assert.equal((prodBlock.match(/^insert into lhq_labels \(key, locale, value\) values$/gm) ?? []).length, 1);
  assert.equal((devPart.match(/^insert into lhq_dev_labels \(key, locale, value\) values$/gm) ?? []).length, 1);
  assert.doesNotMatch(prodBlock, /lhq_dev_labels/, 'the PROD block touches the dev table');
  assert.doesNotMatch(devPart.replace(/^--.*$/gm, ''), /\blhq_labels\b/, 'the DEV block touches the prod table');
});

test('P2. PROD and DEV blocks carry identical rows, in the same order', () => {
  assert.deepEqual(devRows, prodRows);
});

test('P3. exactly 7 keys x 5 locales, no extras, no duplicates', () => {
  const ids = prodRows.map((r) => `${r.key}/${r.locale}`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate (key, locale)');
  assert.deepEqual([...new Set(prodRows.map((r) => r.key))].sort(), [...KEYS].sort());
  for (const k of KEYS) assert.deepEqual(prodRows.filter((r) => r.key === k).map((r) => r.locale).sort(), [...LOCALES].sort(), `${k} locales`);
});

test('P4. the English row equals the shipped default, the default equals the expected text, and it is <= 12 words', () => {
  for (const k of KEYS) {
    const en = prodRows.find((r) => r.key === k && r.locale === 'en')!.value;
    assert.equal(defaults[k], en, `${k}: default != migration en`);
    assert.equal(defaults[k], EXPECT_EN[k], `${k}: default is not the reviewed text`);
    const words = en.trim().split(/\s+/).length;
    assert.ok(words <= 12, `${k}: ${words} words`);
  }
});

test('P5. every non-English row keeps the {placeholders} of the English text, has no leftover English sentence, and is not > 1.5x longer in characters/words than the English where scripts compare', () => {
  for (const k of KEYS) {
    const en = prodRows.find((r) => r.key === k && r.locale === 'en')!.value;
    const ph = (en.match(/\{[a-z]+\}/g) ?? []).sort();
    for (const r of prodRows.filter((x) => x.key === k && x.locale !== 'en')) {
      assert.deepEqual((r.value.match(/\{[a-z]+\}/g) ?? []).sort(), ph, `${k}/${r.locale}: placeholders differ`);
      assert.notEqual(r.value, en, `${k}/${r.locale}: identical to English`);
    }
    for (const loc of ['ru', 'ar']) {
      const v = prodRows.find((x) => x.key === k && x.locale === loc)!.value;
      const w = v.trim().split(/\s+/).length;
      assert.ok(w <= Math.ceil(en.trim().split(/\s+/).length * 1.5), `${k}/${loc}: ${w} words vs ${en.trim().split(/\s+/).length} in English`);
    }
  }
});

test('P6. all 7 keys are registered in lib/labelKeys.ts exactly once; the retired key is not', () => {
  const lk = read('lib/labelKeys.ts');
  for (const k of KEYS) assert.equal(lk.split(`'${k}'`).length - 1, 1, `${k} in labelKeys.ts`);
  assert.equal(lk.split(`'${RETIRED}'`).length - 1, 0, `${RETIRED} still registered`);
  assert.ok(!(RETIRED in defaults), `${RETIRED} still has an English default`);
});

test('P7. the retired key is deleted per project, in the right table, scoped by key (no bare delete)', () => {
  const del = (b: string) => [...b.matchAll(/^delete from (\w+)\b([^;]*);/gim)].map((m) => ({ table: m[1], rest: m[2].replace(/\s+/g, ' ').trim() }));
  assert.deepEqual(del(prodBlock), [{ table: 'lhq_labels', rest: `where key in ('${RETIRED}')` }]);
  assert.deepEqual(del(devPart.replace(/^--.*$/gm, '')), [{ table: 'lhq_dev_labels', rest: `where key in ('${RETIRED}')` }]);
  // the delete must run AFTER the insert in each block (it is a different key, but an `insert ... on conflict` after a delete of unrelated rows is fine; order is pinned so a reorder is a conscious change)
  assert.ok(prodBlock.indexOf('insert into') < prodBlock.indexOf('delete from'));
});

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next') continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/.(tsx?|mts|mjs|js|jsx)$/.test(n)) out.push(f);
  }
  return out;
}
const W = (d: string) => walk(fileURLToPath(new URL(d, root)));

test('P8. nothing in app/, components/ or lib/ reads the retired key (CONTROL: the walk sees the page files and the still-live neighbour key)', () => {
  const files = [...W('app/'), ...W('components/'), ...W('lib/')];
  assert.ok(files.length > 200, `walk found ${files.length} files`);
  const text = files.map((f) => ({ f, s: strip(readFileSync(f, 'utf8')) }));
  assert.ok(text.some((x) => x.s.includes('TRADE_JOURNAL_PAGE_TITLE')), 'control: the walk does not see TradeJournal.tsx');
  const hits = text.filter((x) => x.s.includes(RETIRED)).map((x) => x.f);
  assert.deepEqual(hits, [], `still read: ${hits.join(', ')}`);
});

test('P9. /journal renders no subtitle line: the header has the title only, and the four tool tabs still render their key', () => {
  const tj = strip(read('components/TradeJournal.tsx'));
  assert.equal(tj.split("t('TRADE_JOURNAL_PAGE_TITLE')").length - 1, 1, 'control: title render');
  assert.doesNotMatch(tj, /TRADE_JOURNAL_PAGE_SUBTITLE/);
  for (const k of ['TRADE_JOURNAL_RULES_PAGE_SUBTITLE', 'TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE', 'TRADE_JOURNAL_BIAS_PAGE_SUBTITLE', 'TRADE_JOURNAL_THESIS_PAGE_SUBTITLE']) {
    assert.ok(tj.includes(`'${k}'`), `${k} is no longer rendered anywhere in TradeJournal.tsx`);
  }
});

test('P10. /alerts, /correlation and /funding still render their subtitle key', () => {
  const where: Record<string, string[]> = {
    ALERTS_PAGE_SUBTITLE: ['components', 'app'], CORRELATION_PAGE_SUBTITLE: ['components', 'app'], FUNDING_PAGE_SUBTITLE: ['components', 'app'],
  };
  const files = [...W('app/'), ...W('components/')]
    .map((f) => strip(readFileSync(f, 'utf8')));
  for (const k of Object.keys(where)) assert.ok(files.some((s) => s.includes(`'${k}'`)), `${k} is rendered nowhere`);
});

test('P11. /about: no subtitle element, ABOUT_PAGE_SUBTITLE kept for the structured-data description', () => {
  const page = strip(read(appPath('app/about/page.tsx')));
  assert.ok(page.includes("t('ABOUT_PAGE_TITLE')"), 'control: title render');
  assert.ok(!page.includes('ABOUT_PAGE_SUBTITLE'));
  assert.ok(strip(read('lib/structuredData.ts')).includes('L.ABOUT_PAGE_SUBTITLE'), 'structured data no longer reads it: the key is now orphaned');
});
