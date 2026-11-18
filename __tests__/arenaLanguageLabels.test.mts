/* QA's pins on #2569's LABELS (head 2c82f80e): the Arena signal chips, the Draw Structure button/menu/states, and the notes the server adds to a read, in ko, zh, ru, ar (migration 20261119r).
 *
 *   A0  CONTROL: both blocks and every row are findable
 *   A1  43 keys x 5 locales, each exactly once, in BOTH the PROD block (lhq_labels) and the DEV block (lhq_dev_labels), identical rows
 *   A2  the en rows equal lib/labelDefaults.en.json, and every key is registered in lib/labelKeys.ts exactly once
 *   A3  every placeholder ({n} {kind} {count} {shown} {said} {bullish} {bearish}) is kept byte-identical in each locale
 *   A4  ko/zh/ru/ar are not English (the one exception is the "Pro" tag), no value is empty, and no vendor or model name is in any value
 *   A5  the chips are built from the 22 chip keys (no hard-coded English; the funding chip is not drawn once its reading is unavailable); Draw Structure's 18 keys and the 3 note keys are used
 *   A6  the file is four statements: an upsert and a delete per project, PROD then DEV
 *   A7  the DELETED key ARENA_FCHIP_V_UNAVAILABLE is gone from labelKeys, the defaults, the migration's inserts and every component, and the migration deletes it from both tables
 *   A8  the note keys equal lib/grok.ts ENGLISH_READ_NOTES, which the route uses for English and as the per-key fallback
 * Expected values are literals written here (the 43 names, the 22/18/3 split). NOT proved here: that the rows are applied to any database, or that the translations read well (AI-drafted, owner ruling 2026-11-13). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { ENGLISH_READ_NOTES } from '../lib/grok.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261119r_labels_arena_language.sql');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];

const CHIP_KEYS = ['ARENA_FCHIP_RIBBON', 'ARENA_FCHIP_SQUEEZE', 'ARENA_FCHIP_FUNDING', 'ARENA_FCHIP_MULTI_TF', 'ARENA_FCHIP_WHALE_CVD',
  'ARENA_FCHIP_V_AGREES', 'ARENA_FCHIP_V_OPPOSES', 'ARENA_FCHIP_V_NO_RECENT', 'ARENA_FCHIP_V_NEUTRAL', 'ARENA_FCHIP_V_BUILDING', 'ARENA_FCHIP_V_FLUSH_RISK', 'ARENA_FCHIP_V_QUIET',
  'ARENA_FCHIP_V_LOADING', 'ARENA_FCHIP_V_LONG_HEAVY', 'ARENA_FCHIP_V_SHORT_HEAVY', 'ARENA_FCHIP_V_TF_UP', 'ARENA_FCHIP_V_TF_DOWN',
  'ARENA_FCHIP_V_CONFLICTING', 'ARENA_FCHIP_V_MIXED', 'ARENA_FCHIP_V_BULLISH', 'ARENA_FCHIP_V_BEARISH', 'ARENA_FCHIP_V_FLAT'];
const DRAW_KEYS = ['DRAW_STRUCTURE_BUTTON', 'DRAW_STRUCTURE_PRO_TAG', 'DRAW_STRUCTURE_LOCKED_ARIA', 'ARENA_DRAW_STRUCTURE_GATE_FEATURE_LABEL', 'DRAW_STRUCTURE_LOADING',
  'DRAW_STRUCTURE_PANEL_TITLE', 'DRAW_STRUCTURE_NONE', 'DRAW_STRUCTURE_CLEAR', 'DRAW_STRUCTURE_LOWER_TF_NOTE', 'DRAW_STRUCTURE_SIGNED_OUT', 'DRAW_STRUCTURE_FAILED',
  'DRAW_STRUCTURE_ITEM', 'DRAW_STRUCTURE_ITEM_ONE', 'DRAW_STRUCTURE_TYPE_TRENDLINE', 'DRAW_STRUCTURE_TYPE_CHANNEL', 'DRAW_STRUCTURE_TYPE_FLAG', 'DRAW_STRUCTURE_TYPE_TRIANGLE', 'DRAW_STRUCTURE_TYPE_HORIZONTAL'];
const NOTE_KEYS = ['ARENA_READ_NOTE_TIER_UNCHECKED', 'ARENA_READ_NOTE_TIER_COUNTED', 'ARENA_READ_NOTE_SPOT_MISSING'];
const ALL = [...CHIP_KEYS, ...DRAW_KEYS, ...NOTE_KEYS];
const DELETED = 'ARENA_FCHIP_V_UNAVAILABLE';

const iProd = sql.indexOf('insert into lhq_labels'), iDev = sql.indexOf('insert into lhq_dev_labels');
type Row = [key: string, locale: string, value: string];
const rowRe = /\('([A-Z0-9_]+)','([a-z]+)','((?:[^']|'')*)'\)/g;
const rowsOf = (txt: string): Row[] => [...txt.matchAll(rowRe)].map((m) => [m[1], m[2], m[3].replace(/''/g, "'")]);
const prod = rowsOf(sql.slice(iProd, iDev)), dev = rowsOf(sql.slice(iDev));
const val = (rows: Row[], k: string, l: string) => rows.filter((r) => r[0] === k && r[1] === l);

test('A0. CONTROL: both blocks and every row are findable - without this every assertion below is vacuous', () => {
  assert.ok(iProd > 0 && iDev > iProd, 'a block header is missing or out of order');
  assert.equal(prod.length, 215, `PROD rows read: ${prod.length}`); assert.equal(dev.length, 215, `DEV rows read: ${dev.length}`);
  /* every "('" row start in the file is one the regex read, so a row with an odd quote cannot hide from the pins */
  assert.equal([...sql.matchAll(/^\('/gm)].length, 430, 'a row start was not read by the row regex (an unescaped quote?)');
});

test('A1. 43 keys x 5 locales, each once, in PROD and in DEV, with identical rows', () => {
  const keys = [...new Set(prod.map((r) => r[0]))];
  assert.deepEqual([...keys].sort(), [...ALL].sort(), 'the key set is not the 22 chip keys + 18 Draw Structure keys + 3 note keys');
  assert.equal(keys.length, 43);
  for (const [name, rows] of [['PROD', prod], ['DEV', dev]] as const) {
    for (const k of keys) for (const l of LOCALES) assert.equal(val(rows, k, l).length, 1, `${name}: ${k}/${l} appears ${val(rows, k, l).length} times`);
  }
  assert.deepEqual(prod, dev, 'the PROD and DEV blocks differ');
  assert.deepEqual([...new Set(prod.map((r) => r[1]))].sort(), [...LOCALES].sort());
});

test('A2. en rows equal the shipped defaults, and every key is registered in labelKeys.ts exactly once', () => {
  const registered = new Map<string, number>();
  for (const k of LABEL_KEYS as readonly string[]) registered.set(k, (registered.get(k) ?? 0) + 1);
  for (const k of ALL) {
    assert.equal(val(prod, k, 'en')[0][2], defaults[k], `${k}: the en row differs from labelDefaults.en.json (${JSON.stringify(defaults[k])})`);
    assert.equal(registered.get(k), 1, `${k} is registered ${registered.get(k) ?? 0} times in LABEL_KEYS`);
  }
});

test('A3. placeholders are kept byte-identical in every locale', () => {
  const ph = (s: string) => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort().join(',');
  const expected: Record<string, string> = { ARENA_FCHIP_V_TF_UP: '{n}', ARENA_FCHIP_V_TF_DOWN: '{n}', DRAW_STRUCTURE_ITEM: '{count},{kind}', DRAW_STRUCTURE_ITEM_ONE: '{kind}',
    ARENA_READ_NOTE_TIER_UNCHECKED: '{said},{shown}', ARENA_READ_NOTE_TIER_COUNTED: '{bearish},{bullish},{said},{shown}' };
  for (const k of ALL) for (const l of LOCALES) assert.equal(ph(val(prod, k, l)[0][2]), expected[k] ?? '', `${k}/${l}: placeholders ${ph(val(prod, k, l)[0][2])}`);
});

test('A4. ko/zh/ru/ar are translated (not English, not empty), and no value names a vendor or a model', () => {
  const SAME_AS_EN_OK = new Set(['DRAW_STRUCTURE_PRO_TAG']);
  for (const [k, l, v] of prod) {
    assert.ok(v.trim().length > 0, `${k}/${l} is empty`);
    if (l !== 'en' && !SAME_AS_EN_OK.has(k)) assert.notEqual(v, val(prod, k, 'en')[0][2], `${k}/${l} is still the English text`);
    if (l !== 'en' && !SAME_AS_EN_OK.has(k)) assert.match(v, /[^\x00-\x7F]/, `${k}/${l} has no non-ASCII letter: ${v}`);
    assert.doesNotMatch(v, /grok|x\.ai|\bxai\b|openai|chatgpt|gpt-?\d|claude|anthropic|gemini|deepseek|llama|mistral/i, `${k}/${l} names a vendor or model: ${v}`);
  }
});

test('A5. the chip row is built from the 22 chip keys, and no English chip text is left; Draw Structure and the note keys are used', () => {
  const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const page = stripC(read('app/(main)/arena/page.tsx')), kline = stripC(read('components/KLineProChart.tsx')), route = stripC(read('app/api/grok/route.ts'));
  for (const k of CHIP_KEYS) assert.ok(page.includes(`t('${k}'`), `the Arena page does not use ${k}`);
  assert.match(page, /t\('ARENA_FCHIP_V_TF_UP', \{ n: tfBull \}\)/); assert.match(page, /t\('ARENA_FCHIP_V_TF_DOWN', \{ n: tfBear \}\)/);
  for (const lit of ["k: 'Ribbon'", "k: 'Squeeze'", "k: 'Funding'", "k: 'Multi-TF'", "k: 'Whale CVD'", "'no recent signal'", "'flush risk'", "'long-heavy'", "'short-heavy'", "'conflicting'", "'loading…'", '/3 up`', '/3 down`'])
    assert.equal(page.includes(lit), false, `English chip text is still hard-coded: ${lit}`);
  assert.match(page, /key=\{f\.id\}/, 'the chip key must be the language-independent id, or a language switch remounts every chip');
  assert.match(page, /\.\.\.\(frPct == null && feedGraceOver \? \[\] : \[\{ id: 'funding'/, 'the funding chip is drawn again after its reading is unavailable (owner: no "unavailable" chip)');
  for (const k of DRAW_KEYS) {
    const used = k.startsWith('ARENA_') ? page.includes(`t('${k}')`) : (kline.includes(`'${k}'`) || (k.startsWith('DRAW_STRUCTURE_TYPE_') && kline.includes('`DRAW_STRUCTURE_TYPE_${type.toUpperCase()}`')));
    assert.ok(used, `${k} is not used by the component it was translated for`);
  }
  for (const k of NOTE_KEYS) assert.ok(route.includes(`'${k}'`), `/api/grok does not read ${k}`);
  /* and the English the keys replaced is not still hard-coded beside them (the button, its loading text, the panel title and the rest) */
  for (const k of DRAW_KEYS) {
    const en = defaults[k];
    if (en.includes('{') || en.length < 5 || k === 'DRAW_STRUCTURE_PRO_TAG') continue;
    for (const q of [`'${en}'`, `"${en}"`, `>${en}<`]) assert.equal((k.startsWith('ARENA_') ? page : kline).includes(q), false, `${k}: the English text ${q} is hard-coded`);
  }
});

test('A6. the migration is four statements: an upsert on (key, locale) then a delete of the removed key, for PROD then for DEV, and nothing else', () => {
  const body = sql.replace(/^--.*$/gm, '');
  assert.equal([...body.matchAll(/;/g)].length, 4, 'the file does not have exactly four statements');
  assert.equal([...body.matchAll(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g)].length, 2);
  const stmts = body.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 40).replace(/\s+/g, ' '));
  assert.deepEqual(stmts.map((s) => s.split(' ').slice(0, 3).join(' ')), ['insert into lhq_labels', 'delete from lhq_labels', 'insert into lhq_dev_labels', 'delete from lhq_dev_labels']);
  assert.equal(/\b(drop|truncate|alter)\b/i.test(body.replace(/do update set/gi, '')), false, 'a destructive statement is in the file');
});

test('A7. the DELETED key ARENA_FCHIP_V_UNAVAILABLE: absent from labelKeys, the defaults, the migration inserts and every component; deleted from both tables', () => {
  assert.equal((LABEL_KEYS as readonly string[]).includes(DELETED), false, 'still registered in LABEL_KEYS');
  assert.equal(DELETED in defaults, false, 'still in labelDefaults.en.json');
  assert.equal(prod.concat(dev).some((r) => r[0] === DELETED), false, 'the migration still INSERTS it');
  assert.ok(sql.includes(`delete from lhq_labels where key = '${DELETED}';`), 'no delete from lhq_labels (a key that was applied would linger)');
  assert.ok(sql.includes(`delete from lhq_dev_labels where key = '${DELETED}';`), 'no delete from lhq_dev_labels');
  const walk = (dir: string): string[] => readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((n) => {
    const rel = `${dir}/${n}`; return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : /\.(tsx?|mts|mjs|json)$/.test(n) ? [rel] : [];
  });
  const refs = ['app', 'components', 'lib'].flatMap(walk).filter((f) => read(f).includes(DELETED));
  assert.deepEqual(refs, [], `still referenced in: ${refs.join(', ')}`);
  /* CONTROL: the walker sees a key that IS used */
  assert.ok(['app', 'components', 'lib'].flatMap(walk).some((f) => read(f).includes('ARENA_FCHIP_V_LOADING')), 'the source walk cannot see a live key - the absence above means nothing');
});

test('A8. the three note keys equal ENGLISH_READ_NOTES in lib/grok.ts (the English path and the per-key fallback), byte for byte', () => {
  assert.equal(defaults.ARENA_READ_NOTE_TIER_UNCHECKED, ENGLISH_READ_NOTES.tierUnchecked);
  assert.equal(defaults.ARENA_READ_NOTE_TIER_COUNTED, ENGLISH_READ_NOTES.tierCounted);
  assert.equal(defaults.ARENA_READ_NOTE_SPOT_MISSING, ENGLISH_READ_NOTES.spotMissing);
  assert.equal(val(prod, 'ARENA_READ_NOTE_SPOT_MISSING', 'en')[0][2], 'No spot data for this coin, so confidence skips the spot check.');
});
