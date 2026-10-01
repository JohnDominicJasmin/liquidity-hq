/* #1475 / PR #1483: Korean, Chinese, Arabic and Russian for the 196 product labels that had no row in any of
 * those four languages - the whole terminal navigation (TNAV_*), the page hints, the FAQ, the sign-in rules,
 * the subscription and consent text. One migration, no code:
 * supabase/migrations/20261001c_labels_translations_ko_zh_ar_ru.sql, 784 rows (196 keys x ko, zh, ar, ru).
 * Production block live, dev block commented (20260912b's convention), `on conflict (key, locale) do nothing`
 * so it only fills gaps and can never overwrite an approved translation.
 *
 * Machine translations; no native speaker has read them. This file cannot judge wording. It pins what a script
 * CAN judge and what the PR says its own script checked: the two blocks agree row for row, every key is
 * registered and has the English it was translated from, one row per key per language, nothing empty or
 * key-shaped, every {placeholder} and every number carried through, and the conflict clause is `do nothing`.
 * Left in English on purpose (PM/DevOps rulings on #1475): REFUND_*, TERMS_SECTION_WARRANTY_*, OPS_* - T5.
 *
 * Parsed from the SQL, not from a summary of it. The row parser is strict (one regex for the whole line) and
 * every line between an insert header and its conflict clause must parse, so a row the parser silently skipped
 * cannot make a count look right - T1 is the control for that. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const MIGRATION = 'supabase/migrations/20261001c_labels_translations_ko_zh_ar_ru.sql';
const lines = read(MIGRATION).split('\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const labelKeysSrc = read('lib/labelKeys.ts');

type Row = { key: string; locale: string; value: string };
const LOCALES = ['ar', 'ko', 'ru', 'zh'];

/* One row per line: ('KEY','xx','value'), with '' as the only legal quote inside a value. Returns null for
   anything else - a stray single quote, a missing field, a fourth field. */
const ROW = /^\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)(,?)$/;
function parseRow(line: string): (Row & { comma: boolean }) | null {
  const m = line.match(ROW);
  return m ? { key: m[1], locale: m[2], value: m[3].split("''").join("'"), comma: m[4] === ',' } : null;
}

function indexOnce(needle: string, label: string): number {
  const at = lines.flatMap((l, i) => (l === needle ? [i] : []));
  assert.equal(at.length, 1, `${label}: "${needle}" occurs on ${at.length} line(s), expected exactly 1 - re-read the migration`);
  return at[0];
}

/** Every line between the insert header and its conflict clause, each one required to be a row. */
function block(header: string, terminator: string, prefix: string, label: string): Row[] {
  const start = indexOnce(header, `${label} insert header`);
  const end = indexOnce(terminator, `${label} conflict clause`);
  assert.ok(end > start + 1, `${label}: the conflict clause does not follow the insert header`);
  const body = lines.slice(start + 1, end);
  return body.map((raw, i) => {
    assert.ok(raw.startsWith(prefix), `${label} line ${start + 2 + i} does not start with "${prefix}" - a non-row line inside the insert`);
    const row = parseRow(raw.slice(prefix.length));
    assert.ok(row, `${label} line ${start + 2 + i} is not a well-formed ('KEY','xx','value') row: ${raw.slice(0, 80)}`);
    const last = i === body.length - 1;
    assert.equal(row.comma, !last, `${label} line ${start + 2 + i}: ${last ? 'the last row has a trailing comma' : 'a row is missing its trailing comma'} - the statement would not parse`);
    return { key: row.key, locale: row.locale, value: row.value };
  });
}

const live = () => block('insert into lhq_labels (key, locale, value) values', 'on conflict (key, locale) do nothing;', '', 'live');
const dev = () => block('-- insert into lhq_dev_labels (key, locale, value) values', '-- on conflict (key, locale) do nothing;', '-- ', 'dev');
const keysOf = (rows: Row[]) => [...new Set(rows.map((r) => r.key))];

test('T1. CONTROL: the parser is strict and reads every line of both blocks - a skipped or malformed row cannot hide behind a count', () => {
  assert.deepEqual(parseRow("('A_KEY','ko','it''s {n}'),"), { key: 'A_KEY', locale: 'ko', value: "it's {n}", comma: true }, 'the parser does not unescape \'\' or keep the value whole');
  assert.equal(parseRow("('A_KEY','ko','it's'),"), null, 'CONTROL: a stray (undoubled) quote is accepted - the parser is not strict');
  assert.equal(parseRow("('A_KEY','ko'),"), null, 'CONTROL: a two-field row is accepted');
  assert.equal(live().length, 784, 'live block row count');
  assert.equal(dev().length, 784, 'dev block row count');
});

test('T2. the commented dev block carries the SAME rows as the live block - key, locale and value, in the same order - so applying it to dev gives qa/staging exactly what production gets', () => {
  const l = live();
  const d = dev();
  const diff = l.flatMap((r, i) => (JSON.stringify(r) === JSON.stringify(d[i]) ? [] : [`#${i + 1}: live ${JSON.stringify(r)} / dev ${JSON.stringify(d[i])}`]));
  assert.equal(d.length, l.length, `the dev block has ${d.length} rows, the live block ${l.length}`);
  assert.deepEqual(diff, [], `the blocks differ:\n${diff.slice(0, 5).join('\n')}`);
});

test('T2b. the live block writes lhq_labels and only the commented block names lhq_dev_labels - running the file never writes the shared dev table by accident', () => {
  const code = lines.filter((l) => !l.startsWith('--'));
  assert.equal(code.filter((l) => /\binsert\s+into\b/i.test(l)).length, 1, 'more than one live insert statement');
  assert.deepEqual(code.filter((l) => l.includes('lhq_dev_labels')), [], 'an uncommented line touches lhq_dev_labels');
  assert.deepEqual(lines.filter((l) => /^--\s*insert into lhq_labels\b/.test(l)), [], 'a commented block targets lhq_labels');
});

test('T3. SHAPE: one row per key per language - every key has exactly ko, zh, ar and ru, no English row, no duplicates; 196 keys x 4 = 784', () => {
  const rows = live();
  const byKey = new Map<string, string[]>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.locale]);
  const bad = [...byKey].filter(([, locs]) => JSON.stringify([...locs].sort()) !== JSON.stringify(LOCALES)).map(([k, locs]) => `${k}: ${locs.join(',')}`);
  assert.deepEqual(bad, [], `keys without exactly one row in each of ${LOCALES.join(', ')}:\n${bad.slice(0, 10).join('\n')}`);
  assert.deepEqual([...new Set(rows.map((r) => r.locale))].sort(), LOCALES, 'a locale other than ko/zh/ar/ru (an en row would overwrite nothing but is not what this PR ships)');
  assert.equal(byKey.size, 196, 'key count differs from the PR\'s 196');
  assert.equal(rows.length, byKey.size * 4);
});

test('T4. every key is registered in lib/labelKeys.ts and has a non-empty English default in lib/labelDefaults.en.json - a translation of a key the code never asks for is invisible', () => {
  const keys = keysOf(live());
  assert.deepEqual(keys.filter((k) => !labelKeysSrc.includes(`'${k}'`)), [], 'keys not in lib/labelKeys.ts');
  assert.deepEqual(keys.filter((k) => typeof defaults[k] !== 'string' || defaults[k].trim() === ''), [], 'keys with no English default');
});

test('T5. the scope the PR states: 28 TNAV_*, 35 FAQ_*, 13 LOGIN_* keys, the dev-only gap included, and none of the keys ruled to stay English (legal pages, admin console)', () => {
  const keys = keysOf(live());
  const count = (p: string) => keys.filter((k) => k.startsWith(p)).length;
  assert.equal(count('TNAV_'), 28, 'TNAV_* (navigation)');
  assert.equal(count('FAQ_'), 35, 'FAQ_*');
  assert.equal(count('LOGIN_'), 13, 'LOGIN_* (sign-in)');
  assert.ok(keys.includes('STRATEGY_PANEL_PARAMS_VERDICT_NOTE'), 'the dev-only gap key the PR names is missing');
  assert.deepEqual(keys.filter((k) => /^(REFUND_|TERMS_SECTION_WARRANTY_|OPS_)/.test(k)), [], 'a key PM/DevOps ruled stays English (#1475) was translated');
});

test('T6. no value is empty, the key name, key-shaped (CAPITALS_WITH_UNDERSCORES - what a missing label renders as), or carries an em dash', () => {
  const bad = live().flatMap((r) => {
    const why = r.value.trim() === '' ? 'empty' : r.value === r.key ? 'equals the key' : /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(r.value) ? 'key-shaped' : r.value.includes('—') ? 'em dash' : '';
    return why ? [`${r.key} ${r.locale}: ${why}`] : [];
  });
  assert.deepEqual(bad, []);
});

const tokens = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}|%[sd]/g) ?? []).sort();

test('T7. every {placeholder} in the English default is in every translation of that key, by name AND count, and no translation invents one - a dropped {cap} renders as a missing number, an extra one as raw braces', (t) => {
  const rows = live();
  const withTokens = keysOf(rows).filter((k) => tokens(defaults[k]).length > 0);
  t.diagnostic(`${withTokens.length} keys carry placeholders: ${withTokens.join(', ')}`);
  assert.equal(withTokens.length, 13, 'CONTROL: the number of placeholder-bearing keys changed - re-derive; zero would make this test vacuous');
  const bad = rows.filter((r) => JSON.stringify(tokens(r.value)) !== JSON.stringify(tokens(defaults[r.key])))
    .map((r) => `${r.key} ${r.locale}: en ${tokens(defaults[r.key]).join(' ')} / got ${tokens(r.value).join(' ') || '(none)'}`);
  assert.deepEqual(bad, []);
});

/* Numbers in the English (8 hours, 14 days, 12 characters, $10, up to 3) must survive into each translation.
   Exactly one row does not, and it is a meaning-preserving rewrite rather than a lost number: the Arabic for
   "It resets on the 1st" says "on the first day of the month" in words. Pinned as an EXACT exception set, so a
   new mismatch fails and fixing this one fails too (drop it from the set then). */
const KNOWN_NUMERAL_EXCEPTIONS = ['AI_CAP_PRO_MONTHLY ar'];
const numerals = (s: string): string[] => [...(s.match(/\d+/g) ?? [])];

test('T8. every number in the English default appears in each translation (and a $ amount keeps its $) - the only exception is the exact KNOWN_NUMERAL_EXCEPTIONS set', (t) => {
  const rows = live();
  const withNums = keysOf(rows).filter((k) => numerals(defaults[k]).length > 0);
  t.diagnostic(`${withNums.length} keys carry numbers: ${withNums.join(', ')}`);
  assert.ok(withNums.length >= 9, 'CONTROL: fewer number-bearing keys than measured (9) - re-derive before trusting a pass');
  const missing = rows.filter((r) => {
    const have = numerals(r.value);
    const lost = numerals(defaults[r.key]).some((n) => { const i = have.indexOf(n); if (i < 0) return true; have.splice(i, 1); return false; });
    return lost || (defaults[r.key].includes('$') && !r.value.includes('$'));
  }).map((r) => `${r.key} ${r.locale}`);
  assert.deepEqual(missing, KNOWN_NUMERAL_EXCEPTIONS, 'the set of rows that lost a number changed');
});

test.todo('AI_CAP_PRO_MONTHLY ar: "It resets on the 1st" is "اليوم الأول من الشهر" (the first day of the month) - numeral spelled out; meaning looks preserved, needs the native check #1483 asks for');

test('T9. the conflict clause is `do nothing` in both blocks and `do update` appears in no SQL line - the PR\'s stated intent: fill gaps, never overwrite an existing (possibly approved) translation', () => {
  indexOnce('on conflict (key, locale) do nothing;', 'live conflict clause');
  indexOnce('-- on conflict (key, locale) do nothing;', 'dev conflict clause');
  // The header's own prose ("FILLS GAPS ONLY: `on conflict ... do nothing`, never `do update`") is the one line excluded.
  const prose = (l: string) => l.startsWith('-- FILLS GAPS ONLY:');
  assert.equal(lines.filter(prose).length, 1, 're-derive: the header line that names both clauses moved or changed');
  assert.deepEqual(lines.filter((l) => /do\s+update/i.test(l) && !prose(l)), [], 'a do update clause exists');
  assert.equal(lines.filter((l) => /on\s+conflict/i.test(l) && !prose(l)).length, 2, 'an on conflict clause other than the two block terminators');
});
