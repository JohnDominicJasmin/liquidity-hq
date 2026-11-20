/* QA: PR #2741 (#1185, batch 3 of the ko / zh / ru English sweep, PM go 2026-11-20), stacked on the merged #2737 / #2738. Read from the real files and the real sources.
 *
 * THE WRITTEN RULES (Dev's assertions in the PR body; the literals below are the PR's, not read off the code):
 *   (1) held migration 20261128c: 33 keys x en / ko / zh / ru = 132 rows per block, PROD block == DEV block, additive INSERT ... ON CONFLICT only into the two label tables, held header, every key in LABEL_KEYS and lib/labelDefaults.en.json, each ko / zh / ru value has the same {placeholder} set as English, no empty value, no value equal to English, no legal key, no vendor name, no unescaped quote
 *   (2) AbsorptionDetector: d.label and d.detail STAY ENGLISH (the AI prompt and the !== 'None' compare read them); the screen renders through ABS_LABEL_KEYS / absText
 *   (3) COUNTRIES keep name as the ENGLISH stored value; the picker label comes from Intl.DisplayNames in the app locale; the stored / option value never localizes
 *   (4) SESSION_LABEL_KEYS covers ALL FIVE entries of SESSIONS; the option VALUE stays English
 *   (5) hToHM stays English (the AI-prompt line); the screen reads hToHMt
 * Cells (each rule has a CONTROL: a deliberately broken synthetic input the SAME checker must flag):
 *   P1 parser + counts   K1 keys registered / defaulted / en == default / used in code   X1 placeholders (+ the variables the code passes)
 *   L1 legal keys absent   V1 no vendor   H1 statement shape   H2 PROD == DEV   H3 no empty   H4 not English + own script   H5 quotes   H6 additive + held header
 *   A1 absorption label   A2 absorption detail / near-level (real functions, literal inputs, 4 languages)   A3 d.label / d.detail stay English (source + the real prompt line)
 *   AC1 accumulation chips (real reasonText; every reason the scorer can push)   C1 COUNTRIES   C2 the real label function   C3 stored value / search / fallbacks
 *   S1 SESSIONS / SESSION_LABEL_KEYS   D1 hToHM vs hToHMt (real functions)   D2 call sites   J1 GexTable / PlanBadge pins
 * WHAT THIS CANNOT PROVE: that the ko / zh / ru text is GOOD (AI-drafted, not native-reviewed), that the pages render it (a browser run after PM applies the DEV block), that the live lhq_labels rows match the file (held, nothing applied), or that the Intl.DisplayNames names are what a given visitor's browser prints (CLDR version of THIS node; the literals in C2 are pinned to it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { interpolate } from '../lib/labels.ts';
import { stripSqlComments } from '../qa/sqlLabelRows.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LANGS = ['en', 'ko', 'zh', 'ru'] as const;
type Lang = (typeof LANGS)[number];
const NON_ENGLISH = ['ko', 'zh', 'ru'] as const;
const DEF = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

/* ───────────────────────── helpers: cutting real code (copied from #2738's test) ───────────────────────── */
/* from the first `{` after `marker` to its matching `}`, skipping quoted strings */
function cutBlock(src: string, marker: string): string {
  const s = src.indexOf(marker); assert.ok(s >= 0, `CONTROL: marker not found: ${marker}`);
  const o = src.indexOf('{', s); let d = 0; let q = '';
  for (let i = o; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return src.slice(s, i + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}
/* the text from `from` up to (not including) `to`: for code whose signature carries braces of its own (a typed parameter list) */
function cutBetween(src: string, from: string, to: string): string {
  const a = src.indexOf(from); assert.ok(a >= 0, `CONTROL: start marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length); assert.ok(b > a, `CONTROL: end marker not found: ${to}`);
  return src.slice(a, b);
}
/* every top-level argument list of `name(` calls in src (declaration lines excluded), split on depth-0 commas */
function callArgs(src: string, name: string): string[][] {
  const out: string[][] = []; const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g'); let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    let d = 1; let q = ''; const args: string[] = []; let cur = '';
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (q) { cur += c; if (c === '\\') { cur += src[++i]; } else if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) { args.push(cur.trim()); break; } }
      if (c === ',' && d === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(args);
  }
  return out;
}
function load<T>(code: string, name: string, deps: Record<string, unknown> = {}): T {
  const js = stripTypeScriptTypes(code);
  return new Function(...Object.keys(deps), `${js}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function expr(text: string, args: string[]): (...v: unknown[]) => unknown {
  return new Function(...args, `return (${text});`) as (...v: unknown[]) => unknown;
}
const lineOf = (src: string, needle: string) => { const i = src.indexOf(needle); assert.ok(i >= 0, `CONTROL: anchor not found: ${needle}`); const a = src.lastIndexOf('\n', i) + 1; return src.slice(a, src.indexOf('\n', i)); };

/* ───────────────────────── the migration: parser (copied from #2737's test) ───────────────────────── */
const MIG = '20261128c_labels_scanner_absorption_journal.sql';
const NEIGHBOUR = '20261128b_labels_hardcoded_screens_times.sql';
const RAW = read(`supabase/migrations/${MIG}`);
type Row = { key: string; locale: string; value: string; line: number };
type Block = { table: string; rows: Row[]; closed: boolean };
const HEADER = /^insert into (lhq_labels|lhq_dev_labels) \(key, locale, value\) values$/;
const ROW = /^\('([A-Z0-9_]+)','(en|ko|zh|ru)','((?:[^']|'')*)'\)(,?)$/;
const CONFLICT = 'on conflict (key, locale) do update set value = excluded.value, updated_at = now();';
const unq = (s: string) => s.replace(/''/g, "'");
function parseMigration(raw: string): { blocks: Block[]; violations: string[] } {
  const lines = stripSqlComments(raw.replace(/\r\n/g, '\n')).split('\n');
  const blocks: Block[] = []; const violations: string[] = []; let cur: Block | null = null; const commas: boolean[] = [];
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
      if (commas.length > 0 && commas[commas.length - 1]) violations.push(`line ${n}: the last row of ${cur.table} ends with a comma before on conflict`);
      commas.slice(0, -1).forEach((c, j) => { if (!c) violations.push(`block ${cur!.table}: row ${j + 1} has no comma after it`); });
      cur.closed = true; cur = null; return;
    }
    violations.push(`line ${n}: not a row or the on conflict line: ${ln.slice(0, 80)}`);
  });
  if (cur) violations.push(`block ${(cur as Block).table} is not closed by the on conflict line`);
  return { blocks, violations };
}
const phOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const verbs = (raw: string) => stripSqlComments(raw.replace(/\r\n/g, '\n')).replace(/'(?:[^']|'')*'/g, "''").match(/\b(?:insert\s+into\s+\w+|do\s+update|update\s+\w+|delete\s+from\s+\w+|drop\s+\w+|truncate\s+\w+|alter\s+\w+|create\s+\w+|grant\s+\w+|revoke\s+\w+|copy\s+\w+|select\b|call\s+\w+)/gi)?.map((s) => s.toLowerCase().replace(/\s+/g, ' ')) ?? [];

/* the 33 keys, written out from the three families the PR body names (not read off the migration) */
const NEW_KEYS = [
  'ABSORPTION_DETAIL_ASK_AT', 'ABSORPTION_DETAIL_ASK_FROM', 'ABSORPTION_DETAIL_AVG_VOL', 'ABSORPTION_DETAIL_BID_AT', 'ABSORPTION_DETAIL_BID_FROM', 'ABSORPTION_DETAIL_CANDLES', 'ABSORPTION_DETAIL_FIB', 'ABSORPTION_DETAIL_LOW',
  'ABSORPTION_LABEL_MODERATE', 'ABSORPTION_LABEL_NONE', 'ABSORPTION_LABEL_STRONG', 'ABSORPTION_LABEL_WEAK',
  'ACCUMULATION_REASON_CVD', 'ACCUMULATION_REASON_FUNDING_CALM', 'ACCUMULATION_REASON_OI_BUILDING', 'ACCUMULATION_REASON_OI_DRIFTING', 'ACCUMULATION_REASON_PRICE_FLAT', 'ACCUMULATION_REASON_PRICE_QUIET', 'ACCUMULATION_REASON_SHORTS_PAYING', 'ACCUMULATION_REASON_TAKER', 'ACCUMULATION_REASON_VOL', 'ACCUMULATION_REASON_WHALES',
  'BRIEFING_DUR_H', 'BRIEFING_DUR_HM', 'BRIEFING_DUR_MIN',
  'GEX_TABLE_REGIME_WORD',
  'JOURNAL_SESSION_ASIA', 'JOURNAL_SESSION_LONDON', 'JOURNAL_SESSION_NEW_YORK', 'JOURNAL_SESSION_PRE_MARKET', 'JOURNAL_SESSION_WEEKEND',
  'ONBOARDING_FLOW_COUNTRY_OTHER', 'PLAN_BADGE_TRIAL_TITLE',
];
/* the variables the code passes for each key that has a placeholder (pinned again against the real functions in A2 / AC1 / D1) */
const KEY_VARS: Record<string, string[]> = {
  ACCUMULATION_REASON_TAKER: ['n'], ACCUMULATION_REASON_WHALES: ['n'], ACCUMULATION_REASON_VOL: ['x'],
  ABSORPTION_DETAIL_BID_AT: ['price'], ABSORPTION_DETAIL_ASK_AT: ['price'], ABSORPTION_DETAIL_BID_FROM: ['pct', 'price'], ABSORPTION_DETAIL_ASK_FROM: ['pct', 'price'],
  ABSORPTION_DETAIL_FIB: ['level', 'price'], ABSORPTION_DETAIL_CANDLES: ['n', 't'], ABSORPTION_DETAIL_AVG_VOL: ['x'],
  BRIEFING_DUR_MIN: ['m'], BRIEFING_DUR_HM: ['h', 'm'], BRIEFING_DUR_H: ['h'],
};
/* the four legal strings, OWNER-RULES section 5 (the same four #2737 / #2738 hold) */
const LEGAL = ['DISCLAIMER_SECTION_AI_ANALYSIS_BODY', 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY', 'PRIVACY_SECTION_THIRD_PARTY_BODY', 'TERMS_SECTION_THIRD_PARTY_DATA_BODY'];
const VENDOR = /\b(?:xai|x\.ai|grok|openai|anthropic|claude|gpt|gemini|chatgpt|llm)\b|\bgrok-?\d/i;
const hangul = /[ᄀ-ᇿ㄰-㆏가-힯]/, han = /[一-鿿]/, cyr = /[Ѐ-ӿ]/, kana = /[぀-ヿ]/;
/* named exceptions to "no value equals English": none today. A proper noun would be added HERE with its reason. */
const EQUAL_OK: Record<string, string> = {};

/** Every violation of the migration rules in `raw`, grouped by cell. Pure, so each CONTROL feeds it a broken text and reads the SAME cell. */
function migChecks(raw: string, defs: Record<string, string>, labelKeys: readonly string[]): Record<'P1' | 'K1' | 'X1' | 'L1' | 'V1' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6', string[]> {
  const out = { P1: [] as string[], K1: [] as string[], X1: [] as string[], L1: [] as string[], V1: [] as string[], H1: [] as string[], H2: [] as string[], H3: [] as string[], H4: [] as string[], H5: [] as string[], H6: [] as string[] };
  const P = parseMigration(raw);
  out.H1.push(...P.violations);
  if (P.blocks.length !== 2 || P.blocks[0]?.table !== 'lhq_labels' || P.blocks[1]?.table !== 'lhq_dev_labels') out.H1.push(`blocks: ${P.blocks.map((b) => b.table).join(',')}, expected lhq_labels then lhq_dev_labels`);
  if (raw.split(CONFLICT).length - 1 !== 2) out.H1.push('expected one on conflict line per block');
  const prod = P.blocks.find((b) => b.table === 'lhq_labels')?.rows ?? []; const dev = P.blocks.find((b) => b.table === 'lhq_dev_labels')?.rows ?? [];
  /* P1: 33 keys x 4 languages = 132 per block, exactly one row per (key, language), the key set is the 33 */
  for (const [name, rows] of [['PROD', prod], ['DEV', dev]] as const) {
    if (rows.length !== NEW_KEYS.length * LANGS.length) out.P1.push(`${name}: ${rows.length} rows, expected ${NEW_KEYS.length * LANGS.length}`);
    const keys = [...new Set(rows.map((r) => r.key))].sort();
    if (JSON.stringify(keys) !== JSON.stringify([...NEW_KEYS].sort())) out.P1.push(`${name}: key set differs: extra ${keys.filter((k) => !NEW_KEYS.includes(k))} missing ${NEW_KEYS.filter((k) => !keys.includes(k))}`);
    for (const k of NEW_KEYS) for (const l of LANGS) { const n = rows.filter((r) => r.key === k && r.locale === l).length; if (n !== 1) out.P1.push(`${name}: ${k}/${l} has ${n} rows`); }
  }
  /* H2 */
  if (JSON.stringify(prod.map((r) => [r.key, r.locale, r.value])) !== JSON.stringify(dev.map((r) => [r.key, r.locale, r.value]))) out.H2.push('PROD and DEV blocks differ');
  for (const [name, rows] of [['PROD', prod], ['DEV', dev]] as const) { const seen = new Set<string>(); for (const r of rows) { const id = `${r.key}/${r.locale}`; if (seen.has(id)) out.H2.push(`${name}: duplicate ${id}`); seen.add(id); } }
  /* K1 */
  const arr = [...labelKeys];
  for (const k of [...new Set(prod.map((r) => r.key))]) {
    if (arr.filter((x) => x === k).length !== 1) out.K1.push(`${k}: registered ${arr.filter((x) => x === k).length} times in LABEL_KEYS`);
    if (!(k in defs)) out.K1.push(`${k}: no shipped English default`);
  }
  for (const r of prod.filter((x) => x.locale === 'en')) if (defs[r.key] !== r.value) out.K1.push(`${r.key}/en differs from labelDefaults.en.json`);
  /* X1 */
  for (const r of prod) {
    const want = defs[r.key]; if (want === undefined) continue;
    if (JSON.stringify(phOf(r.value)) !== JSON.stringify(phOf(want)) || /[｛｝]/.test(r.value) || /[{}]/.test(r.value.replace(/\{\w+\}/g, ''))) out.X1.push(`${r.key}/${r.locale}: ${JSON.stringify(phOf(r.value))} vs English ${JSON.stringify(phOf(want))}`);
    const vars = KEY_VARS[r.key] ?? [];
    if (JSON.stringify(phOf(r.value)) !== JSON.stringify([...vars].sort())) out.X1.push(`${r.key}/${r.locale}: placeholders ${JSON.stringify(phOf(r.value))} but the code passes ${JSON.stringify(vars)}`);
  }
  /* L1 */
  for (const r of prod) if (LEGAL.includes(r.key) || /^(?:DISCLAIMER_SECTION_|PRIVACY_SECTION_|TERMS_SECTION_THIRD_PARTY)/.test(r.key)) out.L1.push(`${r.key}/${r.locale}`);
  /* V1 */
  for (const r of prod) if (VENDOR.test(r.value) || VENDOR.test(r.key.replace(/_/g, ' '))) out.V1.push(`${r.key}/${r.locale}`);
  /* H3 */
  for (const r of prod) if (r.value.trim() === '' || r.value !== r.value.trim() || /[\n\t]/.test(r.value)) out.H3.push(`${r.key}/${r.locale}: ${JSON.stringify(r.value)}`);
  /* H4 */
  for (const r of prod) {
    if (!(NON_ENGLISH as readonly string[]).includes(r.locale)) continue;
    if (!(r.key in EQUAL_OK) && defs[r.key] !== undefined && r.value.trim().toLowerCase() === defs[r.key].trim().toLowerCase()) out.H4.push(`${r.key}/${r.locale}: "${r.value}" equals the English`);
    const v = r.value.replace(/\{\w+\}/g, '');
    if (r.locale === 'ko' && !hangul.test(v)) out.H4.push(`${r.key}/ko: no Hangul`);
    if (r.locale === 'zh' && !han.test(v)) out.H4.push(`${r.key}/zh: no Han characters`);
    if (r.locale === 'ru' && !cyr.test(v)) out.H4.push(`${r.key}/ru: no Cyrillic`);
    if (r.locale === 'ko' && (han.test(v) || cyr.test(v) || kana.test(v))) out.H4.push(`${r.key}/ko: Han / Cyrillic / Kana in Korean`);
    if (r.locale === 'zh' && (hangul.test(v) || cyr.test(v) || kana.test(v))) out.H4.push(`${r.key}/zh: Hangul / Cyrillic / Kana in Chinese`);
    if (r.locale === 'ru' && (han.test(v) || hangul.test(v))) out.H4.push(`${r.key}/ru: Han / Hangul in Russian`);
  }
  /* H5: every row line is balanced and in the grammar */
  for (const [n, l] of stripSqlComments(raw.replace(/\r\n/g, '\n')).split('\n').entries()) if (l.startsWith("('") && ((l.match(/'/g) ?? []).length % 2 !== 0 || !ROW.test(l))) out.H5.push(`line ${n + 1}: ${l.slice(0, 70)}`);
  /* H6: additive only, held header naming both projects */
  const v = verbs(raw);
  if (JSON.stringify(v) !== JSON.stringify(['insert into lhq_labels', 'do update', 'insert into lhq_dev_labels', 'do update'])) out.H6.push(`statements: ${v.join(' | ')}`);
  if (!/^-- NOT YET APPLIED TO ANY DATABASE\./.test(raw)) out.H6.push('the held header is missing');
  if (!/qdpwhnvmhqgzijuwopso/.test(raw)) out.H6.push('the PROD project id is not named');
  if (!/wdtjhrilakoitfcezxpx/.test(raw)) out.H6.push('the DEV project id is not named');
  return out;
}
const MC = migChecks(RAW, DEF, LABEL_KEYS);
const PARSED = parseMigration(RAW);
const prod: Row[] = PARSED.blocks.find((b) => b.table === 'lhq_labels')?.rows ?? [];
const rowText = (l: Lang, k: string): string => { const r = prod.find((x) => x.key === k && x.locale === l); if (!r) throw new Error(`no ${l} row for ${k}`); return r.value; };
/** a label function over the migration's real rows for one language; throws on a missing row (a missing row must never read as text) */
type T = (k: string, v?: Record<string, string | number>) => string;
const tFor = (l: Lang): T => (k, v) => interpolate(rowText(l, k), v ?? {});
/** the recorder: the key, and the variables passed, as one string */
const recT: T = (k, v) => (v && Object.keys(v).length ? `${k}${JSON.stringify(v)}` : k);
/** plant a defect in the migration text; the named cell must then report something */
const plant = (from: string, to: string, why: string, cell: keyof typeof MC, keys: readonly string[] = LABEL_KEYS, defs: Record<string, string> = DEF) => {
  const n = RAW.split(from).length - 1; assert.ok(n === 1 || n === 2, `CONTROL: plant anchor must hit the PROD block (and its DEV twin), found ${n}: ${from}`);
  const out = migChecks(RAW.split(from).join(to), defs, keys); assert.ok(out[cell].length > 0, `CONTROL ${cell}: ${why}: not flagged`);
};

test('P1. the parser reads both blocks; 33 keys x en / ko / zh / ru = 132 rows each, one row per (key, language)', () => {
  assert.deepEqual(PARSED.violations, [], `lines outside the grammar:\n${PARSED.violations.join('\n')}`);
  assert.equal(NEW_KEYS.length, 33, 'CONTROL: the key list is the PR\'s 33 (10 accumulation + 12 absorption + 3 duration + 1 GEX + 5 session + 1 country + 1 trial)');
  assert.equal(NEW_KEYS.filter((k) => k.startsWith('ACCUMULATION_REASON_')).length, 10); assert.equal(NEW_KEYS.filter((k) => k.startsWith('ABSORPTION_')).length, 12); assert.equal(NEW_KEYS.filter((k) => k.startsWith('JOURNAL_SESSION_')).length, 5);
  assert.deepEqual(MC.P1, []);
  assert.deepEqual(PARSED.blocks.map((b) => b.table), ['lhq_labels', 'lhq_dev_labels']); assert.ok(PARSED.blocks.every((b) => b.closed));
  for (const b of PARSED.blocks) { assert.equal(b.rows.length, 132); for (const l of LANGS) assert.equal(b.rows.filter((r) => r.locale === l).length, 33, `${b.table}/${l}`); }
  /* CONTROLS */
  plant("('BRIEFING_DUR_H','ko','{h}시간'),\n", '', 'a dropped ko row (131 rows)', 'P1');
  plant("('GEX_TABLE_REGIME_WORD','ru','режим'),\n", "('GEX_TABLE_REGIME_WORD','ru','режим'),\n('GEX_TABLE_REGIME_WORD','ru','режим'),\n", 'a doubled (key, locale) row', 'P1');
  plant("('PLAN_BADGE_TRIAL_TITLE','zh','试用'),\n", "('PLAN_BADGE_TRIAL_TITLE','zh','试用'),\n('EXTRA_KEY_2741','zh','多'),\n", 'a 34th key', 'P1');
});
test('K1. rule (1): every key is registered once in LABEL_KEYS, has a shipped English default, its en row equals the default, and the code reads it', () => {
  assert.deepEqual(MC.K1, []);
  const src = ['AbsorptionDetector', 'AccumulationTracker', 'BriefingTerminal', 'GexTable', 'OnboardingFlow', 'PlanBadge', 'TradeJournal'].map((n) => read(`components/${n}.tsx`)).join('\n');
  for (const k of NEW_KEYS) assert.ok(src.includes(`'${k}'`), `${k}: no component reads it (a dead row)`);
  /* the other direction: a label-like literal of these families in the seven components that the migration does not carry */
  const used = [...new Set([...src.matchAll(/'((?:ACCUMULATION_REASON|ABSORPTION_(?:LABEL|DETAIL)|JOURNAL_SESSION|BRIEFING_DUR)_[A-Z_]+|GEX_TABLE_REGIME_WORD|ONBOARDING_FLOW_COUNTRY_OTHER|PLAN_BADGE_TRIAL_TITLE)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, [...NEW_KEYS].sort(), 'the keys the seven components read are not the 33 in the migration');
  /* CONTROLS */
  plant("('GEX_TABLE_REGIME_WORD','en','regime')", "('NO_SUCH_KEY_2741','en','regime')", 'an unregistered, default-less key', 'K1');
  const dropped = (LABEL_KEYS as readonly string[]).filter((k) => k !== 'JOURNAL_SESSION_ASIA');
  plant("('PLAN_BADGE_TRIAL_TITLE','ru','Пробный период')", "('PLAN_BADGE_TRIAL_TITLE','ru','Пробный период')", 'a key dropped from LABEL_KEYS', 'K1', dropped.filter((k) => k !== 'PLAN_BADGE_TRIAL_TITLE'));
  const noDef = { ...DEF }; delete noDef.ABSORPTION_LABEL_WEAK; assert.ok(migChecks(RAW, noDef, LABEL_KEYS).K1.length, 'CONTROL K1: a key dropped from the defaults');
  plant("('ABSORPTION_LABEL_WEAK','en','Weak')", "('ABSORPTION_LABEL_WEAK','en','Weak.')", 'an en row that differs from the default', 'K1');
});
test('X1. rule (1): each value has the same {placeholder} multiset as English and as the variables the code passes', () => {
  assert.deepEqual(MC.X1, []);
  assert.ok(prod.filter((r) => /\{\w+\}/.test(r.value) && r.locale !== 'en').length >= 3 * 13, 'CONTROL: every language carries the 13 placeholder keys, or the check is near-vacuous');
  /* CONTROLS: dropped, renamed, duplicated, extra, full-width, unbalanced, and one where English has none */
  plant("('ABSORPTION_DETAIL_FIB','ko','{level} 피보나치 ({price}) 부근')", "('ABSORPTION_DETAIL_FIB','ko','{level} 피보나치 부근')", 'a DROPPED placeholder', 'X1');
  plant("('ACCUMULATION_REASON_TAKER','ru','Тейкеры покупают: {n}%')", "('ACCUMULATION_REASON_TAKER','ru','Тейкеры покупают: {count}%')", 'a RENAMED placeholder', 'X1');
  plant("('BRIEFING_DUR_H','zh','{h} 小时')", "('BRIEFING_DUR_H','zh','{h} {h} 小时')", 'a DUPLICATED placeholder', 'X1');
  plant("('BRIEFING_DUR_MIN','ko','{m}분')", "('BRIEFING_DUR_MIN','ko','{m}분 {s}')", 'an EXTRA placeholder', 'X1');
  plant("('ACCUMULATION_REASON_VOL','zh','成交量 {x} 倍')", "('ACCUMULATION_REASON_VOL','zh','成交量 ｛x｝ 倍')", 'a FULL-WIDTH brace', 'X1');
  plant("('BRIEFING_DUR_HM','ru','{h} ч {m} мин')", "('BRIEFING_DUR_HM','ru','{h} ч {m мин')", 'an UNBALANCED brace', 'X1');
  plant("('GEX_TABLE_REGIME_WORD','ko','국면')", "('GEX_TABLE_REGIME_WORD','ko','국면 {x}')", 'a placeholder where English has none', 'X1');
  assert.deepEqual(migChecks(RAW.replace("('BRIEFING_DUR_HM','ko','{h}시간 {m}분')", () => "('BRIEFING_DUR_HM','ko','{m}분 {h}시간')"), DEF, LABEL_KEYS).X1, [], 'order may differ: the SET is what is pinned');
});
test('L1. rule (1): the four legal strings (and every legal-adjacent key) are absent from the migration, still registered, and the set is re-derived', () => {
  const named = Object.keys(DEF).filter((k) => /\bxAI\b|\bGrok\b|\bOpenAI\b/.test(DEF[k])).sort();
  assert.deepEqual(named, [...LEGAL].sort(), 'the keys whose English default names the AI processor are not the four OWNER-RULES section 5 names: update the list WITH the owner rule');
  assert.deepEqual(MC.L1, []);
  for (const k of LEGAL) assert.ok((LABEL_KEYS as readonly string[]).includes(k), `${k} must still be registered`);
  plant("('PLAN_BADGE_TRIAL_TITLE','ko','체험')", "('PLAN_BADGE_TRIAL_TITLE','ko','체험'),\n('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','x')", 'a row for a legal key', 'L1');
  plant("('PLAN_BADGE_TRIAL_TITLE','ko','체험')", "('PLAN_BADGE_TRIAL_TITLE','ko','체험'),\n('DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY','ru','x')", 'the fourth (xAI trademark notice) is the one a tidy-up forgets', 'L1');
});
test('V1. rule (1): no AI vendor or model name in any value or key (the product UI says "AI")', () => {
  assert.deepEqual(MC.V1, []);
  for (const bad of ['Powered by Grok', 'xAI модель', 'OpenAI 提供', 'Claude가 분석', 'GPT-4 read', 'Gemini', 'Anthropic']) plant("('GEX_TABLE_REGIME_WORD','ko','국면')", `('GEX_TABLE_REGIME_WORD','ko','${bad}')`, `"${bad}" in a value`, 'V1');
  plant("('GEX_TABLE_REGIME_WORD','ko','국면')", "('GEX_GROK_WORD','ko','국면')", 'a vendor in the KEY', 'V1');
  assert.deepEqual(migChecks(RAW.replace("'국면')", () => "'AI 국면')"), DEF, LABEL_KEYS).V1, [], '"AI" alone is the house word');
});
test('H1. statement shape: header, rows, a comma on every row but the last, the exact ON CONFLICT line (the neighbour 20261128b is the pattern)', () => {
  assert.deepEqual(MC.H1, []);
  const nb = read(`supabase/migrations/${NEIGHBOUR}`);
  assert.ok(nb.includes('insert into lhq_labels (key, locale, value) values\n') && nb.includes('insert into lhq_dev_labels (key, locale, value) values\n') && nb.includes(CONFLICT), 'CONTROL: the neighbour no longer has the lines this file is compared against');
  plant("('GEX_TABLE_REGIME_WORD','en','regime'),", "('GEX_TABLE_REGIME_WORD','en','regime')", 'a missing comma between rows', 'H1');
  plant(`('PLAN_BADGE_TRIAL_TITLE','ru','Пробный период')\n${CONFLICT}\n\n-- ===================== DEV`, `('PLAN_BADGE_TRIAL_TITLE','ru','Пробный период'),\n${CONFLICT}\n\n-- ===================== DEV`, 'a trailing comma before on conflict', 'H1');
  plant('do update set value = excluded.value, updated_at = now();\n\n-- ===================== DEV', 'do nothing;\n\n-- ===================== DEV', 'a different conflict action (do nothing leaves stale rows)', 'H1');
  plant("('GEX_TABLE_REGIME_WORD','en','regime')", "('gex_table_regime_word','en','regime')", 'a lower-case key', 'H1');
  plant("('GEX_TABLE_REGIME_WORD','en','regime')", "('GEX_TABLE_REGIME_WORD','xx','regime')", 'a locale outside en / ko / zh / ru', 'H1');
  assert.ok(migChecks(RAW + '\ndelete from lhq_labels;\n', DEF, LABEL_KEYS).H1.length, 'CONTROL H1: a stray statement outside a block');
});
test('H2. PROD block == DEV block row for row; no (key, locale) twice inside a block', () => {
  assert.deepEqual(MC.H2, []);
  const devStart = RAW.indexOf('insert into lhq_dev_labels'); assert.ok(devStart > 0, 'CONTROL: the DEV block was not found');
  const devPart = RAW.slice(devStart); const from = "('JOURNAL_SESSION_ASIA','ko','아시아')"; assert.equal(devPart.split(from).length, 2);
  assert.ok(migChecks(RAW.slice(0, devStart) + devPart.replace(from, () => "('JOURNAL_SESSION_ASIA','ko','아시아 ')"), DEF, LABEL_KEYS).H2.length, 'CONTROL H2: a drifted DEV row');
  assert.ok(migChecks(RAW.slice(0, devStart) + devPart.replace(from, () => `${from},\n${from}`), DEF, LABEL_KEYS).H2.length, 'CONTROL H2: a duplicated (key, locale) in DEV (Postgres: ON CONFLICT DO UPDATE cannot affect row a second time)');
});
test('H3. no empty, blank or padded value', () => {
  assert.deepEqual(MC.H3, []);
  plant("('PLAN_BADGE_TRIAL_TITLE','ko','체험')", "('PLAN_BADGE_TRIAL_TITLE','ko','')", 'empty', 'H3'); plant("('PLAN_BADGE_TRIAL_TITLE','ko','체험')", "('PLAN_BADGE_TRIAL_TITLE','ko','   ')", 'blank', 'H3'); plant("('PLAN_BADGE_TRIAL_TITLE','ko','체험')", "('PLAN_BADGE_TRIAL_TITLE','ko',' 체험')", 'padded', 'H3');
});
test('H4. no ko / zh / ru value equals the English default; each is in its own script', () => {
  assert.deepEqual(MC.H4, []);
  assert.deepEqual(Object.keys(EQUAL_OK), [], 'no named exception today: a proper noun added to EQUAL_OK must say why');
  plant("('JOURNAL_SESSION_LONDON','ko','런던')", "('JOURNAL_SESSION_LONDON','ko','London')", 'an untranslated value equal to the English', 'H4');
  plant("('JOURNAL_SESSION_LONDON','ru','Лондон')", "('JOURNAL_SESSION_LONDON','ru','LONDON')", 'equal ignoring case', 'H4');
  plant("('GEX_TABLE_REGIME_WORD','ko','국면')", "('GEX_TABLE_REGIME_WORD','ko','phase')", 'Korean with no Hangul', 'H4'); plant("('GEX_TABLE_REGIME_WORD','ru','режим')", "('GEX_TABLE_REGIME_WORD','ru','机制')", 'Russian with Han', 'H4');
  plant("('GEX_TABLE_REGIME_WORD','zh','格局')", "('GEX_TABLE_REGIME_WORD','zh','국면')", 'Chinese with Hangul', 'H4'); plant("('GEX_TABLE_REGIME_WORD','ko','국면')", "('GEX_TABLE_REGIME_WORD','ko','국면 格局')", 'Han mixed into Korean', 'H4');
  assert.deepEqual(migChecks(RAW.replace("('JOURNAL_SESSION_LONDON','en','London')", () => "('JOURNAL_SESSION_LONDON','en','London')"), DEF, LABEL_KEYS).H4, [], 'the en rows are not subject to it');
});
test('H5. quotes: every row line balanced, only doubled quotes inside a value', () => {
  assert.deepEqual(MC.H5, []);
  plant("('PLAN_BADGE_TRIAL_TITLE','en','Trial')", "('PLAN_BADGE_TRIAL_TITLE','en','Tri'al')", 'an unescaped apostrophe', 'H5');
  plant("('PLAN_BADGE_TRIAL_TITLE','en','Trial')", "('PLAN_BADGE_TRIAL_TITLE','en','Trial),", 'an unclosed literal', 'H5');
  assert.deepEqual(migChecks(RAW.replace("('PLAN_BADGE_TRIAL_TITLE','en','Trial')", () => "('PLAN_BADGE_TRIAL_TITLE','en','Tri''al')"), DEF, LABEL_KEYS).H5, [], 'the escaped form is clean');
  assert.equal(prod.filter((r) => /'/.test(r.value)).length, 0, 'no value carries an apostrophe today (nothing to mis-escape)');
});
test('H6. additive only: the statements are the two inserts with do update; the held header names both projects', () => {
  assert.deepEqual(MC.H6, []);
  assert.deepEqual(verbs(RAW), ['insert into lhq_labels', 'do update', 'insert into lhq_dev_labels', 'do update']);
  const nb = read(`supabase/migrations/${NEIGHBOUR}`); assert.equal(RAW.split('\n')[0].slice(0, 160), nb.split('\n')[0].slice(0, 160), 'the held header is not the neighbour\'s');
  assert.ok(migChecks(RAW + "\ndelete from lhq_labels where locale = 'ko';", DEF, LABEL_KEYS).H6.length, 'CONTROL H6: a DELETE');
  assert.ok(migChecks(RAW + "\nupdate profiles set role = 'admin';", DEF, LABEL_KEYS).H6.length, 'CONTROL H6: an UPDATE of another table');
  assert.ok(migChecks(RAW + '\ndrop table lhq_labels;', DEF, LABEL_KEYS).H6.length, 'CONTROL H6: DROP'); assert.ok(migChecks(RAW + '\nalter table lhq_labels add column x int;', DEF, LABEL_KEYS).H6.length, 'CONTROL H6: ALTER');
  assert.ok(migChecks(RAW.replace('-- NOT YET APPLIED TO ANY DATABASE.', () => '-- Applied.'), DEF, LABEL_KEYS).H6.length, 'CONTROL H6: the held header removed');
  assert.deepEqual(verbs("-- delete from x;\ninsert into lhq_labels (key, locale, value) values ('K','ko','delete from x; drop table y');"), ['insert into lhq_labels'], 'a verb in a comment or inside a value is not a statement');
});

/* ═════════════════════════ A. AbsorptionDetector: label / detail / near-level ═════════════════════════ */
const ABS = read('components/AbsorptionDetector.tsx');
const ARENA = read('app/(main)/arena/page.tsx');
type AbsFns = { ABS_LABEL_KEYS: Record<string, string>; absText: (s: string, t: T) => string; absPart: (s: string, t: T) => string; labelOf: (t: T, label: string) => string };
/** the REAL mapping, label expression and text functions cut out of the component source (a mutated source gives a mutated function) */
function absBuild(src: string): AbsFns {
  const code = cutBetween(src, 'const ABS_LABEL_KEYS', 'export default function AbsorptionDetector');
  const o = load<{ ABS_LABEL_KEYS: Record<string, string>; absText: AbsFns['absText']; absPart: AbsFns['absPart'] }>(`${code}\nconst __x = { ABS_LABEL_KEYS, absText, absPart };`, '__x');
  const line = lineOf(src, 'className="abs-label"'); const m = />\{(.*)\}<\/span>\s*$/.exec(line); assert.ok(m, 'CONTROL: the abs-label expression was not found');
  const f = expr(m![1], ['ABS_LABEL_KEYS', 't', 'd']);
  return { ...o, labelOf: (t, label) => f(o.ABS_LABEL_KEYS, t, { label }) as string };
}
/* [English as the analyzer writes it, the keys + variables it routes to, text per language]; the English column is the producer's own format (pinned against the source in A3) */
type AbsCase = { id: string; en: string; routed: string; text: Record<'ko' | 'zh' | 'ru', string> };
const ABS_CASES: AbsCase[] = [
  { id: 'candles under an hour', en: '3 candles (~45m)', routed: 'ABSORPTION_DETAIL_CANDLES{"n":"3","t":"45m"}', text: { ko: '캔들 3개 (약 45m)', zh: '3 根 K 线（约 45m）', ru: '3 свечей (~45m)' } },
  { id: 'avg volume', en: '1.8× avg vol', routed: 'ABSORPTION_DETAIL_AVG_VOL{"x":"1.8"}', text: { ko: '평균 거래량의 1.8배', zh: '平均成交量的 1.8 倍', ru: '1.8× среднего объёма' } },
  { id: 'all four parts', en: '5 candles (~1h 15m) · 2.1× avg vol · CVD ✓ · 1H ✓', routed: 'ABSORPTION_DETAIL_CANDLES{"n":"5","t":"1h 15m"} · ABSORPTION_DETAIL_AVG_VOL{"x":"2.1"} · CVD ✓ · 1H ✓', text: { ko: '캔들 5개 (약 1h 15m) · 평균 거래량의 2.1배 · CVD ✓ · 1H ✓', zh: '5 根 K 线（约 1h 15m） · 平均成交量的 2.1 倍 · CVD ✓ · 1H ✓', ru: '5 свечей (~1h 15m) · 2.1× среднего объёма · CVD ✓ · 1H ✓' } },
  { id: 'low activity', en: 'Low absorption activity', routed: 'ABSORPTION_DETAIL_LOW', text: { ko: '흡수 활동 낮음', zh: '吸收活动较低', ru: 'Низкая активность поглощения' } },
  { id: 'bid wall, at', en: 'at $104,200 bid wall', routed: 'ABSORPTION_DETAIL_BID_AT{"price":"$104,200"}', text: { ko: '$104,200 매수 호가벽', zh: '$104,200 买盘墙', ru: 'у $104,200: стена на покупку' } },
  { id: 'ask wall, at', en: 'at $104,200 ask wall', routed: 'ABSORPTION_DETAIL_ASK_AT{"price":"$104,200"}', text: { ko: '$104,200 매도 호가벽', zh: '$104,200 卖盘墙', ru: 'у $104,200: стена на продажу' } },
  { id: 'bid wall, from (a many-decimal price)', en: '0.35% from $0.0000123 bid wall', routed: 'ABSORPTION_DETAIL_BID_FROM{"pct":"0.35","price":"$0.0000123"}', text: { ko: '$0.0000123 매수 호가벽에서 0.35%', zh: '距 $0.0000123 买盘墙 0.35%', ru: '0.35% до $0.0000123: стена на покупку' } },
  { id: 'ask wall, from', en: '0.72% from $2.31 ask wall', routed: 'ABSORPTION_DETAIL_ASK_FROM{"pct":"0.72","price":"$2.31"}', text: { ko: '$2.31 매도 호가벽에서 0.72%', zh: '距 $2.31 卖盘墙 0.72%', ru: '0.72% до $2.31: стена на продажу' } },
  { id: 'fib level', en: 'at 61.8% fib ($97,400)', routed: 'ABSORPTION_DETAIL_FIB{"level":"61.8%","price":"$97,400"}', text: { ko: '61.8% 피보나치 ($97,400) 부근', zh: '位于 61.8% 斐波那契（$97,400）', ru: 'у уровня Фибоначчи 61.8% ($97,400)' } },
];
const ABS_LABELS: Array<[string, string, string, string, string]> = [
  ['Strong', 'ABSORPTION_LABEL_STRONG', '강함', '强', 'Сильное'], ['Moderate', 'ABSORPTION_LABEL_MODERATE', '보통', '中等', 'Умеренное'],
  ['Weak', 'ABSORPTION_LABEL_WEAK', '약함', '弱', 'Слабое'], ['None', 'ABSORPTION_LABEL_NONE', '없음', '无', 'Нет'],
];
/** violations of rule (2) by the real mapping: routing, English unchanged, per-language text, fallbacks */
function absViolations(f: AbsFns): string[] {
  const v: string[] = [];
  for (const [label, key, ko, zh, ru] of ABS_LABELS) {
    const got = f.labelOf(recT, label); if (got !== key) v.push(`label ${label}: routes ${got}, expected ${key}`);
    if (f.labelOf(tFor('en'), label) !== label) v.push(`label ${label}: English reads "${f.labelOf(tFor('en'), label)}", not "${label}"`);
    for (const [l, want] of [['ko', ko], ['zh', zh], ['ru', ru]] as const) { const txt = f.labelOf(tFor(l), label); if (txt !== want) v.push(`label ${label} [${l}]: "${txt}", expected "${want}"`); }
  }
  let called = 0; const spy: T = (k) => { called++; return k; };
  if (f.labelOf(spy, 'Extreme') !== 'Extreme' || called) v.push('an unknown label did not fall back to the English text (or called t)');
  for (const c of ABS_CASES) {
    const routed = f.absText(c.en, recT); if (routed !== c.routed) v.push(`${c.id}: routes ${routed}, expected ${c.routed}`);
    const en = f.absText(c.en, tFor('en')); if (en !== c.en) v.push(`${c.id} [en]: "${en}" is not the producer's own string "${c.en}"`);
    for (const l of NON_ENGLISH) { const txt = f.absText(c.en, tFor(l)); if (txt !== c.text[l]) v.push(`${c.id} [${l}]: "${txt}", expected "${c.text[l]}"`); if (/[{}]/.test(txt)) v.push(`${c.id} [${l}]: a placeholder survived: ${txt}`); }
  }
  for (const s of ['CVD ✓', '1H ✓', 'Insufficient data', '', 'something else']) { called = 0; if (f.absText(s, spy) !== s || called) v.push(`an unmatched part "${s}" changed or called t`); }
  return v;
}
test('A1. rule (2): every English label maps to a key; an unknown label falls back to the English text; None still compares as before; in en / ko / zh / ru', () => {
  const f = absBuild(ABS);
  assert.deepEqual(absViolations(f), []);
  /* the label set is re-derived three ways: the type union, the analyzer's ternary, the mapping's own keys */
  const union = [...(/label:\s+((?:'[A-Za-z]+'\s*\|?\s*)+);/.exec(ABS)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
  const tern = [...cutBetween(ABS, "const label: AbsorptionData['label'] =", 'const type =').matchAll(/\? '([A-Za-z]+)'|: '([A-Za-z]+)'/g)].map((m) => m[1] ?? m[2]).sort();
  assert.deepEqual(union, ['Moderate', 'None', 'Strong', 'Weak']); assert.deepEqual(tern, union); assert.deepEqual(Object.keys(f.ABS_LABEL_KEYS).sort(), union);
  for (const [label, key] of ABS_LABELS) { assert.ok((LABEL_KEYS as readonly string[]).includes(key)); assert.equal(f.ABS_LABEL_KEYS[label], key); assert.equal(DEF[key], label, `${key}: the English default is not the word the analyzer writes, so English would change`); }
  /* the compare: the component still tests the ENGLISH word, not the translated one */
  assert.ok(ABS.includes("{d.label !== 'None' && d.detail && ("), "the detail line is no longer gated on d.label !== 'None'");
  assert.doesNotMatch(ABS, /t\(ABS_LABEL_KEYS\[d\.label\]\)\s*[!=]==/, 'a compare against the translated label');
});
test('A2. rule (2): the detail line and the near-level line, REAL absText on literal inputs: routing, English round-trip, ko / zh / ru text', () => {
  const f = absBuild(ABS);
  assert.deepEqual(absViolations(f), []);
  assert.equal(ABS_CASES.length, 9);
  /* the near-level and the detail both go through absText, each part split on " · " */
  assert.ok(ABS.includes('{absText(d.detail, t)}') && ABS.includes('{absText(d.nearLevel, t)}'), 'the detail / near-level lines do not read absText');
  assert.equal(callArgs(ABS, 'absText').filter((a) => a[0] === 'd.detail' || a[0] === 'd.nearLevel').length, 2);
  /* every placeholder variable the real function passes is the name in the rows (the recorder names them) */
  const names = new Set(ABS_CASES.flatMap((c) => [...c.routed.matchAll(/([A-Z_]+)(\{[^}]*\})?/g)].filter((m) => m[1].startsWith('ABSORPTION_DETAIL_')).map((m) => `${m[1]}:${Object.keys(m[2] ? JSON.parse(m[2]) : {}).sort()}`)));
  for (const n of names) { const [k, vs] = n.split(':'); assert.deepEqual((KEY_VARS[k] ?? []).slice().sort().join(','), vs, `${k}: variables passed vs KEY_VARS`); }
  assert.equal(names.size, 8, 'all eight detail keys are exercised');
});
test('A1-A2 CONTROLS. a mapping that swaps two labels, swaps bid / ask, drops a branch, reverts to English or loses the fallback is flagged by the same checker', () => {
  assert.deepEqual(absViolations(absBuild(ABS)), [], 'CONTROL: the real source passes');
  const m = (from: string, to: string, why: string) => { assert.equal(ABS.split(from).length, 2, `CONTROL: mutation anchor not unique: ${from}`); assert.ok(absViolations(absBuild(ABS.replace(from, () => to))).length > 0, `${why}: not flagged`); };
  m("Strong: 'ABSORPTION_LABEL_STRONG', Moderate: 'ABSORPTION_LABEL_MODERATE'", "Strong: 'ABSORPTION_LABEL_MODERATE', Moderate: 'ABSORPTION_LABEL_STRONG'", 'two labels swapped');
  m("None: 'ABSORPTION_LABEL_NONE' }", "None: 'ABSORPTION_LABEL_WEAK' }", 'None routed to Weak');
  m("t(m[2] === 'bid' ? 'ABSORPTION_DETAIL_BID_AT' : 'ABSORPTION_DETAIL_ASK_AT'", "t(m[2] === 'bid' ? 'ABSORPTION_DETAIL_ASK_AT' : 'ABSORPTION_DETAIL_BID_AT'", 'bid / ask swapped (at)');
  m("{ pct: m[1], price: m[2] }", "{ pct: m[2], price: m[1] }", 'pct / price swapped');
  m("if (p === 'Low absorption activity') return t('ABSORPTION_DETAIL_LOW');", '', 'the low-activity branch dropped');
  m("{ n: m[1], t: m[2] }", "{ n: m[1] }", 'the candles time variable dropped');
  m("t('ABSORPTION_DETAIL_AVG_VOL', { x: m[1] })", "`${m[1]}× avg vol`", 'average volume reverts to English');
  m("s.split(' · ').map(p => absPart(p, t)).join(' · ')", "absPart(s, t)", 'absText stops splitting the parts');
  m(": d.label}", ": ''}", 'the unknown-label fallback lost');
  m("{ABS_LABEL_KEYS[d.label] ? t(ABS_LABEL_KEYS[d.label]) : d.label}", "{d.label}", 'the label reads English again');
});
/** rule (2), the other half: d.label / d.detail / d.nearLevel are produced in English by analyze() and handed on untouched */
function a3Violations(abs: string, arena: string, grok: string): string[] {
  const v: string[] = [];
  const analyze = cutBetween(abs, 'function analyze(', '/* ── Component ── */');
  if (/\bt\(\s*['"`]/.test(analyze) || /useLabels/.test(analyze)) v.push('analyze() calls a label function: d.label / d.detail would be translated at the source');
  const need = (hay: string, s: string, why: string) => { if (!hay.includes(s)) v.push(`${why}: not found: ${s.slice(0, 70)}`); };
  need(analyze, "score >= 70 ? 'Strong' :\n    score >= 45 ? 'Moderate' :\n    score >= 20 ? 'Weak' : 'None'", 'the English label ladder');
  need(analyze, "detail: parts.join(' · ') || 'Low absorption activity',", 'the English detail line');
  need(analyze, "detail: 'Insufficient data'", 'the empty-state detail');
  /* the PRODUCER formats the display functions parse (A2's English column): if a producer text changes, absPart silently stops matching */
  need(analyze, "nearLevel = `${d < 0.1 ? 'at' : d.toFixed(2) + '% from'} ${priceText(w.price)} ${side} wall`;", 'the wall near-level template');
  need(analyze, "nearLevel = `at ${near.label} fib (${priceText(near.price)})`;", 'the fib near-level template');
  need(analyze, "parts.push(`${duration} candles (~${tStr})`);", 'the candles part'); need(analyze, "parts.push(`${avgVR.toFixed(1)}× avg vol`);", 'the volume part');
  need(analyze, "parts.push('CVD ✓');", 'the CVD part'); need(analyze, "parts.push('1H ✓');", 'the 1H part'); need(analyze, "checkW(bidWalls, 'bid');", 'the bid side word'); need(analyze, "checkW(askWalls, 'ask');", 'the ask side word');
  /* the component hands the raw result on, and never writes into it */
  need(abs, 'setData(result);\n      cbRef.current?.(result);', 'the raw result goes to state and to onData');
  if (/\bd\.(?:label|detail|nearLevel)\s*=[^=]/.test(abs) || /\bresult\.(?:label|detail|nearLevel)\s*=[^=]/.test(abs)) v.push('the component assigns into the result');
  /* the AI prompt: the real expression from the arena page, run on literal data */
  const a = arena.indexOf('absorptionScore: (() => {'); const b = arena.indexOf('})(),', a);
  if (a < 0 || b < a) { v.push('the absorptionScore prompt expression was not found'); return v; }
  const iife = arena.slice(a + 'absorptionScore: '.length, b + 4); const run = expr(iife, ['absDataRef']);
  const ab = (o: Record<string, unknown>) => run({ current: o }) as string;
  const base = { score: 75, label: 'Strong', type: 'accumulation', duration: 3, durationMin: 45, nearLevel: 'at $104,200 bid wall', detail: 'x', mtfConfirmed: true };
  const want: Array<[string, unknown, string]> = [
    ['all parts', base, 'Strong ACCUMULATION (75/100) · 3 candles (~45m) · at $104,200 bid wall · 1H CONFIRMED'],
    ['None', { ...base, label: 'None' }, 'None'], ['null data', null, 'None'],
    ['distribution, no extras', { ...base, label: 'Weak', type: 'distribution', score: 22, duration: 0, durationMin: 0, nearLevel: null, mtfConfirmed: false }, 'Weak DISTRIBUTION (22/100)'],
    ['an hour and a half', { ...base, duration: 6, durationMin: 90, nearLevel: null, mtfConfirmed: false }, 'Strong ACCUMULATION (75/100) · 6 candles (~1h 30m)'],
  ];
  for (const [id, data, w] of want) { let got = ''; try { got = ab(data as Record<string, unknown>); } catch (e) { got = `threw ${(e as Error).message}`; } if (got !== w) v.push(`prompt (${id}): "${got}", expected "${w}"`); }
  if (/\bab\.detail\b/.test(iife)) v.push('the prompt now reads ab.detail: rule (2) must then be re-read, the detail would need to stay English there');
  if (!grok.includes('`Absorption Detector (15M):  ${ctx.absorptionScore}`')) v.push('the prompt line that carries absorptionScore moved');
  return v;
}
test('A3. rule (2): d.label / d.detail / d.nearLevel stay English at the source, the raw result goes on, and the REAL prompt expression gives the old string', () => {
  assert.deepEqual(a3Violations(ABS, ARENA, read('lib/grok.ts')), []);
  /* PREMISE: the PR says d.detail feeds the AI prompt. In the source the prompt reads label, type, score, duration, durationMin, nearLevel and mtfConfirmed; detail is read only by the screen. Named so a future reader of ab.detail turns this red on purpose. */
  assert.equal(/\bab\.detail\b/.test(ARENA), false, 'something now reads ab.detail in the arena page');
  assert.ok(ARENA.includes("if (!ab || ab.label === 'None') return 'None';"), "the prompt's None compare is no longer on the English word");
});
test('A3 CONTROLS. a translated label at the source, a changed English string, a dropped raw hand-off, a written-into result and a prompt that reads the translation are flagged', () => {
  const grok = read('lib/grok.ts'); assert.deepEqual(a3Violations(ABS, ARENA, grok), [], 'CONTROL: the real files pass');
  const mA = (from: string, to: string, why: string) => { assert.equal(ABS.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(a3Violations(ABS.replace(from, () => to), ARENA, grok).length > 0, `${why}: not flagged`); };
  const mR = (from: string, to: string, why: string) => { assert.equal(ARENA.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(a3Violations(ABS, ARENA.replace(from, () => to), grok).length > 0, `${why}: not flagged`); };
  mA("score >= 70 ? 'Strong' :", "score >= 70 ? t('ABSORPTION_LABEL_STRONG') :", 'a translated label in analyze');
  mA("|| 'Low absorption activity',", "|| 'Low activity',", 'the English detail text changed (absPart would stop matching)');
  mA("parts.push(`${avgVR.toFixed(1)}× avg vol`);", "parts.push(`${avgVR.toFixed(1)}x average volume`);", 'a producer text the display regex does not know');
  mA("cbRef.current?.(result);", "cbRef.current?.(null);", 'the raw result no longer reaches onData');
  mA("setData(result);", "result.label = 'x'; setData(result);", 'a written-into result');
  mR("if (!ab || ab.label === 'None') return 'None';", "if (!ab || ab.label === '없음') return 'None';", 'the prompt compares a translation');
  mR("if (ab.nearLevel) s += ` · ${ab.nearLevel}`;", "if (ab.nearLevel) s += ` · ${ab.detail}`;", 'the prompt reads the detail');
  mR("ab.type === 'accumulation' ? 'ACCUMULATION'", "ab.type === 'accumulation' ? 'ACCUMULATING'", 'the prompt string changed');
});

/* ═════════════════════════ AC. AccumulationTracker chips ═════════════════════════ */
const ACC = read('components/AccumulationTracker.tsx');
type AccFns = { REASON_KEYS: Record<string, string>; reasonText: (r: string, t: T) => string };
function accBuild(src: string): AccFns { return load<AccFns>(`${cutBetween(src, 'const REASON_KEYS', 'const MIN_SCORE')}\nconst __x = { REASON_KEYS, reasonText };`, '__x'); }
/** the reasons scoreCoin can push, as shapes read off the source (a pushed literal or template) and filled with sample numbers */
function producedReasons(src: string): string[] {
  const body = cutBetween(src, 'function scoreCoin(', 'const REASON_KEYS');
  return [...new Set([...body.matchAll(/reasons\.push\((['`])(.*?)\1\)/g)].map((m) => m[2].replace(/\$\{[^}]*volRatio[^}]*\}/, '1.8').replace(/\$\{[^}]*\}/g, '62')))];
}
const ACC_CASES: Array<[string, string, string, string, string, string]> = [
  ['Price flat', 'ACCUMULATION_REASON_PRICE_FLAT', '가격 횡보', '价格持平', 'Цена стоит', ''], ['Price quiet', 'ACCUMULATION_REASON_PRICE_QUIET', '가격 잠잠', '价格平静', 'Цена спокойна', ''],
  ['CVD absorption', 'ACCUMULATION_REASON_CVD', 'CVD 흡수', 'CVD 吸收', 'Поглощение CVD', ''], ['OI building', 'ACCUMULATION_REASON_OI_BUILDING', 'OI 증가 중', '持仓量增加', 'OI растёт', ''],
  ['OI drifting up', 'ACCUMULATION_REASON_OI_DRIFTING', 'OI 완만히 증가', '持仓量缓慢上升', 'OI медленно растёт', ''], ['Funding calm', 'ACCUMULATION_REASON_FUNDING_CALM', '펀딩비 안정', '资金费率平稳', 'Фандинг спокоен', ''],
  ['Shorts paying', 'ACCUMULATION_REASON_SHORTS_PAYING', '숏이 지불', '空头支付', 'Шорты платят', ''],
  ['62% taker buys', 'ACCUMULATION_REASON_TAKER{"n":"62"}', '테이커 매수 62%', '主动买入 62%', 'Тейкеры покупают: 62%', ''], ['Whales 57% long', 'ACCUMULATION_REASON_WHALES{"n":"57"}', '고래 롱 57%', '巨鲸多头 57%', 'Киты в лонге: 57%', ''],
  ['Vol 1.8x', 'ACCUMULATION_REASON_VOL{"x":"1.8"}', '거래량 1.8배', '成交量 1.8 倍', 'Объём 1.8x', ''],
];
function accViolations(f: AccFns, produced: string[]): string[] {
  const v: string[] = [];
  for (const [en, routed, ko, zh, ru] of ACC_CASES) {
    if (f.reasonText(en, recT) !== routed) v.push(`${en}: routes ${f.reasonText(en, recT)}, expected ${routed}`);
    if (f.reasonText(en, tFor('en')) !== en) v.push(`${en} [en]: "${f.reasonText(en, tFor('en'))}" is not the English chip`);
    for (const [l, w] of [['ko', ko], ['zh', zh], ['ru', ru]] as const) { const txt = f.reasonText(en, tFor(l)); if (txt !== w) v.push(`${en} [${l}]: "${txt}", expected "${w}"`); }
  }
  /* every chip the scorer can produce is one the table covers (a new reason in scoreCoin with no mapping stays English in ko / zh / ru) */
  for (const p of produced) { if (!ACC_CASES.some(([en]) => en === p) && !ACC_CASES.some(([en]) => en.replace(/\d+(\.\d+)?/g, '#') === p.replace(/\d+(\.\d+)?/g, '#'))) v.push(`the scorer can push "${p}" and the table has no case for it`); if (f.reasonText(p, recT) === p) v.push(`"${p}" is produced and not translated`); }
  let called = 0; const spy: T = (k) => { called++; return k; }; if (f.reasonText('Brand new reason', spy) !== 'Brand new reason' || called) v.push('an unknown reason changed or called t');
  return v;
}
test('AC1. the scanner chips: REAL reasonText on every reason the scorer can push, en / ko / zh / ru; the row data keeps the English ids', () => {
  const f = accBuild(ACC); const produced = producedReasons(ACC);
  assert.equal(produced.length, 10, 'the scorer pushes ten distinct chip shapes (the taker / whales ones from two branches each)');
  assert.deepEqual(accViolations(f, produced), []);
  assert.deepEqual(Object.keys(f.REASON_KEYS).sort(), ['CVD absorption', 'Funding calm', 'OI building', 'OI drifting up', 'Price flat', 'Price quiet', 'Shorts paying']);
  /* PREMISE: the chips are keyed by the English id, and the row carries it; only the displayed text is translated */
  assert.ok(ACC.includes('key={reason}') && ACC.includes('{reasonText(reason, t)}') && ACC.includes('r.reasons.slice(0, 4)'), 'the chip loop is not key={reason} / reasonText(reason, t) over r.reasons');
  assert.equal(callArgs(ACC, 'reasonText').filter((a) => a.length === 2 && a[1] === 't').length, 1, 'reasonText must be called once, with t');
  assert.match(ACC, /id, score: Math\.min\(100, score\), price: d\.price, change: d\.change, reasons,/, 'the row no longer carries the English reasons array');
});
test('AC1 CONTROLS. a swapped key, a lost branch, a reverted chip and a new unmapped reason are flagged', () => {
  const produced = producedReasons(ACC); assert.deepEqual(accViolations(accBuild(ACC), produced), [], 'CONTROL: the real source passes');
  const m = (from: string, to: string, why: string, prod = produced) => { assert.equal(ACC.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(accViolations(accBuild(ACC.replace(from, () => to)), prod).length > 0, `${why}: not flagged`); };
  m("'Price flat': 'ACCUMULATION_REASON_PRICE_FLAT', 'Price quiet': 'ACCUMULATION_REASON_PRICE_QUIET'", "'Price flat': 'ACCUMULATION_REASON_PRICE_QUIET', 'Price quiet': 'ACCUMULATION_REASON_PRICE_FLAT'", 'flat / quiet swapped');
  m("t('ACCUMULATION_REASON_TAKER', { n: m[1] })", "t('ACCUMULATION_REASON_WHALES', { n: m[1] })", 'taker routed to whales');
  m("t('ACCUMULATION_REASON_VOL', { x: m[1] })", "`Vol ${m[1]}x`", 'volume chip reverts to English');
  m("m = reason.match(/^Whales (\\d+)% long$/);", "m = reason.match(/^Whale (\\d+)% long$/);", 'the whales pattern no longer matches');
  const extra = [...produced, 'Order flow bullish']; assert.ok(accViolations(accBuild(ACC), extra).length > 0, 'CONTROL AC1: a reason the scorer pushes with no mapping is flagged');
});

/* ═════════════════════════ C. onboarding COUNTRIES ═════════════════════════ */
const ONB = read('components/OnboardingFlow.tsx');
/* the English stored values, in order, as they were BEFORE the PR (git show origin/dev:components/OnboardingFlow.tsx): the stored value must not move */
const PRE_PR_NAMES = ['Argentina', 'Australia', 'Bangladesh', 'Brazil', 'Canada', 'China', 'Ethiopia', 'France', 'Germany', 'Ghana', 'India', 'Indonesia', 'Japan', 'Kenya', 'Malaysia', 'Mexico', 'Nigeria', 'Pakistan', 'Philippines', 'Russia', 'Singapore', 'South Africa', 'South Korea', 'Thailand', 'Turkey', 'UAE', 'Ukraine', 'United Kingdom', 'United States', 'Vietnam', 'Other'];
/* the two names where CLDR's English differs from the stored name: stored as before (the PR keeps them), listed so a third one is a failure */
const CLDR_EN_DIFFERS: Record<string, string> = { Turkey: 'Türkiye', UAE: 'United Arab Emirates' };
type Country = { flag: string; name: string; code?: string };
const flagOf = (code: string) => [...code].map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
const buildCountries = (src: string) => load<Country[]>(`${cutBetween(src, 'const COUNTRIES', '\n];')}\n];`, 'COUNTRIES');
type LabelFn = (c: Country) => string;
/** the REAL picker label function, cut from the component, over a given t / locale / Intl */
const buildLabel = (src: string, t: T, locale: string, intl: unknown = Intl): LabelFn => load<LabelFn>(cutBetween(src, 'const label = (c:', '\n  const [open'), 'label', { t, locale, Intl: intl });
const buildFilter = (src: string, label: LabelFn, countries: Country[]) => {
  const text = cutBetween(src, 'const filtered = ', ';\n').replace(/^const filtered = /, '');
  const f = expr(text, ['query', 'COUNTRIES', 'label']); return (query: string) => (f(query, countries, label) as Country[]).map((c) => c.name);
};
/* Intl.DisplayNames in THIS node (CLDR); the literals are the standard region names the PR says it uses */
const CLDR_SAMPLES: Array<[string, string, string, string, string]> = [
  ['South Korea', '대한민국', '韩国', 'Республика Корея', 'KR'], ['United States', '미국', '美国', 'Соединенные Штаты', 'US'], ['Japan', '일본', '日本', 'Япония', 'JP'],
  ['Germany', '독일', '德国', 'Германия', 'DE'], ['UAE', '아랍에미리트', '阿拉伯联合酋长国', 'ОАЭ', 'AE'], ['China', '중국', '中国', 'Китай', 'CN'],
];
/** violations of rule (3) by the picker source `src` */
function cViolations(src: string): string[] {
  const v: string[] = []; const C = buildCountries(src);
  if (JSON.stringify(C.map((c) => c.name)) !== JSON.stringify(PRE_PR_NAMES)) v.push(`the stored names changed: ${C.map((c) => c.name).join(',')}`);
  const withCode = C.filter((c) => c.code); const codes = withCode.map((c) => c.code);
  if (withCode.length !== 30 || new Set(codes).size !== 30) v.push(`${withCode.length} coded entries, ${new Set(codes).size} distinct codes (expected 30 / 30)`);
  const en = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const c of withCode) {
    if (!/^[A-Z]{2}$/.test(c.code!)) v.push(`${c.name}: code ${c.code} is not two capitals`);
    else {
      if (flagOf(c.code!) !== c.flag) v.push(`${c.name}: flag ${c.flag} is not the flag of code ${c.code}`);
      const cl = en.of(c.code!); if (cl !== c.name && CLDR_EN_DIFFERS[c.name] !== cl) v.push(`${c.name}: code ${c.code} is "${cl}" in CLDR English (a wrong code shows another country)`);
    }
  }
  const other = C[C.length - 1]; if (other?.name !== 'Other' || other.code !== undefined || other.flag !== '🌐') v.push('Other must be the last entry with no code');
  /* the label: en = the stored name; ko / zh / ru = the localized name from Intl, never the stored name */
  for (const [name, ko, zh, ru] of CLDR_SAMPLES) {
    const c = C.find((x) => x.name === name); if (!c) { v.push(`${name}: not in COUNTRIES`); continue; }
    if (buildLabel(src, tFor('en'), 'en')(c) !== name) v.push(`${name} [en]: not the English name`);
    for (const [l, want] of [['ko', ko], ['zh', zh], ['ru', ru]] as const) { const got = buildLabel(src, tFor(l), l)(c); if (got !== want) v.push(`${name} [${l}]: "${got}", expected "${want}"`); }
  }
  const o = C[C.length - 1]; for (const [l, want] of [['en', 'Other'], ['ko', '기타'], ['zh', '其他'], ['ru', 'Другая страна']] as const) { const got = buildLabel(src, tFor(l), l)(o); if (got !== want) v.push(`Other [${l}]: "${got}", expected "${want}"`); }
  /* fallbacks: an invalid locale tag and a runtime with no Intl.DisplayNames both give the English name, never a throw */
  for (const c of withCode.slice(0, 3)) {
    try { if (buildLabel(src, tFor('en'), 'not a locale!')(c) !== c.name) v.push(`${c.name}: an invalid locale tag did not fall back to English`); } catch (e) { v.push(`${c.name}: an invalid locale threw ${(e as Error).message}`); }
    try { if (buildLabel(src, tFor('en'), 'ko', {})(c) !== c.name) v.push(`${c.name}: no Intl.DisplayNames did not fall back to English`); } catch (e) { v.push(`${c.name}: no Intl.DisplayNames threw ${(e as Error).message}`); }
  }
  return v;
}
/** the stored / option value and the search, as written in the source and run on the real filter */
function c3Violations(src: string): string[] {
  const v: string[] = []; const need = (s: string, why: string) => { if (!src.includes(s)) v.push(`${why}: not found: ${s.slice(0, 80)}`); };
  need("onClick={() => { onChange(c.name); setOpen(false); triggerRef.current?.focus(); }}", 'the option stores the ENGLISH name');
  need('const isActive = value === c.name;', 'the active option is found by the stored name'); need('const selected = COUNTRIES.find(c => c.name === value);', 'the selected country is found by the stored name');
  need('<span style={{ flex: 1 }}>{label(c)}</span>', 'the option text is the label'); need('id="obw-country-value" style={{ overflow: \'hidden\', textOverflow: \'ellipsis\', whiteSpace: \'nowrap\' }}>{label(selected)}</span>', 'the chosen country shows the label');
  need('country:            country     || null,', 'the saved country is the stored state'); need('<CountrySelect value={country} onChange={setCountry} />', 'the picker writes the stored state');
  if (/onChange\(\s*label\(/.test(src) || /value=\{label\(/.test(src)) v.push('the stored / option value is the localized label');
  const C = buildCountries(src); const f = buildFilter(src, buildLabel(src, tFor('ko'), 'ko'), C); const fr = buildFilter(src, buildLabel(src, tFor('ru'), 'ru'), C); const fz = buildFilter(src, buildLabel(src, tFor('zh'), 'zh'), C);
  const eq = (a: string[], b: string[], id: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) v.push(`${id}: ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
  eq(f(''), C.map((c) => c.name), 'ko empty query = all'); eq(f('korea'), ['South Korea'], 'ko session, the English query "korea"'); eq(f('대한'), ['South Korea'], 'ko session, the Korean query');
  eq(fr('росс'), ['Russia'], 'ru session, the Russian query'); eq(fr('japan'), ['Japan'], 'ru session, the English query'); eq(fz('日本'), ['Japan'], 'zh session, the Chinese query'); eq(fz('Zzzz'), [], 'no match');
  return v;
}
test('C1. rule (3): COUNTRIES keep the English name as the stored value, each coded entry is a real region with its own flag; Other has no code', () => {
  assert.deepEqual(cViolations(ONB), []);
  const C = buildCountries(ONB); assert.equal(C.length, 31);
  /* CLDR's English differs for exactly two names; the PR leaves the stored value as it was */
  assert.deepEqual(C.filter((c) => c.code && new Intl.DisplayNames(['en'], { type: 'region' }).of(c.code) !== c.name).map((c) => c.name).sort(), Object.keys(CLDR_EN_DIFFERS).sort());
});
test('C2. rule (3): the REAL label function gives the English name in en, the localized region name in ko / zh / ru, "Other" through the label row', () => {
  assert.deepEqual(cViolations(ONB), []);
  /* every country in every language: non-empty, in the language's script, not the English name (suspicious ones are reported by the cell, not hidden) */
  const C = buildCountries(ONB).filter((c) => c.code); const bad: string[] = [];
  for (const l of NON_ENGLISH) for (const c of C) {
    const got = buildLabel(ONB, tFor(l), l)(c); const script = l === 'ko' ? hangul : l === 'zh' ? han : cyr;
    if (!got || got === c.name || !script.test(got)) bad.push(`${c.name}/${l}: "${got}"`);
  }
  assert.deepEqual(bad, [], 'a country whose localized name is empty, English or in the wrong script');
});
test('C3. rule (3): the stored / option value never localizes; search matches the English name and the localized one; an unknown locale falls back', () => {
  assert.deepEqual(c3Violations(ONB), []);
  /* PREMISE (named): Intl.DisplayNames with a VALID but unsupported tag does not throw and does not give English; it resolves to the runtime default. The app only ever passes en / ko / zh / ru (AVAILABLE_LOCALES), so this is a note, not a defect. */
  assert.match(read('lib/locales.ts'), /export const AVAILABLE_LOCALES: Locale\[\] = \['en', 'ko', 'zh', 'ru'\];/, 'the picker locale is one of four offered locales');
  const kr = buildCountries(ONB).find((c) => c.name === 'South Korea')!; const got = buildLabel(ONB, tFor('en'), 'xx')(kr);
  assert.ok(got === 'South Korea' || got === new Intl.DisplayNames([new Intl.DateTimeFormat().resolvedOptions().locale], { type: 'region' }).of('KR'), `an unsupported tag gave "${got}", neither English nor the runtime default`);
});
test('C1-C3 CONTROLS. a localized stored name, a wrong code, a localized option value, a lost fallback and a search that lost a half are flagged', () => {
  assert.deepEqual(cViolations(ONB), [], 'CONTROL: the real source passes'); assert.deepEqual(c3Violations(ONB), [], 'CONTROL: the real source passes');
  const m = (fn: (s: string) => string[], from: string, to: string, why: string) => { assert.equal(ONB.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(fn(ONB.replace(from, () => to)).length > 0, `${why}: not flagged`); };
  m(cViolations, "{ flag: '🇦🇷', name: 'Argentina', code: 'AR' }", "{ flag: '🇦🇷', name: '아르헨티나', code: 'AR' }", 'a stored name localized');
  m(cViolations, "name: 'Australia', code: 'AU'", "name: 'Australia', code: 'AT'", 'a wrong region code (shows Austria)');
  m(cViolations, "name: 'Brazil', code: 'BR'", "name: 'Brazil', code: 'br'", 'a lower-case code');
  m(cViolations, "{ flag: '🇨🇦', name: 'Canada', code: 'CA' }", "{ flag: '🇺🇸', name: 'Canada', code: 'CA' }", 'a flag that is not the code\'s');
  m(cViolations, "try { return new Intl.DisplayNames([locale], { type: 'region' }).of(c.code) ?? c.name; } catch { return c.name; }", "return new Intl.DisplayNames([locale], { type: 'region' }).of(c.code) ?? c.name;", 'the catch removed');
  m(cViolations, "if (locale === 'en') return c.name;", "if (locale === 'en') return c.name + '!';", 'English changed');
  m(cViolations, "return c.name === 'Other' ? t('ONBOARDING_FLOW_COUNTRY_OTHER') : c.name;", "return c.name;", 'Other reverts to English');
  m(c3Violations, 'onChange(c.name); setOpen(false);', 'onChange(label(c)); setOpen(false);', 'the stored value is the label');
  m(c3Violations, ' || label(c).toLowerCase().includes(query.toLowerCase())', '', 'search lost the localized half');
  m(c3Violations, 'c.name.toLowerCase().includes(query.toLowerCase()) ||', '', 'search lost the English half');
  m(c3Violations, '{label(selected)}</span>', '{selected.name}</span>', 'the chosen country shows English');
  m(c3Violations, 'const isActive = value === c.name;', 'const isActive = value === label(c);', 'the active option compares the label');
});

/* ═════════════════════════ S. journal sessions ═════════════════════════ */
const JRN = read('components/TradeJournal.tsx');
const SESSION_TEXT: Record<string, [string, string, string]> = { 'New York': ['뉴욕', '纽约', 'Нью-Йорк'], London: ['런던', '伦敦', 'Лондон'], Asia: ['아시아', '亚洲', 'Азия'], 'Pre-Market': ['프리마켓', '盘前', 'Премаркет'], Weekend: ['주말', '周末', 'Выходные'] };
/** violations of rule (4) by the journal source */
function sViolations(src: string): string[] {
  const v: string[] = [];
  const o = load<{ SESSIONS: string[]; SESSION_LABEL_KEYS: Record<string, string> }>(`${lineOf(src, 'const SESSIONS = [')}\n${lineOf(src, 'const SESSION_LABEL_KEYS')}\nconst __x = { SESSIONS, SESSION_LABEL_KEYS };`, '__x');
  if (JSON.stringify([...o.SESSIONS].sort()) !== JSON.stringify(Object.keys(SESSION_TEXT).sort())) v.push(`SESSIONS is ${JSON.stringify(o.SESSIONS)}, expected the five English names`);
  if (o.SESSIONS.length !== 5) v.push(`${o.SESSIONS.length} sessions, expected 5`);
  if (JSON.stringify(Object.keys(o.SESSION_LABEL_KEYS).sort()) !== JSON.stringify([...o.SESSIONS].sort())) v.push(`SESSION_LABEL_KEYS covers ${JSON.stringify(Object.keys(o.SESSION_LABEL_KEYS).sort())}, not exactly SESSIONS`);
  const keys = o.SESSIONS.map((s) => o.SESSION_LABEL_KEYS[s]); if (new Set(keys).size !== keys.length) v.push('two sessions share a label key');
  for (const s of o.SESSIONS) {
    const k = o.SESSION_LABEL_KEYS[s]; if (!k) continue;
    if (!(LABEL_KEYS as readonly string[]).includes(k)) v.push(`${s}: ${k} is not a registered label key`);
    if (DEF[k] !== s) v.push(`${s}: the English default of ${k} is "${DEF[k]}", so the English option text would change`);
    const want = SESSION_TEXT[s]; if (!want) continue;
    NON_ENGLISH.forEach((l, i) => { let got = ''; try { got = tFor(l)(k); } catch (e) { got = `threw ${(e as Error).message}`; } if (got !== want[i]) v.push(`${s} [${l}]: "${got}", expected "${want[i]}"`); });
  }
  /* the VALUE stays English: the option, the preset values and the rule compare */
  if (!src.includes('{SESSIONS.map(s => <option key={s} value={s}>{t(SESSION_LABEL_KEYS[s])}</option>)}')) v.push('the option is not value={s} (English) with text t(SESSION_LABEL_KEYS[s])');
  if (!src.includes("const vals = rule.value.split(',').map(v => v.trim().toLowerCase());")) v.push('the rule compare no longer reads the stored English value');
  for (const m of src.matchAll(/field: 'session',\s+operator: '\w+',\s+value: '([^']+)'/g)) for (const name of m[1].split(',')) if (!o.SESSIONS.includes(name.trim())) v.push(`a preset rule value "${name}" is not one of SESSIONS`);
  return v;
}
test('S1. rule (4): SESSION_LABEL_KEYS covers all five SESSIONS (real objects), every value is a registered key whose English is the session name; the option VALUE stays English', () => {
  assert.deepEqual(sViolations(JRN), []);
  const o = load<{ SESSIONS: string[]; SESSION_LABEL_KEYS: Record<string, string> }>(`${lineOf(JRN, 'const SESSIONS = [')}\n${lineOf(JRN, 'const SESSION_LABEL_KEYS')}\nconst __x = { SESSIONS, SESSION_LABEL_KEYS };`, '__x');
  assert.deepEqual(o.SESSIONS, ['New York', 'London', 'Asia', 'Pre-Market', 'Weekend'], 'the PR names five SESSIONS, in this order');
  assert.deepEqual(Object.keys(o.SESSION_LABEL_KEYS).sort(), [...o.SESSIONS].sort());
  assert.ok(JRN.split("value={s}>{t(SESSION_LABEL_KEYS[s])}").length === 2, 'exactly one option list reads the map');
  /* PREMISE: the preset NY or London rule stores two of the five names */
  assert.match(JRN, /field: 'session',\s+operator: 'is',\s+value: 'New York,London'/);
});
test('S1 CONTROLS. a missing session key, a shared key, an unregistered key, a localized option value and a wrong-language row are flagged', () => {
  assert.deepEqual(sViolations(JRN), [], 'CONTROL: the real source passes');
  const m = (from: string, to: string, why: string) => { assert.equal(JRN.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(sViolations(JRN.replace(from, () => to)).length > 0, `${why}: not flagged`); };
  m(", Weekend: 'JOURNAL_SESSION_WEEKEND' };", ' };', 'the fifth session left out of the map');
  m("Asia: 'JOURNAL_SESSION_ASIA'", "Asia: 'JOURNAL_SESSION_LONDON'", 'two sessions on one key');
  m("London: 'JOURNAL_SESSION_LONDON'", "London: 'JOURNAL_SESSION_LONDRES'", 'a key that is not registered');
  m("'New York': 'JOURNAL_SESSION_NEW_YORK', London", "'New York': 'JOURNAL_SESSION_LONDON', London", 'New York on the London key');
  m('<option key={s} value={s}>{t(SESSION_LABEL_KEYS[s])}</option>', '<option key={s} value={t(SESSION_LABEL_KEYS[s])}>{t(SESSION_LABEL_KEYS[s])}</option>', 'the option VALUE localized');
  m("const SESSIONS = ['New York', 'London', 'Asia', 'Pre-Market', 'Weekend'];", "const SESSIONS = ['New York', 'London', 'Asia', 'Pre-Market'];", 'a session removed from SESSIONS');
  m("value: 'New York,London'", "value: 'New York,Londres'", 'a preset value outside SESSIONS');
});

/* ═════════════════════════ D. hToHM stays English, hToHMt is the screen ═════════════════════════ */
const BRF = read('components/BriefingTerminal.tsx');
type DurFns = { hToHM: (h: number) => string; hToHMt: (h: number, t: T) => string };
const durBuild = (src: string): DurFns => ({ hToHM: load<DurFns['hToHM']>(cutBlock(src, 'function hToHM('), 'hToHM'), hToHMt: load<DurFns['hToHMt']>(cutBlock(src, 'function hToHMt('), 'hToHMt') });
/* [hours, the old English text, routed key + variables, text per language] */
const DUR_CASES: Array<[number, string, string, [string, string, string]]> = [
  [0.5, '30m', 'BRIEFING_DUR_MIN{"m":30}', ['30분', '30 分钟', '30 мин']], [0.1, '6m', 'BRIEFING_DUR_MIN{"m":6}', ['6분', '6 分钟', '6 мин']],
  [1, '1h', 'BRIEFING_DUR_H{"h":1}', ['1시간', '1 小时', '1 ч']], [3, '3h', 'BRIEFING_DUR_H{"h":3}', ['3시간', '3 小时', '3 ч']],
  [2.5, '2h 30m', 'BRIEFING_DUR_HM{"h":2,"m":30}', ['2시간 30분', '2 小时 30 分钟', '2 ч 30 мин']], [25.25, '25h 15m', 'BRIEFING_DUR_HM{"h":25,"m":15}', ['25시간 15분', '25 小时 15 分钟', '25 ч 15 мин']],
  [0.9999, '1h', 'BRIEFING_DUR_H{"h":1}', ['1시간', '1 小时', '1 ч']], [0.017, '1m', 'BRIEFING_DUR_MIN{"m":1}', ['1분', '1 分钟', '1 мин']],
];
/** violations of rule (5) by the real hToHM / hToHMt */
function durViolations(f: DurFns): string[] {
  const v: string[] = [];
  /* hToHM: literal inputs give the OLD English strings (it writes the AI-prompt line) */
  for (const [h, en] of DUR_CASES) if (f.hToHM(h) !== en) v.push(`hToHM(${h}) = "${f.hToHM(h)}", expected the old "${en}"`);
  if (f.hToHM(0.01) !== 'NOW') v.push(`hToHM(0.01) = "${f.hToHM(0.01)}", expected NOW`);
  for (const [h, en, routed, text] of DUR_CASES) {
    if (f.hToHMt(h, recT) !== routed) v.push(`hToHMt(${h}) routes ${f.hToHMt(h, recT)}, expected ${routed}`);
    if (f.hToHMt(h, tFor('en')) !== en) v.push(`hToHMt(${h}) [en]: "${f.hToHMt(h, tFor('en'))}", expected "${en}"`);
    NON_ENGLISH.forEach((l, i) => { const got = f.hToHMt(h, tFor(l)); if (got !== text[i]) v.push(`hToHMt(${h}) [${l}]: "${got}", expected "${text[i]}"`); });
  }
  /* the property: with the English rows the two functions agree for every duration the display can reach (the NOW guard sits at the call site) */
  for (let h = 0.017; h < 60; h += 0.0371) { const a = f.hToHM(h), b = f.hToHMt(h, tFor('en')); if (a !== b) { v.push(`hToHM(${h}) = "${a}" but hToHMt with the English rows = "${b}"`); break; } }
  return v;
}
/** the routing: the display reads hToHMt, the English one still feeds the AI-prompt line, behind the NOW guard */
function dCallViolations(src: string): string[] {
  const v: string[] = [];
  const plain = callArgs(src, 'hToHM'), loc = callArgs(src, 'hToHMt');
  if (plain.length !== 1 || plain[0].length !== 1 || plain[0][0] !== 'lh') v.push(`hToHM is called ${plain.length} time(s): ${JSON.stringify(plain)}, expected once with (lh) for the prompt`);
  if (loc.length !== 1 || loc[0].length !== 2 || loc[0][0] !== 'lh' || loc[0][1] !== 't') v.push(`hToHMt is called ${loc.length} time(s): ${JSON.stringify(loc)}, expected once with (lh, t) for the screen`);
  if (!src.includes('lines.push(`  ${e.type}: ${e.name} in ${hToHM(lh)} (${e.impact} impact)`);')) v.push('the AI-prompt line no longer reads the English hToHM');
  if (!src.includes("lh < 0.017 ? t('BRIEFING_EVENT_NOW') : t('BRIEFING_EVENT_IN', { time: hToHMt(lh, t) })")) v.push('the event row does not read hToHMt behind the NOW guard');
  if (/hToHMt\([^)]*\)[^\n]*(?:lines\.push|prompt)/.test(src)) v.push('hToHMt reaches the prompt');
  const i = src.indexOf('lines.push(`  ${e.type}'); const at = src.lastIndexOf('function ', i);
  if (/\buseLabels\b|\bt\(/.test(src.slice(at, i))) v.push('the prompt builder reads a label function');
  return v;
}
test('D1. rule (5): hToHM gives the old English strings, hToHMt gives the label text in en / ko / zh / ru and agrees with hToHM in English (REAL functions)', () => {
  assert.deepEqual(durViolations(durBuild(BRF)), []);
  assert.equal(DUR_CASES.length, 8);
  for (const k of ['BRIEFING_DUR_MIN', 'BRIEFING_DUR_HM', 'BRIEFING_DUR_H']) assert.ok(NEW_KEYS.includes(k));
});
test('D2. rule (5): the display reads hToHMt (once, with t, behind the NOW guard); the English hToHM still feeds the AI-prompt line (once)', () => {
  assert.deepEqual(dCallViolations(BRF), []);
  /* PREMISE: the guard is why hToHMt has no NOW branch: hToHM(0.01) is NOW, hToHMt(0.01) is a minute count, and 0.01 never reaches it */
  const f = durBuild(BRF); assert.equal(f.hToHM(0.01), 'NOW'); assert.equal(f.hToHMt(0.01, tFor('en')), '1m');
});
test('D1-D2 CONTROLS. a localized hToHM, a swapped h / m, a wrong key, a display on the English function and a prompt on the localized one are flagged', () => {
  assert.deepEqual(durViolations(durBuild(BRF)), [], 'CONTROL: the real source passes'); assert.deepEqual(dCallViolations(BRF), [], 'CONTROL: the real source passes');
  const mD = (from: string, to: string, why: string) => { assert.equal(BRF.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(durViolations(durBuild(BRF.replace(from, () => to))).length > 0, `${why}: not flagged`); };
  const mC = (from: string, to: string, why: string) => { assert.equal(BRF.split(from).length, 2, `CONTROL: anchor not unique: ${from}`); assert.ok(dCallViolations(BRF.replace(from, () => to)).length > 0, `${why}: not flagged`); };
  mD("return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;\n}\n\n/* hToHM for the SCREEN", "return mins > 0 ? `${hrs}시간 ${mins}분` : `${hrs}시간`;\n}\n\n/* hToHM for the SCREEN", 'hToHM localized');
  mD("t('BRIEFING_DUR_HM', { h: hrs, m: mins })", "t('BRIEFING_DUR_HM', { h: mins, m: hrs })", 'h / m swapped');
  mD("if (totalMins < 60) return t('BRIEFING_DUR_MIN', { m: totalMins });", "if (totalMins < 60) return t('BRIEFING_DUR_H', { h: totalMins });", 'minutes sent to the hours key');
  mD(": t('BRIEFING_DUR_H', { h: hrs });", ": `${hrs}h`;", 'hours reverts to English');
  mC("t('BRIEFING_EVENT_IN', { time: hToHMt(lh, t) })", "t('BRIEFING_EVENT_IN', { time: hToHM(lh) })", 'the display on the English function');
  mC('in ${hToHM(lh)} (${e.impact} impact)', 'in ${hToHMt(lh, t)} (${e.impact} impact)', 'the prompt on the localized function');
  mC("lh < 0.017 ? t('BRIEFING_EVENT_NOW') : ", '', 'the NOW guard removed');
});

/* ═════════════════════════ J. GexTable regime word, PlanBadge trial title ═════════════════════════ */
test('J1. GexTable reads the word "regime" through GEX_TABLE_REGIME_WORD and PlanBadge the trial tooltip through PLAN_BADGE_TRIAL_TITLE; the English text is unchanged', () => {
  const gex = read('components/GexTable.tsx'); const plan = read('components/PlanBadge.tsx');
  assert.ok(gex.includes("<span style={{ color: 'var(--txt2)' }}> {t('GEX_TABLE_REGIME_WORD')} - {regimeDesc}</span>"), 'GexTable does not read the regime word through the label');
  assert.doesNotMatch(gex, /> regime - /, 'the English word is hardcoded again');
  assert.equal(DEF.GEX_TABLE_REGIME_WORD, 'regime', 'in English the line reads exactly as before: " regime - ..."');
  /* a comment in PlanBadge still quotes title="Trial" (line 114), so the scan reads the code with comments removed */
  const planCode = plan.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(planCode.includes("title={t('PLAN_BADGE_TRIAL_TITLE')}") && !planCode.includes('title="Trial"'), 'PlanBadge does not read the trial tooltip through the label');
  assert.equal(DEF.PLAN_BADGE_TRIAL_TITLE, 'Trial', 'in English the tooltip reads exactly as before');
  /* CONTROLS: the pins do see the pre-PR text */
  assert.match('<span> regime - {regimeDesc}</span>', /> regime - /); assert.ok('<Link title="Trial">'.includes('title="Trial"'));
  assert.ok(/const \{[^}]*\bt\b[^}]*\} = useLabels\(\)/.test(gex) && /const \{[^}]*\bt\b[^}]*\} = useLabels\(\)/.test(plan), 'a component that calls t must read it from useLabels');
});
