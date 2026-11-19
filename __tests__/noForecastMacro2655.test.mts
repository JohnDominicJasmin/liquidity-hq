/* QA: no-forecast notes on /news and factual yen / macro lines. PR #2655, part of #1185 (PM 2026-11-19: DESCRIBE, NEVER FORECAST; QA note on #2653: the yen line states the level only).
 * THE WRITTEN RULE: a note or a yen / macro line states a fact (an event, a level, a move). It never says what the market will do, never carries an association claim ("coincided with selloffs"), never advises.
 *   N1  GEO_KEYWORDS: still the same 9 tags, each note ONE plain sentence with none of the forecast words the PR names (dumps, pump, fake first move, risk-off) or the wider forecast / advice vocabulary
 *   N2  ECON_NOTES: still the same 10 keys, each one plain sentence, same vocabulary check
 *   Y1  the Arena's yenWatch text (what the AI read receives): the level, with 160 / 158 as the only cut-offs, and no danger / liquidation / carry / unwind wording (the expression is compiled and run)
 *   Y2  computeMacroRisk keeps its levels (160 -> danger, 158 -> caution, below -> none) and the >= 160 line states the level with no forecast
 *   Y3  the >= 158 line in the same function states the level with no "carry-trade danger zone" (THE PR LEFT IT: see the report)
 *   E1  the four English defaults are exactly the written values and are registered in lib/labelKeys.ts
 *   E2  migration 20261124a: PROD and DEV blocks are the same 20 rows = exactly 4 keys x (en ko zh ru ar), nothing else written
 *   E3  its en rows equal the shipped defaults; every locale keeps the levels (160 / 158) and the USD/JPY pair; each translation is in its own script
 *   E4  no translation carries the dropped claims (carry trade, intervention, risk appetite, selloff) in its own language
 *   E5  it is the NEWEST row for each key in every locale: no later migration rewrites them, and earlier ones exist (control)
 * WHAT THIS CANNOT PROVE: how the /news chips and the Macro strip look, or that ko / zh / ru / ar read well (AI-drafted, not native-reviewed). The live labels table wins over the defaults until PM applies the migration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GEO_KEYWORDS, ECON_NOTES } from '../lib/classify.ts';
import { computeMacroRisk } from '../lib/confluence.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const dir = new URL('supabase/migrations/', root);
const FILE = '20261124a_labels_macro_strip_facts.sql';
const sql = readFileSync(new URL(FILE, dir), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];
const KEYS = ['BRIEFING_YEN_DANGER_DESC', 'MACRO_STRIP_GOLD_DOWN', 'MACRO_STRIP_JPY_INTERVENTION', 'MACRO_STRIP_JPY_CARRY_STABLE'];
/* the written values (PR body + migration header); NOT copied from the code under test */
const WANT_EN: Record<string, string> = {
  BRIEFING_YEN_DANGER_DESC: 'USD/JPY is at or above 160.',
  MACRO_STRIP_GOLD_DOWN: 'Gold falling',
  MACRO_STRIP_JPY_INTERVENTION: 'USD/JPY at or above 160',
  MACRO_STRIP_JPY_CARRY_STABLE: 'USD/JPY below 158',
};
/* forecast / advice / reaction vocabulary: none of it belongs in a note that describes an event */
const FORECAST = /\b(dump\w*|pump\w*|fake|risk-?off|risk-?on|violent\w*|volatil\w*|exaggerat\w*|revers\w*|rally|crash\w*|expect\w*|likely|typically|usually|always|almost|will|should|watch|wait|avoid|hawkish|pressure|recover\w*|spike|leak\w*|overreact\w*|bad news|good news|unwind\w*|liquidation\w*)\b/i;

test('N1. GEO_KEYWORDS: nine tags, one plain sentence each, no forecast words', () => {
  assert.deepEqual(GEO_KEYWORDS.map((g) => g.tag), ['FED SPEECH', 'TRUMP/TARIFF', 'GEOPOLITICAL', 'SHIPPING/BLOCKADE', 'ENERGY/CYBER', 'OPEC', 'CRYPTO REG', 'MACRO SUMMIT', 'TAIWAN/CHINA']);
  for (const g of GEO_KEYWORDS) {
    assert.match(g.note, /^[^.!?;]+\.$/, `${g.tag}: not one plain sentence: ${JSON.stringify(g.note)}`);
    assert.doesNotMatch(g.note, FORECAST, `${g.tag}: forecast wording: ${JSON.stringify(g.note)}`);
    assert.ok(g.kw.length > 0 && g.style, `${g.tag}: keywords or style lost`);
  }
});
test('N2. ECON_NOTES: ten keys, one plain sentence each, no forecast words', () => {
  assert.deepEqual(Object.keys(ECON_NOTES), ['FOMC', 'CPI', 'PPI', 'NFP', 'PCE', 'GDP', 'FED', 'OPTIONS', 'RETAIL', 'MACRO']);
  for (const [k, note] of Object.entries(ECON_NOTES)) {
    assert.match(note, /^[^.!?;]+\.$/, `${k}: not one plain sentence: ${JSON.stringify(note)}`);
    assert.doesNotMatch(note, FORECAST, `${k}: forecast wording: ${JSON.stringify(note)}`);
  }
});
test('N3. CONTROL: the vocabulary check fires on the old notes the PR removed', () => {
  for (const old of ['Fed official speaking. First market reaction is almost always fake. Watch for reversal after initial spike.', 'Regulatory news hits crypto directly. Bad news = instant dump. Good news = delayed pump.', 'Taiwan/China tension = extreme risk-off. Crypto dumps hard. Watch for extreme volatility.', 'Rate decision day. Highest volatility of the month. First reaction is always the fake - wait 15-30min for the real direction.'])
    assert.match(old, FORECAST);
  assert.doesNotMatch('Regulatory news about crypto.', FORECAST);
});

/* the yenWatch expression of app/(main)/arena/page.tsx, compiled and run */
function yenWatch(): (jpyUsd: number | null) => string {
  const src = read('app/(main)/arena/page.tsx');
  const a = src.indexOf('yenWatch: jpyUsd == null'); assert.ok(a > 0, 'CONTROL: the yenWatch expression was not found');
  const b = src.indexOf("/* The card's own sentence", a); assert.ok(b > a, 'CONTROL: the end of the yenWatch expression was not found');
  const expr = src.slice(a + 'yenWatch:'.length, b).trim().replace(/,$/, '');
  return new Function('jpyUsd', `return ${expr};`) as (jpyUsd: number | null) => string;
}
test('Y1. the Arena yenWatch text states the level, 160 and 158 are the cut-offs, no danger wording', () => {
  const f = yenWatch();
  assert.equal(f(null), '-');
  const hi = f(161.234), mid = f(159), low = f(150);
  assert.match(hi, /^161\.23 - /); assert.match(mid, /^159\.00 - /); assert.match(low, /^150\.00 - /);
  assert.match(f(160), /^160\.00 - at or above 160/, '160 is the top band'); assert.match(f(161.234), /at or above 160/); assert.match(f(159.99), /between 158 and 160/); assert.match(f(158), /between 158 and 160/); assert.match(f(157.99), /below 158/);
  for (const s of [hi, mid, low]) assert.doesNotMatch(s, /danger|liquidat|carry|unwind|trigger|risk|warning|safe|stable|watch for/i, `forecast / verdict wording: ${s}`);
});
test('Y2. computeMacroRisk keeps its levels and the >= 160 line states the level only', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(computeMacroRisk([], 161, now).level, 'danger'); assert.equal(computeMacroRisk([], 160, now).level, 'danger');
  assert.equal(computeMacroRisk([], 159, now).level, 'caution'); assert.equal(computeMacroRisk([], 158, now).level, 'caution');
  assert.equal(computeMacroRisk([], 157.9, now).level, 'none'); assert.equal(computeMacroRisk([], null, now).level, 'none');
  const r = computeMacroRisk([], 161.04, now).reasons.join(' | ');
  assert.match(r, /^USD\/JPY 161\.0 - /); assert.match(r, /160/);
  assert.doesNotMatch(r, /unwind|liquidat|trigger|risk|carry|danger|expect|can /i, `forecast wording in the >= 160 line: ${r}`);
});
test('Y3. the >= 158 line of the same function states the level and does not call it a "carry-trade danger zone"', () => {
  const r = computeMacroRisk([], 159, Date.parse('2026-11-19T12:00:00Z')).reasons.join(' | ');
  assert.match(r, /^USD\/JPY 159\.0 - /);
  assert.doesNotMatch(r, /carry|danger zone|unwind|liquidat|trigger|risk|expect/i, `an unsupported association / verdict is still in the line: ${r}`);
});

test('E1. the four English defaults are exactly the written values and are registered', () => {
  for (const k of KEYS) { assert.equal(defaults[k], WANT_EN[k], `${k}: the shipped English default`); assert.ok((LABEL_KEYS as readonly string[]).includes(k), `${k} is not in labelKeys.ts`); }
});

function block(table: string) {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]{2}(?:-[A-Z]{2})?)','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(m![1].trim().split('\n').length, rows.length, `${table}: a row line did not parse`);
  return rows;
}
const prod = block('lhq_labels'); const dev = block('lhq_dev_labels');
const get = (k: string, l: string) => prod.find((r) => r.key === k && r.locale === l)?.value ?? '';

test('E2. PROD = DEV, 4 keys x 5 locales = 20 rows, nothing else written', () => {
  assert.deepEqual(prod, dev); assert.equal(prod.length, 20);
  assert.deepEqual([...new Set(prod.map((r) => r.key))].sort(), [...KEYS].sort());
  const seen = new Set<string>(); for (const r of prod) { const id = `${r.key}/${r.locale}`; assert.ok(!seen.has(id), `duplicate ${id}`); seen.add(id); assert.ok(r.value.trim().length > 0, `empty ${id}`); }
  for (const k of KEYS) for (const l of LOCALES) assert.ok(seen.has(`${k}/${l}`), `missing ${k}/${l}`);
  const code = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.deepEqual([...code.matchAll(/\b(insert into|update|delete from|alter table|drop|truncate|grant)\s+(\w+)/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`).filter((s) => s !== 'update set'), ['insert into lhq_labels', 'insert into lhq_dev_labels']);
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/);
});
test('E3. en rows equal the defaults; levels and the pair survive in every locale; each translation is in its own script', () => {
  for (const k of KEYS) assert.equal(get(k, 'en'), WANT_EN[k], `${k}: the migration en row`);
  const SCRIPT: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]{2,}/, ar: /[؀-ۿ]{2,}/ };
  for (const l of LOCALES) {
    for (const k of KEYS.filter((x) => x !== 'MACRO_STRIP_GOLD_DOWN')) {
      const v = get(k, l);
      assert.ok(v.includes('USD/JPY'), `${k}/${l}: the pair name is gone: ${v}`);
      assert.ok(v.includes(k === 'MACRO_STRIP_JPY_CARRY_STABLE' ? '158' : '160'), `${k}/${l}: the level is gone: ${v}`);
      assert.doesNotMatch(v, /\{[a-z]+\}/, `${k}/${l}: an unexpected placeholder`);
    }
    if (l !== 'en') for (const k of KEYS) assert.match(get(k, l), SCRIPT[l], `${k}/${l}: not in the ${l} script: ${get(k, l)}`);
    if (l === 'en') for (const k of KEYS) assert.doesNotMatch(get(k, l), /[^\x00-\x7F]/, `${k}/en: non-ASCII in the English row`);
  }
});
test('E4. no translation carries the dropped claims in its own language', () => {
  const BAD: Record<string, RegExp> = {
    en: /carry|intervention|risk|appetite|sell-?off|unwind/i, ko: /캐리|개입|위험|선호|매도/, zh: /套利|干预|干預|风险|風險|偏好|抛售|拋售/, ru: /керри|интервенц|риск|аппетит|распрод/i, ar: /الفائدة|تدخل|مخاطر|شهية|بيع/,
  };
  for (const r of prod) assert.doesNotMatch(r.value, BAD[r.locale], `${r.key}/${r.locale} still carries a dropped claim: ${r.value}`);
});
test('E5. no later migration rewrites these keys; earlier ones exist (so "newest" means something)', () => {
  const files = readdirSync(dir).filter((f) => /_labels_.*\.sql$/.test(f)).sort();
  for (const k of KEYS) {
    const touching = files.filter((f) => new RegExp(`\\('${k}','[a-z-]+',`).test(readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n')));
    assert.equal(touching[touching.length - 1], FILE, `${k}: a later migration ${touching[touching.length - 1]} rewrites it`);
    assert.ok(touching.length >= 2, `CONTROL: no earlier row found for ${k}`);
  }
});
