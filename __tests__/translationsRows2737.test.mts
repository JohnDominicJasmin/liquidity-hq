/* QA: PR #2737 (#1185), the HELD migration 20261128a_labels_ko_zh_ru_untranslated.sql (ko / zh / ru rows for every English UI string) and the three screens routed through labels. Read from the real file and the real sources.
 *
 * THE WRITTEN RULES (Dev's assertions in the PR body, plus the house rules every label migration here obeys):
 *   (1) every key in the migration exists in lib/labelKeys.ts LABEL_KEYS and in lib/labelDefaults.en.json
 *   (2) each ko / zh / ru value has the SAME {placeholder} set as the English value (same names, same count)
 *   (3) the four LEGAL keys (OWNER-RULES section 5: the strings that name the AI processor / the trademark non-affiliation notice) are ABSENT from the migration: legal wording stays English
 *   (4) PF_ACK_NOTE carries {disclaimer} {terms} {privacy} once each, in English and in every language row
 *   house: rows are INSERT ... ON CONFLICT shaped like the neighbours, PROD block == DEV block, no value empty, no ko / zh / ru value equals the English one (unless a named proper noun), no AI vendor / model in any value or key, no advice / forecast phrase, no unescaped quote,
 *          only label rows are written (additive), no duplicate (key, locale) inside one INSERT (Postgres refuses it: "ON CONFLICT DO UPDATE command cannot affect row a second time"), the en rows are the 8 new keys and equal the shipped defaults (a stored en row overrides the default)
 *
 *   P1  the parser: both blocks, 602 rows each, the locale / key counts the PR names, and the PR's "177 keys had NO ko / zh / ru row" is re-derived from the earlier migrations (a figure on the PR is not taken on trust)
 *   K1  rule (1) both directions: every migration key is registered and has a default; the 8 new keys are the migration's en rows, registered once each; CONTROL: an unregistered / default-less key is flagged
 *   X1  rule (2): placeholders by multiset against the English default; CONTROLS: a dropped, renamed, duplicated, extra and full-width placeholder are each flagged
 *   L1  rule (3): the legal set is derived two ways (the four names from OWNER-RULES; the English defaults that name the processor) and they agree; none is in the migration, and they are still registered; CONTROL: a row for a legal key is flagged
 *   A1  rule (4): PF_ACK_NOTE in en / ko / zh / ru; en is the exact sentence the footer showed before; CONTROLS: a row missing {terms}, with a repeated {privacy} and with a stray slot are flagged
 *   H1  statement shape like the neighbour (20261125b): header, rows, comma on every row but the last, the exact ON CONFLICT line, two blocks; CONTROLS: a missing comma, a missing ON CONFLICT, a trailing comma, a stray DELETE are flagged
 *   H2  PROD block == DEV block, row for row; no duplicate (key, locale) in a block; CONTROL: a drifted DEV row and a duplicated row are flagged
 *   H3  no empty / blank / padded value; CONTROL
 *   H4  no ko / zh / ru value equals the English default (the named ticker rows are the only exceptions) and each is in its own script; CONTROLS
 *   H5  no AI vendor or model in any value or key; CONTROL
 *   H6  no advice / forecast phrase (English phrases from copyNoForecastAdvice + the same ideas in ko / zh / ru); CONTROL
 *   H7  quotes: every row line is balanced and has only '' escapes; CONTROL: an unescaped apostrophe is flagged
 *   H8  additive only: the only statements are insert into lhq_labels / lhq_dev_labels with do update; the held header names both projects; CONTROL
 *   H9  the en rows are exactly the 8 new keys and equal the shipped defaults; what the migration overwrites in earlier migrations is only English text, apart from three named ko rows
 *   S1  PlatformFooter: ONE label with three link slots (the split on the three placeholders, each slot to /disclaimer /terms /privacy, the link texts through labels), the old hardcoded sentence is gone; the split run against every language's row
 *   S2  MaintenanceScreen: title + body through MAINTENANCE_TITLE / MAINTENANCE_BODY, a client component, the strings gone from the file, rendered inside a LabelsProvider (premise: outside one t() returns the KEY)
 *   S3  /auth/callback: failed / signing-in / loading / try-again through AUTH_CALLBACK_FAILED / AUTH_CALLBACK_SIGNING_IN / COMMON_LOADING / COMMON_TRY_AGAIN, {message} passed as `message`, the data-testid kept, the route sits under a LabelsProvider
 * WHAT THIS CANNOT PROVE: that the ko / zh / ru text is GOOD (AI-drafted, not native-reviewed), that the pages render it (a browser run after PM applies the DEV block and the build is on qa), or that the live lhq_labels rows match the file (the file is held, nothing is applied). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { interpolate } from '../lib/labels.ts';
import { stripSqlComments, parseEnLabelRows } from '../qa/sqlLabelRows.ts';

const FILE = '20261128a_labels_ko_zh_ru_untranslated.sql';
const NEIGHBOUR = '20261125b_labels_ru_trial_banner_short.sql';
const dir = new URL('../supabase/migrations/', import.meta.url);
const readMig = (f: string) => readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RAW = readMig(FILE);
const DEF = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const KEYS = new Set(LABEL_KEYS as readonly string[]);

type Row = { key: string; locale: string; value: string; line: number };
type Block = { table: string; rows: Row[]; closed: boolean };
const HEADER = /^insert into (lhq_labels|lhq_dev_labels) \(key, locale, value\) values$/;
const ROW = /^\('([A-Z0-9_]+)','(en|ko|zh|ru)','((?:[^']|'')*)'\)(,?)$/;
const CONFLICT = 'on conflict (key, locale) do update set value = excluded.value, updated_at = now();';
const unq = (s: string) => s.replace(/''/g, "'");

/* Parses the file's line grammar. Comments are stripped by the repo's own qa/sqlLabelRows.ts (REUSED, not re-written) so a "--" or an apostrophe in a header comment cannot move a line. Returns the blocks and EVERY line that is not in the grammar. */
function parseMigration(raw: string): { blocks: Block[]; violations: string[] } {
  const lines = stripSqlComments(raw.replace(/\r\n/g, '\n')).split('\n');
  const blocks: Block[] = []; const violations: string[] = []; let cur: Block | null = null; let commaOnLast = false; const commas: boolean[] = [];
  lines.forEach((ln, i) => {
    const n = i + 1;
    if (ln.trim() === '') return;
    if (!cur) {
      const h = HEADER.exec(ln);
      if (h) { cur = { table: h[1], rows: [], closed: false }; blocks.push(cur); commas.length = 0; }
      else violations.push(`line ${n}: outside a block: ${ln.slice(0, 80)}`);
      return;
    }
    const r = ROW.exec(ln);
    if (r) { cur.rows.push({ key: r[1], locale: r[2], value: unq(r[3]), line: n }); commas.push(r[4] === ','); return; }
    if (ln === CONFLICT) {
      commaOnLast = commas.length > 0 && commas[commas.length - 1];
      if (commaOnLast) violations.push(`line ${n}: the last row of ${cur.table} ends with a comma before on conflict`);
      commas.slice(0, -1).forEach((c, j) => { if (!c) violations.push(`block ${cur!.table}: row ${j + 1} has no comma after it`); });
      cur.closed = true; cur = null; return;
    }
    violations.push(`line ${n}: not a row or the on conflict line: ${ln.slice(0, 80)}`);
  });
  if (cur) violations.push(`block ${(cur as Block).table} is not closed by the on conflict line`);
  return { blocks, violations };
}

const P = parseMigration(RAW);
/* `?? []`: a file whose blocks do not parse must make P1 (and the shape tests) red BY NAME, not crash the module load and hide which rule broke */
const prod: Row[] = P.blocks.find((b) => b.table === 'lhq_labels')?.rows ?? [];
const dev: Row[] = P.blocks.find((b) => b.table === 'lhq_dev_labels')?.rows ?? [];
const phOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const NON_ENGLISH = ['ko', 'zh', 'ru'];

/* ---------- the checkers: each one is run on the real rows AND on a planted bad input ---------- */
const checkKeys = (rows: Row[], keys: Set<string>, defs: Record<string, string>) => [...new Set(rows.map((r) => r.key))].flatMap((k) => [...(keys.has(k) ? [] : [`${k}: not in LABEL_KEYS`]), ...(k in defs ? [] : [`${k}: no shipped English default`])]);
const checkPlaceholders = (rows: Row[], defs: Record<string, string>) => rows.filter((r) => {
  const want = defs[r.key]; if (want === undefined) return false;
  return JSON.stringify(phOf(r.value)) !== JSON.stringify(phOf(want)) || /[｛｝]/.test(r.value) || /[{}]/.test(r.value.replace(/\{\w+\}/g, ''));
}).map((r) => `${r.key}/${r.locale}: ${JSON.stringify(phOf(r.value))} vs English ${JSON.stringify(phOf(defs[r.key]))}`);
const checkLegal = (rows: Row[], legal: string[]) => rows.filter((r) => legal.includes(r.key)).map((r) => `${r.key}/${r.locale}`);
const SLOTS = ['{disclaimer}', '{terms}', '{privacy}'];
const checkAck = (rows: Row[], key = 'PF_ACK_NOTE') => ['en', 'ko', 'zh', 'ru'].flatMap((l) => {
  const row = rows.find((r) => r.key === key && r.locale === l); if (!row) return [`${l}: no ${key} row`];
  const names = [...row.value.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`);
  return [...SLOTS.filter((s) => names.filter((x) => x === s).length !== 1).map((s) => `${l}: ${s} appears ${names.filter((x) => x === s).length} times`), ...names.filter((x) => !SLOTS.includes(x)).map((x) => `${l}: stray slot ${x}`)];
});
const checkEmpty = (rows: Row[]) => rows.filter((r) => r.value.trim() === '' || r.value !== r.value.trim() || /[\n\t]/.test(r.value)).map((r) => `${r.key}/${r.locale}: ${JSON.stringify(r.value)}`);
const EQUAL_OK: Record<string, string> = { ARENA_KIND_ETF: 'a ticker class (the English default is the symbol "ETF" itself)' };
const SCRIPT_OK: Record<string, string> = { ARENA_KIND_ETF: 'ticker class symbol', ARENA_CAT_ETFS: 'ticker class symbol (English default "ETFs")' };
const hangul = /[ᄀ-ᇿ㄰-㆏가-힯]/, han = /[一-鿿]/, cyr = /[Ѐ-ӿ]/, kana = /[぀-ヿ]/;
const checkEnglishEqual = (rows: Row[], defs: Record<string, string>) => rows.filter((r) => NON_ENGLISH.includes(r.locale) && !(r.key in EQUAL_OK) && defs[r.key] !== undefined && r.value.trim().toLowerCase() === defs[r.key].trim().toLowerCase()).map((r) => `${r.key}/${r.locale}: "${r.value}" equals the English`);
const checkScript = (rows: Row[]) => rows.filter((r) => NON_ENGLISH.includes(r.locale) && !(r.key in SCRIPT_OK)).flatMap((r) => {
  const v = r.value.replace(/\{\w+\}/g, ''); const out: string[] = [];
  if (r.locale === 'ko' && !hangul.test(v)) out.push('no Hangul');
  if (r.locale === 'zh' && !han.test(v)) out.push('no Han characters');
  if (r.locale === 'ru' && !cyr.test(v)) out.push('no Cyrillic');
  if (r.locale === 'ko' && (han.test(v) || cyr.test(v) || kana.test(v))) out.push('Han / Cyrillic / Kana in Korean');
  if (r.locale === 'zh' && (hangul.test(v) || cyr.test(v) || kana.test(v))) out.push('Hangul / Cyrillic / Kana in Chinese');
  if (r.locale === 'ru' && (han.test(v) || hangul.test(v))) out.push('Han / Hangul in Russian');
  return out.map((o) => `${r.key}/${r.locale}: ${o}`);
});
const VENDOR = /\b(?:xai|x\.ai|grok|openai|anthropic|claude|gpt|gemini|chatgpt|llm)\b|\bgrok-?\d/i;
const checkVendor = (rows: Row[]) => rows.filter((r) => VENDOR.test(r.value) || VENDOR.test(r.key.replace(/_/g, ' '))).map((r) => `${r.key}/${r.locale}`);
const BANNED_EN = /\bwait for\b|\bstay out\b|\breduce size\b|\bmay push\b|\btends? to\b|\bpump\b|\bdump\b|\bmagnet\b|\bheadwind\b|\btailwind\b|\brisk-(?:on|off)\b|\bdanger\b|\bso you know\b|\bbig players\b|\btaking profit\b|\bgood time\b|\btrade now\b|\bentry possible\b|\bwill (?:rise|fall|drop|pump|dump)\b|\bshould (?:buy|sell)\b|\b(?:buy|sell) now\b/i;
const BANNED_X = /펌프|덤프|매수\s*추천|매도\s*추천|사야\s*합니다|팔아야|상승할\s*것|하락할\s*것|拉升|砸盘|建议买入|建议卖出|应该买|应该卖|将上涨|将下跌|会上涨|会下跌|накачк|рекомендуем\s+(?:купить|продать)|стоит\s+(?:купить|продать)|будет\s+расти|вырастет|упадёт/i;
const checkAdvice = (rows: Row[]) => rows.filter((r) => BANNED_EN.test(r.value) || BANNED_X.test(r.value)).map((r) => `${r.key}/${r.locale}: ${(BANNED_EN.exec(r.value) ?? BANNED_X.exec(r.value))![0]}`);
/* H7: the quotes of a whole file, line by line (after comments are stripped): each row line has an even quote count and is in the grammar */
const checkQuotes = (raw: string) => stripSqlComments(raw.replace(/\r\n/g, '\n')).split('\n').map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l.startsWith("('")).filter(({ l }) => (l.match(/'/g) ?? []).length % 2 !== 0 || !ROW.test(l)).map(({ l, n }) => `line ${n}: ${l.slice(0, 70)}`);
/* H8: the verbs a file executes, read from the code with comments and string literals blanked */
const verbs = (raw: string) => stripSqlComments(raw.replace(/\r\n/g, '\n')).replace(/'(?:[^']|'')*'/g, "''").match(/\b(?:insert\s+into\s+\w+|do\s+update|update\s+\w+|delete\s+from\s+\w+|drop\s+\w+|truncate\s+\w+|alter\s+\w+|create\s+\w+|grant\s+\w+|revoke\s+\w+|copy\s+\w+|select\b|call\s+\w+)/gi)?.map((s) => s.toLowerCase().replace(/\s+/g, ' ')) ?? [];
const rowsOf = (...r: Array<[string, string, string]>): Row[] => r.map(([key, locale, value], i) => ({ key, locale, value, line: i + 1 }));

/* what the migrations BEFORE this one say about ko / zh / ru (the last row for a key / locale wins, in filename order) */
const earlier = readdirSync(dir).filter((f) => f.endsWith('.sql') && f < FILE).sort();
const prior = new Map<string, string>();
{ const tup = /\(\s*'([A-Z0-9_]+)'\s*,\s*'(ko|zh|ru)'\s*,\s*'((?:[^']|'')*)'\s*\)/g; for (const f of earlier) { const code = stripSqlComments(readMig(f)); let m: RegExpExecArray | null; while ((m = tup.exec(code))) prior.set(`${m[1]}|${m[2]}`, unq(m[3])); } }

const NEW_KEYS = ['AUTH_CALLBACK_FAILED', 'AUTH_CALLBACK_SIGNING_IN', 'COMMON_LOADING', 'COMMON_TRY_AGAIN', 'MAINTENANCE_BODY', 'MAINTENANCE_TITLE', 'PF_ACK_NOTE', 'PF_LINK_DISCLAIMER_SHORT'];
const LEGAL = ['DISCLAIMER_SECTION_AI_ANALYSIS_BODY', 'PRIVACY_SECTION_THIRD_PARTY_BODY', 'TERMS_SECTION_THIRD_PARTY_DATA_BODY', 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY'];

test('P1. the parser reads both blocks; the counts on the PR are the counts in the file; "177 keys had no row" is re-derived', () => {
  assert.deepEqual(P.violations, [], `lines outside the grammar:\n${P.violations.join('\n')}`);
  assert.equal(P.blocks.length, 2, 'two blocks: PROD (lhq_labels) and DEV (lhq_dev_labels)');
  assert.deepEqual(P.blocks.map((b) => b.table), ['lhq_labels', 'lhq_dev_labels']);
  assert.ok(P.blocks.every((b) => b.closed));
  assert.equal(prod.length, 602, 'the PR says 602 rows in each block'); assert.equal(dev.length, 602);
  const per = (l: string) => prod.filter((r) => r.locale === l).length;
  assert.deepEqual({ en: per('en'), ko: per('ko'), zh: per('zh'), ru: per('ru') }, { en: 8, ko: 210, zh: 189, ru: 195 });
  const keys = [...new Set(prod.map((r) => r.key))]; assert.equal(keys.length, 215);
  const complete = keys.filter((k) => NON_ENGLISH.every((l) => prod.some((r) => r.key === k && r.locale === l)));
  const partial = keys.filter((k) => !complete.includes(k));
  assert.equal(complete.length, 185, '177 keys with no row + 8 new keys carry all three languages'); assert.equal(partial.length, 30, 'the "about 30" existing rows: keys with only the languages that were English');
  const noPrior = complete.filter((k) => NON_ENGLISH.every((l) => !prior.has(`${k}|${l}`)));
  assert.equal(noPrior.length, 185); assert.equal(noPrior.filter((k) => !NEW_KEYS.includes(k)).length, 177, 'the PR says 177 keys had NO ko / zh / ru row: re-derived from the earlier migrations');
  assert.ok(partial.every((k) => NON_ENGLISH.some((l) => prior.has(`${k}|${l}`))), 'the 30 partial keys are the ones that already had a row');
  /* CROSS-CHECK with the repo's own en parser (the same file read by a second instrument): the same 8 en rows */
  const en = parseEnLabelRows(RAW); assert.deepEqual([...en.keys()].sort(), NEW_KEYS);
  /* CONTROL: a grammar violation really is reported */
  assert.ok(parseMigration(RAW + '\ndelete from lhq_labels;\n').violations.length > 0, 'CONTROL: a stray statement was not reported');
});

test('K1. rule (1): every migration key is in LABEL_KEYS and has a shipped English default; the 8 new keys are registered once', () => {
  assert.deepEqual(checkKeys(prod, KEYS, DEF), []);
  assert.deepEqual(checkKeys(dev, KEYS, DEF), []);
  const arr = LABEL_KEYS as readonly string[];
  for (const k of NEW_KEYS) { assert.equal(arr.filter((x) => x === k).length, 1, `${k} must be registered exactly once`); assert.ok(typeof DEF[k] === 'string' && DEF[k].length > 0, `${k}: no default`); assert.ok(prod.some((r) => r.key === k && r.locale === 'en'), `${k}: no en row in the migration (the new key's English row)`); }
  /* the other direction: the migration's en rows ARE the new keys, nothing else */
  assert.deepEqual([...new Set(prod.filter((r) => r.locale === 'en').map((r) => r.key))].sort(), NEW_KEYS);
  /* CONTROLS */
  const fake = rowsOf(['NO_SUCH_KEY_2737', 'ko', 'x'], ['PF_ACK_NOTE', 'ko', 'x']);
  assert.deepEqual(checkKeys(fake, KEYS, DEF), ['NO_SUCH_KEY_2737: not in LABEL_KEYS', 'NO_SUCH_KEY_2737: no shipped English default']);
  assert.deepEqual(checkKeys(rowsOf(['PF_ACK_NOTE', 'ko', 'x']), new Set([...KEYS].filter((k) => k !== 'PF_ACK_NOTE')), DEF), ['PF_ACK_NOTE: not in LABEL_KEYS'], 'CONTROL: a key dropped from LABEL_KEYS is flagged');
  const noDef = { ...DEF }; delete noDef.PF_ACK_NOTE;
  assert.deepEqual(checkKeys(rowsOf(['PF_ACK_NOTE', 'ko', 'x']), KEYS, noDef), ['PF_ACK_NOTE: no shipped English default'], 'CONTROL: a key dropped from the defaults is flagged');
});

test('X1. rule (2): each value has the same {placeholder} multiset as the English default', () => {
  assert.deepEqual(checkPlaceholders(prod, DEF), []);
  const withPh = prod.filter((r) => /\{\w+\}/.test(r.value)); assert.ok(withPh.length >= 30, `CONTROL: only ${withPh.length} values carry a placeholder, so the check would be near-vacuous`);
  assert.ok(withPh.some((r) => r.locale === 'ko') && withPh.some((r) => r.locale === 'zh') && withPh.some((r) => r.locale === 'ru'), 'placeholders are exercised in all three languages');
  /* CONTROLS (English default for the three keys: {message}; {disclaimer} {terms} {privacy}; {pct} {arrow}) */
  const d = { K: 'Sign-in failed: {message}', K2: '{arrow} {pct} vs VWAP', K3: 'plain' };
  assert.deepEqual(checkPlaceholders(rowsOf(['K', 'ko', 'x: {message}']), d), [], 'a faithful row is clean');
  assert.equal(checkPlaceholders(rowsOf(['K', 'ko', '로그인 실패']), d).length, 1, 'CONTROL: a DROPPED placeholder is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K', 'ko', 'x: {msg}']), d).length, 1, 'CONTROL: a RENAMED placeholder is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K', 'ko', 'x: {message} {message}']), d).length, 1, 'CONTROL: a DUPLICATED placeholder (same name, count 2) is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K', 'ko', 'x: {message} {extra}']), d).length, 1, 'CONTROL: an EXTRA placeholder is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K', 'zh', 'x：｛message｝']), d).length, 1, 'CONTROL: a full-width brace is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K', 'ru', 'x: {message']), d).length, 1, 'CONTROL: an unbalanced brace is flagged');
  assert.equal(checkPlaceholders(rowsOf(['K2', 'ko', '{pct} {arrow} VWAP']), d).length, 0, 'order may differ: the SET is what is pinned');
  assert.equal(checkPlaceholders(rowsOf(['K3', 'ru', 'просто {x}']), d).length, 1, 'CONTROL: a placeholder where English has none is flagged');
});

test('L1. rule (3): the four legal keys are absent from the migration (the legal set derived two ways)', () => {
  /* the set as the OWNER-RULES section 5 names it (literals above) vs the set the shipped English defaults actually carry: the keys whose English names the processor. They must be the same four. */
  const named = Object.keys(DEF).filter((k) => /\bxAI\b|\bGrok\b|\bOpenAI\b/.test(DEF[k])).sort();
  assert.deepEqual(named, [...LEGAL].sort(), 'the keys whose English default names the AI processor are not the four OWNER-RULES section 5 names: a fifth legal key was added or one was removed; update the list WITH the owner rule');
  assert.deepEqual(checkLegal(prod, LEGAL), []); assert.deepEqual(checkLegal(dev, LEGAL), []);
  assert.ok(!/DISCLAIMER_SECTION_|PRIVACY_SECTION_|TERMS_SECTION_THIRD_PARTY/.test(prod.map((r) => r.key).join(' ').replace(/TERMS_SECTION_(?:BILLING|CANCELLATION|REFUNDS|SUBSCRIPTIONS|WARRANTY)/g, '')), 'no other DISCLAIMER_SECTION / PRIVACY_SECTION / third-party TERMS key either (legal-adjacent)');
  for (const k of LEGAL) assert.ok(KEYS.has(k), `${k} must still be registered (a tidy-up must not delete it)`);
  /* the file says so in its own header */
  assert.match(RAW, /NOT translated on purpose: the four legal strings/);
  /* CONTROL */
  assert.deepEqual(checkLegal(rowsOf(['PRIVACY_SECTION_THIRD_PARTY_BODY', 'ko', 'x'], ['PF_ACK_NOTE', 'ko', 'x']), LEGAL), ['PRIVACY_SECTION_THIRD_PARTY_BODY/ko']);
  assert.deepEqual(checkLegal(rowsOf(['DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY', 'ru', 'x']), LEGAL), ['DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY/ru'], 'CONTROL: the fourth (xAI trademark notice) is the one a tidy-up forgets');
});

test('A1. rule (4): PF_ACK_NOTE carries {disclaimer} {terms} {privacy} once each in en, ko, zh and ru', () => {
  assert.deepEqual(checkAck(prod), []); assert.deepEqual(checkAck(dev), []);
  const en = prod.find((r) => r.key === 'PF_ACK_NOTE' && r.locale === 'en')!.value;
  assert.equal(en, 'By using LiquidityHQ, you acknowledge that you understand and agree to our {disclaimer}, {terms}, and {privacy}.');
  assert.equal(DEF.PF_ACK_NOTE, en, 'the shipped default is the en row');
  /* "in English the footer reads exactly as before": the sentence with the three links filled in is the old hardcoded sentence */
  assert.equal(en.replace('{disclaimer}', DEF.PF_LINK_DISCLAIMER_SHORT).replace('{terms}', DEF.PF_LINK_TERMS).replace('{privacy}', DEF.PF_LINK_PRIVACY), 'By using LiquidityHQ, you acknowledge that you understand and agree to our Disclaimer, Terms of Use, and Privacy Policy.');
  /* CONTROLS */
  const ok = rowsOf(['PF_ACK_NOTE', 'en', 'a {disclaimer} {terms} {privacy}'], ['PF_ACK_NOTE', 'ko', 'a {disclaimer} {terms} {privacy}'], ['PF_ACK_NOTE', 'zh', 'a {disclaimer} {terms} {privacy}'], ['PF_ACK_NOTE', 'ru', 'a {disclaimer} {terms} {privacy}']);
  assert.deepEqual(checkAck(ok), [], 'a faithful set is clean');
  assert.deepEqual(checkAck(ok.map((r) => (r.locale === 'zh' ? { ...r, value: 'a {disclaimer} {privacy}' } : r))), ['zh: {terms} appears 0 times'], 'CONTROL: a language row missing {terms}');
  assert.deepEqual(checkAck(ok.map((r) => (r.locale === 'ru' ? { ...r, value: 'a {disclaimer} {terms} {privacy} {privacy}' } : r))), ['ru: {privacy} appears 2 times'], 'CONTROL: a repeated {privacy}');
  assert.deepEqual(checkAck(ok.map((r) => (r.locale === 'ko' ? { ...r, value: 'a {disclaimer} {terms} {privacy} {link}' } : r))), ['ko: stray slot {link}'], 'CONTROL: a stray slot');
  assert.deepEqual(checkAck(ok.filter((r) => r.locale !== 'en')), ['en: no PF_ACK_NOTE row'], 'CONTROL: a missing language row');
});

test('H1. statement shape: header, rows, a comma on every row but the last, the exact ON CONFLICT line (the neighbour 20261125b is the pattern)', () => {
  assert.deepEqual(P.violations, []);
  /* the pattern is the neighbour's: its header and conflict lines, character for character */
  const nb = readMig(NEIGHBOUR);
  assert.ok(nb.includes('insert into lhq_labels (key, locale, value) values\n') && nb.includes('insert into lhq_dev_labels (key, locale, value) values\n'), 'CONTROL: the neighbour no longer has the header lines this file is compared against');
  assert.ok(nb.includes(CONFLICT), 'CONTROL: the neighbour no longer has the ON CONFLICT line this file is compared against');
  assert.equal(RAW.split(CONFLICT).length - 1, 2, 'one ON CONFLICT line per block');
  assert.equal(RAW.split('\ninsert into ').length - 1, 2);
  /* CONTROLS: each broken shape is reported */
  const good = "insert into lhq_labels (key, locale, value) values\n('A','ko','x'),\n('B','ko','y')\n" + CONFLICT + '\n';
  assert.deepEqual(parseMigration(good).violations, [], 'the planted-good file is clean');
  assert.ok(parseMigration(good.replace("('A','ko','x'),", "('A','ko','x')")).violations.some((v) => /no comma/.test(v)), 'CONTROL: a missing comma between rows');
  assert.ok(parseMigration(good.replace("('B','ko','y')\n", "('B','ko','y'),\n")).violations.some((v) => /ends with a comma/.test(v)), 'CONTROL: a trailing comma before on conflict');
  assert.ok(parseMigration(good.replace(CONFLICT, '')).violations.some((v) => /not closed/.test(v)), 'CONTROL: a missing ON CONFLICT');
  assert.ok(parseMigration(good.replace('do update set value = excluded.value, updated_at = now();', 'do nothing;')).violations.length > 0, 'CONTROL: a different conflict action (do nothing would leave stale rows)');
  assert.ok(parseMigration(good + 'delete from lhq_labels;\n').violations.length > 0, 'CONTROL: a stray DELETE');
  assert.ok(parseMigration(good.replace("'ko'", "'xx'")).violations.length > 0, 'CONTROL: a locale outside en / ko / zh / ru');
  assert.ok(parseMigration(good.replace("('A'", "('a'")).violations.length > 0, 'CONTROL: a lower-case key');
});

test('H2. PROD block == DEV block row for row; no (key, locale) twice inside a block', () => {
  assert.deepEqual(prod.map((r) => [r.key, r.locale, r.value]), dev.map((r) => [r.key, r.locale, r.value]));
  const dupes = (rows: Row[]) => { const seen = new Set<string>(); return rows.filter((r) => { const k = `${r.key}|${r.locale}`; const d = seen.has(k); seen.add(k); return d; }).map((r) => `${r.key}/${r.locale}`); };
  assert.deepEqual(dupes(prod), []); assert.deepEqual(dupes(dev), []);
  const key = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.key, r.locale, r.value]));
  assert.notEqual(key(prod), key(prod.map((r, i) => (i === 100 ? { ...r, value: r.value + 'x' } : r))), 'CONTROL: a drifted DEV row changes the comparison');
  assert.deepEqual(dupes([...prod, prod[0]]), [`${prod[0].key}/${prod[0].locale}`], 'CONTROL: a duplicated (key, locale) is flagged (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time")');
});

test('H3. no empty, blank or padded value', () => {
  assert.deepEqual(checkEmpty(prod), []);
  assert.equal(checkEmpty(rowsOf(['K', 'ko', ''])).length, 1, 'CONTROL: empty'); assert.equal(checkEmpty(rowsOf(['K', 'ko', '   '])).length, 1, 'CONTROL: blank');
  assert.equal(checkEmpty(rowsOf(['K', 'ko', ' x'])).length, 1, 'CONTROL: padded'); assert.equal(checkEmpty(rowsOf(['K', 'ko', 'x\ny'])).length, 1, 'CONTROL: a newline inside a value');
});

test('H4. no ko / zh / ru value equals the English default (named exceptions only) and each is in its own script', () => {
  assert.deepEqual(checkEnglishEqual(prod, DEF), []);
  /* the exceptions are real and are exactly these: a ticker class, same in every language */
  const equalRows = prod.filter((r) => NON_ENGLISH.includes(r.locale) && r.value.trim().toLowerCase() === DEF[r.key]?.trim().toLowerCase()).map((r) => `${r.key}/${r.locale}`).sort();
  assert.deepEqual(equalRows, ['ARENA_KIND_ETF/ko', 'ARENA_KIND_ETF/ru', 'ARENA_KIND_ETF/zh'], 'the only rows equal to the English are the named ticker-class symbol');
  assert.deepEqual(checkScript(prod), []);
  const symbolRows = prod.filter((r) => r.key in SCRIPT_OK).map((r) => `${r.key}/${r.locale}=${r.value}`).sort();
  assert.deepEqual(symbolRows, ['ARENA_CAT_ETFS/ko=ETF', 'ARENA_CAT_ETFS/ru=ETF', 'ARENA_CAT_ETFS/zh=ETF', 'ARENA_KIND_ETF/ko=ETF', 'ARENA_KIND_ETF/ru=ETF', 'ARENA_KIND_ETF/zh=ETF'], 'the script exemption covers only the ETF symbol rows');
  /* CONTROLS */
  assert.equal(checkEnglishEqual(rowsOf(['PF_LINK_DISCLAIMER_SHORT', 'ko', 'Disclaimer']), DEF).length, 1, 'CONTROL: an untranslated value equal to the English'); assert.equal(checkEnglishEqual(rowsOf(['PF_LINK_DISCLAIMER_SHORT', 'ru', 'DISCLAIMER']), DEF).length, 1, 'CONTROL: equal ignoring case');
  assert.equal(checkEnglishEqual(rowsOf(['PF_LINK_DISCLAIMER_SHORT', 'en', 'Disclaimer']), DEF).length, 0, 'the en rows are not subject to it');
  assert.equal(checkScript(rowsOf(['K', 'ko', 'Latin only'])).length, 1, 'CONTROL: Korean with no Hangul'); assert.equal(checkScript(rowsOf(['K', 'ru', '中文'])).length, 2, 'CONTROL: Russian with Han (no Cyrillic, and the wrong script)');
  assert.equal(checkScript(rowsOf(['K', 'zh', '한국어'])).length, 2, 'CONTROL: Chinese with Hangul'); assert.equal(checkScript(rowsOf(['K', 'ko', '한국어 中文'])).length, 1, 'CONTROL: Han mixed into Korean');
});

test('H5. no AI vendor or model in any value or key (the product UI says "AI")', () => {
  assert.deepEqual(checkVendor(prod), []);
  for (const bad of ['Powered by Grok', 'xAI модель', 'OpenAI 提供', 'Claude가 분석', 'GPT-4 read', 'Gemini', 'Anthropic', 'grok-4.3']) assert.equal(checkVendor(rowsOf(['K', 'ko', bad])).length, 1, `CONTROL: "${bad}" must be flagged`);
  assert.equal(checkVendor(rowsOf(['ARENA_GROK_NOTE', 'ko', 'AI'])).length, 1, 'CONTROL: a vendor in the KEY name leaks through the payload too');
  assert.equal(checkVendor(rowsOf(['K', 'ko', 'AI 분석 없음'])).length, 0, '"AI" alone is the house word');
  assert.ok(prod.filter((r) => /\bAI\b|AI-/.test(r.value)).length >= 10, 'CONTROL: the rows that say "AI" are in the set the check ran on');
});

test('H6. no advice or forecast phrase in any value (English phrases from the copy rule; the same ideas in ko / zh / ru)', () => {
  assert.deepEqual(checkAdvice(prod), []);
  for (const bad of ['Wait for the retest', 'price will rise', 'Buy now', 'you should sell', 'a pump is coming', '지금 매수 추천', '곧 상승할 것', '建议买入', '价格将上涨', 'рекомендуем купить', 'цена вырастет']) assert.equal(checkAdvice(rowsOf(['K', 'ko', bad])).length, 1, `CONTROL: "${bad}" must be flagged`);
  /* the disclaimer line is the NEGATION of advice and must not be flagged by a blunt "advice" regex */
  assert.equal(checkAdvice(prod.filter((r) => r.key === 'AI_DISCLAIMER')).length, 0); assert.ok(prod.some((r) => r.key === 'AI_DISCLAIMER'), 'CONTROL: the "not financial advice" rows were in the set');
});

test('H7. quotes: every row line balanced, only doubled quotes inside a value', () => {
  assert.deepEqual(checkQuotes(RAW), []);
  assert.equal(checkQuotes("('K','ko','don't')").length, 1, "CONTROL: an unescaped apostrophe (don't) is flagged"); assert.deepEqual(checkQuotes("('K','ko','don''t')"), [], 'the escaped form is clean');
  assert.equal(checkQuotes("('K','ko','abc),").length, 1, 'CONTROL: an unclosed literal is flagged');
  /* a value with a quote round-trips: the parser unescapes '' to ' */
  assert.equal(parseMigration("insert into lhq_labels (key, locale, value) values\n('K','en','it''s')\n" + CONFLICT + '\n').blocks[0].rows[0].value, "it's");
  assert.equal(prod.filter((r) => /'/.test(r.value)).length, 0, 'no value carries an apostrophe at all today (nothing to mis-escape)');
});

test('H8. additive only: the statements are the two inserts with do update; the held header names both projects', () => {
  assert.deepEqual(verbs(RAW), ['insert into lhq_labels', 'do update', 'insert into lhq_dev_labels', 'do update']);
  assert.match(RAW, /NOT YET APPLIED TO ANY DATABASE/); assert.match(RAW, /qdpwhnvmhqgzijuwopso/, 'the PROD project'); assert.match(RAW, /wdtjhrilakoitfcezxpx/, 'the DEV project');
  /* CONTROLS */
  assert.deepEqual(verbs(RAW + '\ndelete from lhq_labels where locale = \'ko\';'), [...verbs(RAW), 'delete from lhq_labels']); assert.ok(verbs(RAW + '\nupdate profiles set role = \'admin\';').includes('update profiles'), 'CONTROL: an UPDATE of another table');
  assert.ok(verbs(RAW + '\ndrop table lhq_labels;').includes('drop table'), 'CONTROL: DROP'); assert.ok(verbs(RAW + '\nalter table lhq_labels add column x int;').includes('alter table'), 'CONTROL: ALTER');
  assert.deepEqual(verbs("insert into lhq_labels (key, locale, value) values ('K','ko','delete from x; drop table y');"), ['insert into lhq_labels'], 'a verb inside a label VALUE is not a statement');
  assert.deepEqual(verbs("-- delete from lhq_labels;\ninsert into lhq_labels (key, locale, value) values ('K','ko','x');"), ['insert into lhq_labels'], 'a verb inside a comment is not a statement');
});

test('H9. the en rows are the 8 new keys and equal the shipped defaults; what is overwritten in the earlier migrations is only English, apart from three named ko rows', () => {
  for (const r of prod.filter((x) => x.locale === 'en')) assert.equal(r.value, DEF[r.key], `${r.key}: the en row differs from labelDefaults.en.json (a stored en row would override the shipped default)`);
  assert.equal(prod.filter((r) => r.locale === 'en').length, 8);
  const overwritten = prod.filter((r) => NON_ENGLISH.includes(r.locale) && prior.has(`${r.key}|${r.locale}`));
  const notEnglish = overwritten.filter((r) => prior.get(`${r.key}|${r.locale}`) !== DEF[r.key]).map((r) => `${r.key}/${r.locale}: "${prior.get(`${r.key}|${r.locale}`)}" -> "${r.value}"`).sort();
  assert.deepEqual(notEnglish, [
    'BACKTEST_SMC_SECTION_FAIR_VALUE_GAPS/ko: "Fair Value Gap" -> "공정가치 갭(FVG)"',
    'BACKTEST_SMC_SECTION_ORDER_BLOCKS/ko: "Order Block" -> "오더 블록"',
    'UPGRADE_GATE_BULLET_2/ko: "Absorption Detector, Order Flow, Confluence Score" -> "흡수 감지기, 오더 플로우, 컨플루언스 점수"',
  ], 'a row that held a real earlier translation is replaced: the three are English terms of art that the migration localises (Dev chose it; PM may want to look)');
  assert.equal(overwritten.length, 31, '28 rows whose earlier value was the English text + the three above');
  assert.ok(overwritten.every((r) => prior.get(`${r.key}|${r.locale}`) !== r.value), 'no row is a no-op rewrite of the same text');
});

/* ======================= source pins: the three screens routed through labels ======================= */
const SPLIT = /(\{disclaimer\}|\{terms\}|\{privacy\})/;
const LINK_TEXT: Record<string, Record<string, string>> = {};
for (const l of ['ko', 'zh', 'ru']) LINK_TEXT[l] = { '{disclaimer}': prod.find((r) => r.key === 'PF_LINK_DISCLAIMER_SHORT' && r.locale === l)?.value ?? '', '{terms}': prior.get(`PF_LINK_TERMS|${l}`) ?? '', '{privacy}': prior.get(`PF_LINK_PRIVACY|${l}`) ?? '' };
LINK_TEXT.en = { '{disclaimer}': DEF.PF_LINK_DISCLAIMER_SHORT, '{terms}': DEF.PF_LINK_TERMS, '{privacy}': DEF.PF_LINK_PRIVACY };
const HREF: Record<string, string> = { '{disclaimer}': '/disclaimer', '{terms}': '/terms', '{privacy}': '/privacy' };

test('S1. PlatformFooter: ONE sentence label with three link slots, the old hardcoded English sentence is gone', () => {
  const src = read('components/PlatformFooter.tsx');
  const a = src.indexOf('<div className="pf-footer-bottom">'); assert.ok(a > 0, 'CONTROL: the footer bottom block was not found'); const bottom = src.slice(a, src.indexOf('</div>', a));
  /* the premise (word order differs per language): the sentence is read as ONE label and split on the three slots */
  assert.ok(bottom.includes(`t('PF_ACK_NOTE').split(/${SPLIT.source}/)`), 'the footer must read t(\'PF_ACK_NOTE\') and split it on {disclaimer} {terms} {privacy}');
  assert.match(bottom, /part === '\{disclaimer\}' \? \['\/disclaimer', t\('PF_LINK_DISCLAIMER_SHORT'\)\]/, 'slot {disclaimer} -> /disclaimer with the SHORT disclaimer label');
  assert.match(bottom, /part === '\{terms\}' \? \['\/terms', t\('PF_LINK_TERMS'\)\]/, 'slot {terms} -> /terms with PF_LINK_TERMS');
  assert.match(bottom, /part === '\{privacy\}' \? \['\/privacy', t\('PF_LINK_PRIVACY'\)\]/, 'slot {privacy} -> /privacy with PF_LINK_PRIVACY');
  assert.match(bottom, /className="pf-footer-bottom-link"/, 'the links keep the class the a11y / touch-target specs count (a.pf-footer-bottom-link)');
  assert.doesNotMatch(src, /you acknowledge that you understand/, 'the hardcoded English sentence is still in the component');
  assert.doesNotMatch(bottom, />\s*(?:Disclaimer|Terms of Use|Privacy Policy)\s*</, 'a hardcoded English link text is still in the bottom line');
  assert.match(bottom, /t\('PF_RIGHTS_RESERVED'\)/, 'the copyright half of the line is unchanged');
  /* the split run against EVERY language's real row: three slots, in the order the language writes them, with real text around them */
  for (const l of ['en', 'ko', 'zh', 'ru']) {
    const value = prod.find((r) => r.key === 'PF_ACK_NOTE' && r.locale === l)!.value; const parts = value.split(SPLIT);
    const slots = parts.filter((p) => p in HREF); assert.deepEqual([...slots].sort(), ['{disclaimer}', '{privacy}', '{terms}'], `${l}: the split does not yield three link slots`);
    assert.ok(parts.filter((p) => !(p in HREF)).join('').trim().length >= 8, `${l}: no sentence text around the links`);
    for (const s of slots) assert.ok(LINK_TEXT[l][s] && LINK_TEXT[l][s].length > 0, `${l}: no link text for ${s}`);
    const rendered = parts.map((p) => (p in HREF ? `[${LINK_TEXT[l][p]}](${HREF[p]})` : p)).join('');
    console.log(`[S1] ${l}: ${rendered}`);
    assert.doesNotMatch(rendered, /\{|\}/, `${l}: a placeholder survived into the rendered sentence`);
  }
  /* CONTROL: a row missing a slot would render with a link silently missing; the split sees it */
  assert.equal('a {disclaimer} b {privacy}'.split(SPLIT).filter((p) => p in HREF).length, 2, 'CONTROL: the split reports a missing slot');
  /* the link keys the footer reads are registered, defaulted, and have ko / zh / ru rows (earlier migrations for TERMS / PRIVACY, this one for DISCLAIMER_SHORT) */
  for (const k of ['PF_ACK_NOTE', 'PF_LINK_DISCLAIMER_SHORT', 'PF_LINK_TERMS', 'PF_LINK_PRIVACY', 'PF_RIGHTS_RESERVED']) { assert.ok(KEYS.has(k), `${k} not registered`); assert.ok(typeof DEF[k] === 'string', `${k} no default`); }
  for (const l of NON_ENGLISH) assert.ok(prior.has(`PF_LINK_TERMS|${l}`) && prior.has(`PF_LINK_PRIVACY|${l}`), `${l}: PF_LINK_TERMS / PF_LINK_PRIVACY have no earlier row, so the link text would stay English`);
});

test('S2. MaintenanceScreen: title and body through labels, rendered under a LabelsProvider', () => {
  const src = read('components/MaintenanceScreen.tsx');
  assert.match(src.split('\n')[0], /^'use client';/, 'a component that calls useLabels (a context hook) must be a client component');
  assert.match(src, /import \{ useLabels \} from '@\/lib\/labels';/); assert.match(src, /const \{ t \} = useLabels\(\);/);
  assert.match(src, /\{t\('MAINTENANCE_TITLE'\)\}/); assert.match(src, /\{t\('MAINTENANCE_BODY'\)\}/);
  assert.doesNotMatch(src, /Down for maintenance|temporarily unavailable|Back shortly/, 'the English text is still hardcoded in the screen');
  assert.equal(DEF.MAINTENANCE_TITLE, 'Down for maintenance'); assert.equal(DEF.MAINTENANCE_BODY, 'LiquidityHQ is temporarily unavailable while we make some changes. Back shortly.', 'in English the screen reads exactly as before');
  /* THE PREMISE: outside a LabelsProvider useLabels() is the default context whose t() returns the KEY, so the screen would print "MAINTENANCE_TITLE". AppShell must wrap it. */
  const shell = read('components/AppShell.tsx'); const a = shell.indexOf('config?.maintenanceMode'); const z = shell.indexOf('<MaintenanceScreen />', a);
  assert.ok(a > 0 && z > a, 'CONTROL: the maintenance branch was not found'); const branch = shell.slice(a, z);
  assert.ok(branch.includes('<LabelsProvider>'), 'MaintenanceScreen is no longer rendered inside a LabelsProvider: it would print the raw keys');
  assert.equal(read('lib/labels.ts').includes("t: (key) => key"), true, 'PREMISE: the default context returns the key (why the provider matters)');
  for (const l of NON_ENGLISH) for (const k of ['MAINTENANCE_TITLE', 'MAINTENANCE_BODY']) assert.ok(prod.some((r) => r.key === k && r.locale === l), `${l}: no ${k} row`);
  /* CONTROL: the not-hardcoded regex does match the pre-PR text */
  assert.match('<h2>Down for maintenance</h2>', /Down for maintenance|temporarily unavailable|Back shortly/, 'CONTROL: the regex sees the old hardcoded text');
});

test('S3. /auth/callback: failed / signing-in / loading / try-again through labels, {message} passed by name, the test id kept, the route under a LabelsProvider', () => {
  const src = read('app/(main)/auth/callback/page.tsx');
  assert.match(src, /import \{ useLabels \} from '@\/lib\/labels';/);
  assert.equal(src.split('const { t } = useLabels();').length - 1, 2, 'useLabels is read in CallbackInner AND in AuthCallbackPage (the Suspense fallback needs it)');
  assert.match(src, /\{t\('AUTH_CALLBACK_FAILED', \{ message: errMsg \}\)\}/, 'the failure text must pass the sign-in error as {message}');
  assert.match(src, /\{t\('COMMON_TRY_AGAIN'\)\}/); assert.match(src, /message=\{t\('AUTH_CALLBACK_SIGNING_IN'\)\}/); assert.match(src, /message=\{t\('COMMON_LOADING'\)\}/);
  /* the JSX literals only: a comment may still quote "Try again" (line 65 of the page does) */
  const jsx = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(jsx, /Sign-in failed|Signing you in|Try again|Loading…/, 'English text is still hardcoded in the callback');
  assert.match('<a>\n  Try again\n</a>'.replace(/^\s*\/\/.*$/gm, ''), /Try again/, 'CONTROL: the literal scan does see a hardcoded JSX text');
  assert.match(src, /data-testid="login-error"/, 'the test id the a11y spec reads must survive'); assert.match(src, /href="\/login"/);
  /* the name passed in the code is the placeholder in every row */
  for (const l of ['en', ...NON_ENGLISH]) { const v = prod.find((r) => r.key === 'AUTH_CALLBACK_FAILED' && r.locale === l)!.value; assert.deepEqual(phOf(v), ['message'], `${l}: the code passes {message}`); assert.equal(interpolate(v, { message: 'Invalid code' }).includes('Invalid code'), true, `${l}: the message does not reach the screen`); assert.ok(!/\{|\}/.test(interpolate(v, { message: 'Invalid code' }))); }
  assert.equal(interpolate(DEF.AUTH_CALLBACK_FAILED, { message: 'Invalid code' }), 'Sign-in failed: Invalid code', 'in English the failure reads exactly as before');
  assert.equal(DEF.AUTH_CALLBACK_SIGNING_IN, 'Signing you in…'); assert.equal(DEF.COMMON_LOADING, 'Loading…'); assert.equal(DEF.COMMON_TRY_AGAIN, 'Try again');
  /* THE PREMISE: the callback route is an auth route and that branch of AppShell wraps it in a LabelsProvider (else it prints keys) */
  const shell = read('components/AppShell.tsx');
  assert.match(shell, /const AUTH_ROUTES = \[[^\]]*'\/auth\/callback'/, 'the callback is no longer an auth route');
  const a = shell.indexOf('if (isAuthRoute(pathname)) {'); assert.ok(a > 0, 'CONTROL: the auth branch was not found'); const branch = shell.slice(a, shell.indexOf('{children}', a));
  assert.ok(branch.includes('<LabelsProvider>'), 'the auth branch no longer wraps its children in a LabelsProvider: the callback would print raw keys');
  for (const l of NON_ENGLISH) for (const k of ['AUTH_CALLBACK_FAILED', 'AUTH_CALLBACK_SIGNING_IN', 'COMMON_LOADING', 'COMMON_TRY_AGAIN']) assert.ok(prod.some((r) => r.key === k && r.locale === l), `${l}: no ${k} row`);
});
