/* QA: PR #2663, the EMA checklist rows' hover titles in the reader's language (61 keys EMA_ROW_*, migration 20261125a_labels_ema_row_titles.sql).
 * Read from the files and from the pure helpers (lib/emaRowTitles.ts, lib/waveTrend.ts); no browser, no network, nothing billed.
 *   R1  the 61 keys are the same set in labelDefaults.en.json, LABEL_KEYS, the helper/waveTrend source and the migration
 *   R2  migration shape: held header, PROD block (lhq_labels) == DEV block (lhq_dev_labels) row for row, 61 x 5 locales, no duplicate, nothing else touched, on-conflict upsert
 *   R3  every en row equals the shipped default (a stored en row overrides the default)
 *   R4  {placeholders}: the same set in every locale as in en, and the set the helper SUPPLIES for that state (a missing var prints "{pct}" on screen)
 *   R5  each translation is in its own script (ko Hangul, zh Han, ru Cyrillic, ar Arabic) and none leaks another script
 *   R6  direction and subject: bull/bear, above/below, long/short words in each locale say the same thing as the en key (a bullish key must not read bearish in ru)
 *   R7  the numbers are in the right order and on the right EMA: ribbon bull e9>e20>e50, bear e50>e20>e9; the "Close vs EMA 50" keys carry {e50} next to EMA50 in every locale
 *   R8  helper -> key -> sentence equals what the engine writes (lib/useEMAStrategy.ts templates; funding from the real fundingDetail), state by state; every one of the 61 keys is reached
 *   R9  wiring: each checklist row spreads ITS OWN helper (a "Close vs EMA 50" row cannot carry the ribbon's title); the AI prompt paths still read the English `detail`; the title is bound to detailKey/detailVars
 *   R10 no title longer than the PR's 20-word tooltip budget (en); the other locales are printed, not bounded
 *   R11 no AI vendor or model is named in any row
 *   R12 no forecast or advice wording: the repo's banned list (copyNoForecastAdvice) and the advice verbs (skip entry, proceed, abort, entry eligible/possible, wait for) in en, plus imperative advice in ko / ru / ar
 * WHAT THIS CANNOT PROVE: that ko/zh/ru/ar read natively (AI-drafted, owner's ruling); the live labels table; how the hover looks in a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { sma200Ref, ribbonRef, crossRef, closeRef, zoneRef, fundingRef, oiDetailRef, volumeRef, indicatorRef } from '../lib/emaRowTitles.ts';
import { fundingDetail } from '../lib/fundingDetail.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DEF = JSON.parse(read('../lib/labelDefaults.en.json')) as Record<string, string>;
const MIG = '20261125a_labels_ema_row_titles.sql';
const sql = read(`../supabase/migrations/${MIG}`);
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'] as const;
type Row = { key: string; locale: string; value: string };

function block(table: string): Row[] {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  const lines = m![1].trim().split('\n');
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]+)','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(lines.length, rows.length, `${table}: a row line did not parse (unquoted apostrophe?)`);
  return rows;
}
const prod = block('lhq_labels');
const dev = block('lhq_dev_labels');
const KEYS = [...new Set(prod.map((r) => r.key))];
const val = (k: string, l: string) => prod.find((r) => r.key === k && r.locale === l)!.value;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const phSet = (s: string) => [...new Set(ph(s))].sort().join(',');
const fill = (tpl: string, vars?: Record<string, string | number>) => (vars ? tpl.replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w)) : tpl);

test('R1. the 61 EMA_ROW_* keys are one set in defaults, LABEL_KEYS, the helper source and the migration', () => {
  const defKeys = Object.keys(DEF).filter((k) => k.startsWith('EMA_ROW_')).sort();
  const regKeys = (LABEL_KEYS as readonly string[]).filter((k) => k.startsWith('EMA_ROW_')).sort();
  const src = read('../lib/emaRowTitles.ts') + read('../lib/waveTrend.ts');
  const usedKeys = [...new Set([...src.matchAll(/'(EMA_ROW_[A-Z0-9_]+)'/g)].map((m) => m[1]))].sort();
  assert.equal(KEYS.length, 61, 'the PR says 61 keys');
  assert.deepEqual(defKeys, [...KEYS].sort(), 'defaults vs migration');
  assert.deepEqual(regKeys, [...KEYS].sort(), 'LABEL_KEYS vs migration');
  assert.deepEqual(usedKeys, [...KEYS].sort(), 'keys used by emaRowTitles.ts + waveTrend.ts vs migration');
  assert.equal(new Set(regKeys).size, regKeys.length, 'a key is registered twice');
});

test('R2. migration shape: held, PROD block == DEV block, 61 keys x 5 locales, no duplicates, only the two label tables', () => {
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/);
  assert.deepEqual(prod, dev, 'PROD and DEV blocks differ');
  assert.equal(prod.length, 305);
  const seen = new Set<string>();
  for (const r of prod) { const id = `${r.key}/${r.locale}`; assert.ok(!seen.has(id), `duplicate ${id}`); seen.add(id); assert.ok(r.value.trim().length > 0, `empty ${id}`); }
  for (const k of KEYS) for (const l of LOCALES) assert.ok(seen.has(`${k}/${l}`), `missing ${k}/${l}`);
  assert.deepEqual([...new Set(prod.map((r) => r.locale))].sort(), [...LOCALES].sort());
  const tables = [...sql.matchAll(/\b(?:insert into|update(?!\s+set\b)|delete from|alter table|drop table|create table)\s+(\w+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual([...new Set(tables)].sort(), ['lhq_dev_labels', 'lhq_labels']);
  assert.equal([...sql.matchAll(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g)].length, 2);
  /* the file is the newest row for these keys: no other migration writes them */
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const others = readdirSync(dir).filter((f) => f !== MIG && /EMA_ROW_/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(others, [], 'another migration also writes EMA_ROW_ keys');
});

test('R3. every en row equals the shipped default', () => {
  for (const k of KEYS) assert.equal(val(k, 'en'), DEF[k], `${k}: en row differs from the shipped default`);
});

/* the vars each helper state supplies (R8 drives the same states); placeholders in every locale must be exactly this set */
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const ind = (kind: 'RSI' | 'SMA' | 'BOLL' | 'PSAR' | 'MACD', valid: boolean, bull: boolean, bear: boolean, bullAgrees: boolean, bearAgrees: boolean, vars: Record<string, string | number>) =>
  indicatorRef(kind, { valid, ribbonBull: bull, ribbonBear: bear, bullAgrees, bearAgrees, vars });
type State = { name: string; ref: { detailKey: string; detailVars?: Record<string, string | number> }; engine: string | null };
const STATES: State[] = [];
const add = (name: string, ref: State['ref'], engine: string | null) => STATES.push({ name, ref, engine });
const P = (n: number) => `$${fmt(n)}`;
add('sma200 none', sma200Ref({ have200D: false, above200D: false, counterTrend: false, cur: '$', priceD: 0, sma200: null, fmt }), 'Insufficient daily history - ribbon used as trend proxy');
add('sma200 above', sma200Ref({ have200D: true, above200D: true, counterTrend: false, cur: '$', priceD: 100.5, sma200: 90.25, fmt }), `Price ${P(100.5)} above Daily 200 SMA ${P(90.25)} - favours longs`);
add('sma200 above ct', sma200Ref({ have200D: true, above200D: true, counterTrend: true, cur: '$', priceD: 100.5, sma200: 90.25, fmt }), `Price ${P(100.5)} above Daily 200 SMA ${P(90.25)} - against a short`);
add('sma200 below', sma200Ref({ have200D: true, above200D: false, counterTrend: false, cur: '$', priceD: 80, sma200: 90.25, fmt }), `Price ${P(80)} below Daily 200 SMA ${P(90.25)} - favours shorts`);
add('sma200 below ct', sma200Ref({ have200D: true, above200D: false, counterTrend: true, cur: '$', priceD: 80, sma200: 90.25, fmt }), `Price ${P(80)} below Daily 200 SMA ${P(90.25)} - against a long`);
add('ribbon bull', ribbonRef({ ribbonBull: true, ribbonBear: false, ema9: 3, ema20: 2, ema50: 1, fmt }), 'Bullish: EMA9 3 > EMA20 2 > EMA50 1');
add('ribbon bear', ribbonRef({ ribbonBull: false, ribbonBear: true, ema9: 1, ema20: 2, ema50: 3, fmt }), 'Bearish: EMA50 3 > EMA20 2 > EMA9 1');
add('ribbon tangled', ribbonRef({ ribbonBull: false, ribbonBear: false, ema9: 1, ema20: 3, ema50: 2, fmt }), 'Not aligned - ribbon tangled');
add('cross bull yes', crossRef({ judgeLong: true, ema9: 5, ema20: 4, fmt }), 'EMA9 5 crossed above EMA20 4 - bullish cross confirmed');
add('cross bull wait', crossRef({ judgeLong: true, ema9: 4, ema20: 5, fmt }), 'EMA9 4 still below EMA20 5 - waiting for bullish cross');
add('cross bear yes', crossRef({ judgeLong: false, ema9: 4, ema20: 5, fmt }), 'EMA9 4 crossed below EMA20 5 - bearish cross confirmed');
add('cross bear wait', crossRef({ judgeLong: false, ema9: 5, ema20: 4, fmt }), 'EMA9 5 still above EMA20 4 - waiting for bearish cross');
add('close long yes', closeRef({ judgeLong: true, price: 10, ema50: 9, cur: '$', fmt }), `Close ${P(10)} above EMA50 ${P(9)} - long entry confirmed`);
add('close long wait', closeRef({ judgeLong: true, price: 8, ema50: 9, cur: '$', fmt }), `Close ${P(8)} below EMA50 ${P(9)} - wait for candle close above EMA 50`);
add('close short yes', closeRef({ judgeLong: false, price: 8, ema50: 9, cur: '$', fmt }), `Close ${P(8)} below EMA50 ${P(9)} - short entry confirmed`);
add('close short wait', closeRef({ judgeLong: false, price: 10, ema50: 9, cur: '$', fmt }), `Close ${P(10)} above EMA50 ${P(9)} - wait for candle close below EMA 50`);
add('zone in', zoneRef(true), 'Price in EMA9–EMA20 zone - entry eligible');
add('zone out', zoneRef(false), 'Not in value zone yet - wait for pullback to 20 EMA');
add('funding safe', fundingRef('btc', 0.0001, true, false), fundingDetail('btc', 0.0001, true, false));
add('funding excessive', fundingRef('btc', 0.0009, false, false), fundingDetail('btc', 0.0009, false, false));
add('funding none (no source)', fundingRef('fet', null, null, false), fundingDetail('fet', null, null, false));
add('funding none (grace over)', fundingRef('btc', null, null, true), fundingDetail('btc', null, null, true));
add('funding loading', fundingRef('btc', null, null, false), fundingDetail('btc', null, null, false));
add('oi none', oiDetailRef(null, null), 'Open interest data unavailable');
add('oi ok', oiDetailRef(1.234, true), 'Open interest +1.23% in 1h - stable or rising');
add('oi drop', oiDetailRef(-6.5, false), 'Open interest -6.50% in 1h - sharp drop');
add('vol none', volumeRef(0, 5e6), 'Volume data unavailable');
add('vol', volumeRef(2e6, 3e6), 'Candle vol 3.00M vs MA 2.00M (150%)');
add('rsi unavailable', ind('RSI', false, true, false, false, false, { value: '' }), 'RSI unavailable');
add('sma unavailable', ind('SMA', false, true, false, false, false, { value: '' }), 'SMA unavailable');
add('boll unavailable', ind('BOLL', false, true, false, false, false, { value: '' }), 'Bollinger unavailable');
add('psar unavailable', ind('PSAR', false, true, false, false, false, { value: '' }), 'PSAR unavailable');
add('macd unavailable', ind('MACD', false, true, false, false, false, { value: '' }), 'MACD unavailable');
/* [kind, name in the engine sentence, value text, agree/disagree phrases from the engine] */
const INDS: Array<['RSI' | 'SMA' | 'BOLL' | 'PSAR' | 'MACD', string, Record<string, string>, string, string[]]> = [
  ['RSI', 'RSI(14) 61.0 - ', { value: '61.0' }, 'RSI', ['above 50, agrees with the bullish ribbon', 'below 50, disagrees with the bullish ribbon', 'below 50, agrees with the bearish ribbon', 'above 50, disagrees with the bearish ribbon']],
  ['SMA', 'SMA(12) rolling mean 1.2000 - ', { value: '1.2000' }, 'SMA', ['price above, agrees with the bullish ribbon', 'price at or below, disagrees with the bullish ribbon - setup downgraded if it was one', 'price below, agrees with the bearish ribbon', 'price at or above, disagrees with the bearish ribbon - setup downgraded if it was one']],
  ['BOLL', 'Bollinger(20,2) mid 1.2000 - ', { value: '1.2000' }, 'Bollinger', ['price above, agrees with the bullish ribbon', 'price at or below, disagrees with the bullish ribbon - setup downgraded if it was one', 'price below, agrees with the bearish ribbon', 'price at or above, disagrees with the bearish ribbon - setup downgraded if it was one']],
  ['PSAR', 'PSAR 1.2000 - ', { value: '1.2000' }, 'PSAR', ['dot below price, agrees with the bullish ribbon', 'dot at or above price, disagrees with the bullish ribbon - setup downgraded if it was one', 'dot above price, agrees with the bearish ribbon', 'dot at or below price, disagrees with the bearish ribbon - setup downgraded if it was one']],
  ['MACD', 'MACD DIF 0.1000 / DEA 0.2000 - ', { dif: '0.1000', dea: '0.2000' }, 'MACD', ['DIF above DEA, agrees with the bullish ribbon', 'DIF at or below DEA, disagrees with the bullish ribbon - setup downgraded if it was one', 'DIF below DEA, agrees with the bearish ribbon', 'DIF at or above DEA, disagrees with the bearish ribbon - setup downgraded if it was one']],
];
for (const [kind, head, vars, , tails] of INDS) {
  add(`${kind} bull yes`, ind(kind, true, true, false, true, false, vars), head + tails[0]);
  add(`${kind} bull no`, ind(kind, true, true, false, false, false, vars), head + tails[1]);
  add(`${kind} bear yes`, ind(kind, true, false, true, false, true, vars), head + tails[2]);
  add(`${kind} bear no`, ind(kind, true, false, true, false, false, vars), head + tails[3]);
  add(`${kind} noalign`, ind(kind, true, false, false, false, false, vars), `${head}ribbon not aligned either way`);
}
/* the 8 WaveTrend states come from lib/waveTrend.ts: read the keys + vars straight from its return statements */
const WT = [
  ['EMA_ROW_WT_NO_DATA', undefined, 'Not enough data for WaveTrend'], ['EMA_ROW_WT_UNAVAILABLE', undefined, 'WaveTrend unavailable'],
  ['EMA_ROW_WT_DIV_BULL', { a: '1.0000', b: '2.0000' }, 'Price lower low (1.0000 < 2.0000) but WaveTrend higher low - bullish divergence'],
  ['EMA_ROW_WT_DIV_BEAR', { a: '3.0000', b: '2.0000' }, 'Price higher high (3.0000 > 2.0000) but WaveTrend lower high - bearish divergence'],
  ['EMA_ROW_WT_CROSS_BULL', { n: 3 }, 'WaveTrend crossed bullish from oversold 3 candle(s) ago - momentum confirms'],
  ['EMA_ROW_WT_CROSS_BEAR', { n: 3 }, 'WaveTrend crossed bearish from overbought 3 candle(s) ago - momentum confirms'],
  ['EMA_ROW_WT_NONE_BULL', { value: '12.3' }, 'WaveTrend at 12.3 - no recent bullish cross or divergence to confirm'],
  ['EMA_ROW_WT_NONE_BEAR', { value: '12.3' }, 'WaveTrend at 12.3 - no recent bearish cross or divergence to confirm'],
] as const;
for (const [k, v, eng] of WT) add(k, { detailKey: k, detailVars: v as Record<string, string | number> | undefined }, eng);

test('R4. placeholders: every locale carries the set the helper supplies for that state, and the same set as en', () => {
  for (const s of STATES) {
    const k = s.ref.detailKey; const supplied = Object.keys(s.ref.detailVars ?? {}).sort().join(',');
    for (const l of LOCALES) assert.equal(phSet(val(k, l)), supplied, `${k}/${l} placeholders {${phSet(val(k, l))}} vs supplied {${supplied}} (state: ${s.name})`);
  }
  for (const k of KEYS) { const en = ph(val(k, 'en')); for (const l of LOCALES) assert.deepEqual(ph(val(k, l)).sort(), en.sort(), `${k}/${l} uses a placeholder a different number of times than en`); }
  for (const r of prod) assert.doesNotMatch(r.value.replace(/\{\w+\}/g, ''), /[{}]/, `${r.key}/${r.locale} has a stray brace`);
});

test('R5. each locale is in its own script and leaks no other', () => {
  const HAN = /[一-鿿]/; const HANGUL = /[가-힯]/; const CYR = /[Ѐ-ӿ]/; const AR = /[؀-ۿ]/; const KANA = /[぀-ヿ]/;
  for (const r of prod) {
    const v = r.value.replace(/\{\w+\}/g, '');
    const has = { han: HAN.test(v), hangul: HANGUL.test(v), cyr: CYR.test(v), ar: AR.test(v), kana: KANA.test(v) };
    if (r.locale === 'en') assert.ok(!has.han && !has.hangul && !has.cyr && !has.ar && !has.kana, `${r.key}/en has non-Latin text`);
    if (r.locale === 'ko') { assert.ok(has.hangul, `${r.key}/ko has no Hangul`); assert.ok(!has.cyr && !has.ar && !has.kana, `${r.key}/ko leaks another script`); }
    if (r.locale === 'zh') { assert.ok(has.han, `${r.key}/zh has no Han`); assert.ok(!has.hangul && !has.cyr && !has.ar && !has.kana, `${r.key}/zh leaks another script (kana would mean Japanese)`); }
    if (r.locale === 'ru') { assert.ok(has.cyr, `${r.key}/ru has no Cyrillic`); assert.ok(!has.han && !has.hangul && !has.ar && !has.kana, `${r.key}/ru leaks another script`); }
    if (r.locale === 'ar') { assert.ok(has.ar, `${r.key}/ar has no Arabic`); assert.ok(!has.han && !has.hangul && !has.cyr && !has.kana, `${r.key}/ar leaks another script`); }
  }
});

/* R6: polar words per locale. A key whose en text says BULL must say bullish (and never bearish) in each locale, and the same for above/below and long/short. */
const W = {
  bull: { ko: /강세/, zh: /看涨/, ru: /бычь/i, ar: /صاعد/ }, bear: { ko: /약세/, zh: /看跌/, ru: /медвеж/i, ar: /هابط/ },
  above: { ko: /위|상향/, zh: /高于|上穿|站上|上方|在上/, ru: /выше|вверх|(?<![а-яё])над(?![а-яё])/i, ar: /فوق|صعود|أعلى/ }, below: { ko: /아래|하향/, zh: /低于|下穿|跌破|下方|在下/, ru: /ниже|вниз|(?<![а-яё])под(?![а-яё])/i, ar: /تحت|هبط|هبوط|أدنى/ },
  long: { ko: /롱/, zh: /做多/, ru: /лонг/i, ar: /الشراء/ }, short: { ko: /숏/, zh: /做空/, ru: /шорт/i, ar: /البيع/ },
} as const;
const first = (s: string) => s.split(' - ')[0];

test('R6. bull/bear, above/below, long/short words agree with the en key in every locale', () => {
  const checks: string[] = [];
  for (const k of KEYS) {
    const en = val(k, 'en'); const lc = en.toLowerCase();
    for (const l of ['ko', 'zh', 'ru', 'ar'] as const) {
      const v = val(k, l);
      const polar = (name: 'bull' | 'bear' | 'long' | 'short', want: boolean, text: string, scope: string) => {
        const has = (W[name][l] as RegExp).test(text);
        if (has !== want) checks.push(`${k}/${l}: ${scope} should ${want ? '' : 'not '}carry the ${name} word (${text})`);
      };
      /* the WaveTrend cross rows say "crossed bullish" with direction words (up-cross / down-cross), so they are held to the direction words below, not to the bull/bear noun */
      /* the noun (bullish / bearish) is held wherever the English sentence says it; a row reworded to a plain description (e.g. "EMA9 is still below EMA20") carries direction words only, checked below */
      if (/bullish/i.test(en) && !/WT_CROSS/.test(k)) { polar('bull', true, v, 'text'); polar('bear', false, v, 'text'); }
      if (/bearish/i.test(en) && !/WT_CROSS/.test(k)) { polar('bear', true, v, 'text'); polar('bull', false, v, 'text'); }
      if (/WT_CROSS_(BULL|BEAR)/.test(k)) {
        const up = /_BULL/.test(k); const upRe = new RegExp(`${(W.above[l] as RegExp).source}|상향|上穿|صعودًا`, 'i'); const dnRe = new RegExp(`${(W.below[l] as RegExp).source}|하향|下穿|هبوطًا`, 'i');
        if (!(up ? upRe.test(v) && !dnRe.test(v) : dnRe.test(v) && !upRe.test(v))) checks.push(`${k}/${l}: WaveTrend cross direction wrong (${v})`);
      }
      /* "long"/"short" in the sentence: the explicit-side rows. The *_WAIT close rows name no side (they say "above/below EMA 50") and are held to the first-clause check below. */
      if (/^EMA_ROW_(SMA200_ABOVE_LONGS|SMA200_BELOW_VS_LONG|CLOSE_LONG_YES)/.test(k)) { polar('long', true, v, 'text'); polar('short', false, v, 'text'); }
      if (/^EMA_ROW_(SMA200_BELOW_SHORTS|SMA200_ABOVE_VS_SHORT|CLOSE_SHORT_YES)/.test(k)) { polar('short', true, v, 'text'); polar('long', false, v, 'text'); }
      /* first clause: above/below must match en (clause 2 may name the opposite side, e.g. "below ... wait for close above") */
      if (/^(Price \{price\}|Close \{close\}|EMA9 \{e9\})/.test(en) && /\b(above|below)\b/.test(first(en)) && /^EMA_ROW_(SMA200|CLOSE|CROSS)/.test(k)) {
        const up = /\babove\b/.test(first(en));
        const cl = first(v);
        const gotUp = (W.above[l] as RegExp).test(cl); const gotDown = (W.below[l] as RegExp).test(cl);
        if (!(up ? gotUp && !gotDown : gotDown && !gotUp)) checks.push(`${k}/${l}: first clause should say ${up ? 'above' : 'below'} (${cl})`);
      }
      if (/crossed above|crossed below/.test(lc)) {
        const up = /crossed above/.test(lc);
        const gotUp = (W.above[l] as RegExp).test(v) || (l === 'zh' && /上穿/.test(v));
        const gotDown = (W.below[l] as RegExp).test(v) || (l === 'zh' && /下穿/.test(v));
        if (!(up ? gotUp && !gotDown : gotDown && !gotUp)) checks.push(`${k}/${l}: cross direction wrong (${v})`);
      }
    }
  }
  assert.deepEqual(checks, [], checks.join('\n'));
});

test('R7. numbers: ribbon bull e9>e20>e50 and bear e50>e20>e9 in every locale; cross e9 before e20; close rows carry {e50} next to EMA50', () => {
  const order = (s: string) => ph(s).join('>');
  for (const l of LOCALES) {
    assert.equal(order(val('EMA_ROW_RIBBON_BULL', l)), 'e9>e20>e50', `RIBBON_BULL/${l}`);
    assert.equal(order(val('EMA_ROW_RIBBON_BEAR', l)), 'e50>e20>e9', `RIBBON_BEAR/${l}`);
    for (const k of ['CROSS_BULL_YES', 'CROSS_BULL_WAIT', 'CROSS_BEAR_YES', 'CROSS_BEAR_WAIT']) assert.equal(order(val(`EMA_ROW_${k}`, l)), 'e9>e20', `${k}/${l}`);
    for (const k of ['CLOSE_LONG_YES', 'CLOSE_LONG_WAIT', 'CLOSE_SHORT_YES', 'CLOSE_SHORT_WAIT']) {
      const v = val(`EMA_ROW_${k}`, l);
      assert.equal(order(v), 'close>e50', `${k}/${l}`);
      assert.match(v, /EMA50 \{e50\}/, `${k}/${l}: the EMA 50 title must put EMA50 right before {e50}`);
      assert.doesNotMatch(v.replace(/EMA ?50/g, ''), /EMA ?(9|20)\b/, `${k}/${l} names another EMA period`);
    }
    for (const [k, num] of [['RIBBON_BULL', ['EMA9 {e9}', 'EMA20 {e20}', 'EMA50 {e50}']], ['RIBBON_BEAR', ['EMA9 {e9}', 'EMA20 {e20}', 'EMA50 {e50}']], ['CROSS_BULL_YES', ['EMA9 {e9}', 'EMA20 {e20}']]] as const) {
      for (const n of num) assert.ok(val(`EMA_ROW_${k}`, l).includes(n), `${k}/${l} lacks "${n}" (a number bound to the wrong EMA period)`);
    }
    assert.match(val('EMA_ROW_ZONE_IN', l), /EMA9.EMA20/, `ZONE_IN/${l} lost the EMA9-EMA20 zone`);
    assert.match(val('EMA_ROW_SMA200_ABOVE_LONGS', l), /200/, `SMA200/${l} lost "200"`);
    assert.match(val('EMA_ROW_RSI_BULL_YES', l), /RSI\(14\)/); assert.match(val('EMA_ROW_SMA_BULL_YES', l), /SMA\(12\)/); assert.match(val('EMA_ROW_BOLL_BULL_YES', l), /\(20,2\)/);
    assert.match(val('EMA_ROW_RSI_BULL_YES', l), /\b50\b/);
  }
});

test('R8. helper -> key -> sentence equals the engine sentence, state by state; all 61 keys are reached', () => {
  /* advice-bearing sentences are held to the placeholders only here: R12 decides their wording, and a reworded default must not turn R8 red */
  const ADVICE = new Set(['EMA_ROW_ZONE_IN', 'EMA_ROW_ZONE_OUT', 'EMA_ROW_CLOSE_LONG_WAIT', 'EMA_ROW_CLOSE_SHORT_WAIT', 'EMA_ROW_CLOSE_LONG_YES', 'EMA_ROW_CLOSE_SHORT_YES', 'EMA_ROW_FUNDING_SAFE', 'EMA_ROW_FUNDING_EXCESSIVE', 'EMA_ROW_OI_DROP', 'EMA_ROW_CROSS_BULL_WAIT', 'EMA_ROW_CROSS_BEAR_WAIT']);
  /* the four the PR shortened on purpose (20-word budget): the engine says "if it was one" */
  const SHORTENED = new Set(['EMA_ROW_SMA_BULL_NO', 'EMA_ROW_SMA_BEAR_NO', 'EMA_ROW_MACD_BULL_NO', 'EMA_ROW_MACD_BEAR_NO']);
  const reached = new Set<string>(); const bad: string[] = [];
  for (const s of STATES) {
    const k = s.ref.detailKey; reached.add(k);
    assert.ok(k in DEF, `${k} has no default`);
    const got = fill(DEF[k], s.ref.detailVars);
    assert.doesNotMatch(got, /\{\w+\}/, `${s.name}: an unfilled placeholder shows on screen: ${got}`);
    if (s.engine == null || ADVICE.has(k)) continue;
    const want = SHORTENED.has(k) ? s.engine.replace(' - setup downgraded if it was one', '').replace(/ - setup downgraded if it was one$/, '') : s.engine;
    const norm = (x: string) => x.replace(/;? ?-? ?setup downgraded( if any)?$/, '').replace(/ - setup downgraded if it was one$/, '');
    if (SHORTENED.has(k)) { if (norm(got) !== norm(want)) bad.push(`${s.name} [${k}]: "${got}" vs engine "${s.engine}"`); } else if (got !== want) bad.push(`${s.name} [${k}]: "${got}" vs engine "${want}"`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.deepEqual([...KEYS].filter((k) => !reached.has(k)), [], 'a key no helper state reaches (dead copy)');
  assert.equal(reached.size, 61);
});

test('R9. wiring: each row spreads its own helper; the explain/AI paths still read English detail; the title reads detailKey+detailVars', () => {
  const src = read('../lib/useEMAStrategy.ts');
  const want: Record<string, string> = {
    '200 SMA Filter (Daily)': 'sma200Ref', 'Ribbon Aligned': 'ribbonRef', 'Trend Signal (fast/slow cross)': 'crossRef', 'Close vs EMA 50': 'closeRef', 'Price in Value Zone': 'zoneRef',
    'Funding Rate': 'fundingRef', 'Open Interest Confirming': 'oiDetailRef', 'Volume Above MA': 'volumeRef',
    'RSI Confirming': "indicatorRef('RSI'", 'SMA Confirming': "indicatorRef('SMA'", 'Bollinger Confirming': "indicatorRef('BOLL'", 'PSAR Confirming': "indicatorRef('PSAR'", 'MACD Confirming': "indicatorRef('MACD'",
  };
  const i0 = src.indexOf('const conditions: StrategyCondition[] = [');
  assert.ok(i0 > 0, 'conditions array not found');
  const body = src.slice(i0, src.indexOf('// Find most recent candle where EMA 9/20 crossed'));
  const parts = body.split(/\n\s+label: '/).slice(1);
  assert.equal(parts.length, 15, 'the checklist has 15 possible rows (counter-trend + 14)');
  for (const p of parts) {
    const label = p.slice(0, p.indexOf("'"));
    if (label === 'Counter-trend') { assert.match(p, /detailKey:/); assert.doesNotMatch(p, /Ref\(/, 'the counter-trend row must keep its own detailKey'); continue; }
    if (label === 'WaveTrend Confirming') { assert.match(p, /wtConfirm\.detailKey/); assert.match(p, /detailVars: wtConfirm\.detailVars/); continue; }
    assert.ok(label in want, `unexpected row ${label}`);
    const spreads = [...p.matchAll(/\.\.\.(\w+Ref)\(\s*('?\w*)/g)].map((m) => m[1] + (m[1] === 'indicatorRef' ? `('${m[2].replace(/'/g, '')}` : ''));
    assert.equal(spreads.length, 1, `${label}: exactly one helper spread, got ${spreads.join(',')}`);
    assert.equal(spreads[0], want[label].replace(/'$/, ''), `${label} spreads ${spreads[0]}`);
  }
  /* the English detail strings the prompt is built from are still literal text in the hook */
  for (const s of ['Insufficient daily history - ribbon used as trend proxy', 'Not aligned - ribbon tangled', 'Open interest data unavailable', 'Volume data unavailable']) assert.ok(src.includes(s), `engine English sentence gone: ${s}`);
  const comp = read('../components/EMASignal.tsx');
  assert.match(comp, /title=\{canExplain \? t\('EMA_SIGNAL_COND_EXPLAIN_TITLE', \{ label: condLabel\(c\.label\) \}\) : \(c\.detailKey \? t\(c\.detailKey, c\.detailVars\) : c\.detail\)\}/, 'title: explain label when explainable, else t(detailKey, detailVars), English detail only as fallback');
  assert.match(comp, /buildConditionPrompt\(c\.label, c\.pass, c\.detail, coin!, tf\)/, 'explain prompt must still be built from the English detail');
  assert.match(comp, /\$\{c\.label\}: \$\{c\.detail\}/, 'context lines must still use the English detail');
  assert.match(read('../app/(main)/arena/page.tsx'), /\$\{c\.detail\}/, 'arena AI context must still use the English detail');
  assert.doesNotMatch(comp, /buildConditionPrompt\([^)]*detailKey/, 'the AI prompt must not take the localized text');
});

test('R10. no title longer than the PR\'s 20-word budget (en; placeholders count as one word); other locales printed', () => {
  const words = (s: string) => s.trim().split(/\s+/).length;
  const long = KEYS.filter((k) => words(val(k, 'en')) > 20 || words(DEF[k]) > 20).map((k) => `${k}: ${words(val(k, 'en'))} words (migration), ${words(DEF[k])} words (default)`);
  assert.deepEqual(long, [], long.join('\n'));
  const max = Object.fromEntries(LOCALES.map((l) => [l, Math.max(...KEYS.map((k) => val(k, l).length))]));
  console.log(`[EMA-ROW-LENGTH] longest title in characters per locale: ${JSON.stringify(max)}; longest en words: ${Math.max(...KEYS.map((k) => words(val(k, 'en'))))}`);
});

test('R11. no AI vendor or model is named in any default or stored row', () => {
  const VENDOR = /\b(grok|xai|x\.ai|openai|chatgpt|gpt-?\d*|claude|anthropic|gemini|llama|deepseek|mistral|copilot)\b/i;
  const hits = [...prod.map((r) => `${r.key}/${r.locale}: ${r.value}`), ...KEYS.map((k) => `${k}/default: ${DEF[k]}`)].filter((s) => VENDOR.test(s));
  assert.deepEqual(hits, []);
});

/* the repo's own banned list (copyNoForecastAdvice.test.mts), unchanged */
const BANNED = /\bwait for\b|\bstay out\b|\breduce size\b|\bmay push\b|\bpush(?:es)? price\b|\btends? to\b|\bpump\b|\bdump\b|\bmagnet\b|\bheadwind\b|\btailwind\b|\brisk-(?:on|off)\b|\bdanger\b|\bso you know\b|\bbig players\b|\btaking profit\b|\bgood time\b|\btrade now\b|\bpotential diversification\b|\bentry possible\b|\bbefore the\b.*\bpump\b|\bwait,?\s*$|\bwill (?:rise|fall|drop|pump|dump)\b/i;
/* QA's extension for the same rule (the product describes what the data shows, it never advises): verbs and phrases the EMA row sentences use */
const ADVICE_EN = /\bskip entry\b|\bproceed\b|\babort\b|\bentry eligible\b|\bentry possible\b|\bwait for\b/i;
const ADVICE_LOCAL: Record<string, RegExp> = { ko: /(?:기다리세요|보류|진행 가능|진입 가능|중단)/, zh: /(?:可入场|可继续|跳过入场|放弃)/, ru: /(?:ждите|пропустите|можно продолжать|вход возможен|отмена)/i, ar: /(?:انتظر|تجنب|يمكن المتابعة|الدخول متاح|إلغاء)/ };

test('R12a. the repo\'s forecast/advice rule (copyNoForecastAdvice BANNED list + Z4 "entry eligible/possible") holds for every new EMA_ROW default', () => {
  const hits = KEYS.filter((k) => BANNED.test(DEF[k]) || /entry (?:eligible|possible)/i.test(DEF[k])).map((k) => `${k}: ${DEF[k]}`);
  assert.deepEqual(hits, [], `banned wording in the new defaults (dev already removed "entry eligible" from EMA_PHASE_VALUE_ZONE_* for this rule):\n${hits.join('\n')}`);
});

test('R12b. QA extension of the same rule: no advice verbs (skip entry, proceed, abort, wait for) in en, and no imperative advice in ko/zh/ru/ar', () => {
  const hits: string[] = [];
  for (const k of KEYS) {
    if (ADVICE_EN.test(DEF[k])) hits.push(`${k}/en: ${DEF[k]}`);
    for (const l of ['ko', 'zh', 'ru', 'ar']) if (ADVICE_LOCAL[l].test(val(k, l))) hits.push(`${k}/${l}: ${val(k, l)}`);
  }
  assert.deepEqual(hits, [], `advice wording in the new rows:\n${hits.join('\n')}`);
});

test('R13. the REAL getWaveTrendConfirmation (lib/waveTrend.ts), driven over seeded series: every result carries the key + vars whose filled default equals its own English detail', async () => {
  /* lib/waveTrend.ts mixes a type into a value import (`import { OHLCV, emaArr, smaArr }`), which node's strip-only mode cannot load. Load an unchanged copy with only those two import lines patched; the engine code under test is byte for byte the PR's. */
  const orig = read('../lib/waveTrend.ts');
  const patched = orig
    .replace("import { OHLCV, emaArr, smaArr } from './strategyCore.ts';", `import { emaArr, smaArr } from '${new URL('../lib/strategyCore.ts', import.meta.url).href}';\ntype OHLCV = { time: number; open: number; high: number; low: number; close: number; volume: number };`)
    .replace("import type { LabelKey } from './labelKeys.ts';", 'type LabelKey = string;');
  assert.notEqual(patched, orig, 'import lines changed upstream: update this loader');
  assert.ok(!patched.includes("from './strategyCore.ts'") && !patched.includes("from './labelKeys.ts'"), 'a relative import is left in the patched copy');
  const dir = mkdtempSync(join(tmpdir(), 'wt-2663-')); const file = join(dir, 'waveTrend.mts'); writeFileSync(file, patched);
  const { getWaveTrendConfirmation, DEFAULT_WT_PARAMS } = await import(pathToFileURL(file).href) as typeof import('../lib/waveTrend.ts');
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const series = (n: number, vol: number) => { let p = 100; return Array.from({ length: n }, (_, i) => { const o = p; p = Math.max(1, p * (1 + (rnd() - 0.5) * vol)); const hi = Math.max(o, p) * (1 + rnd() * vol / 3); const lo = Math.min(o, p) * (1 - rnd() * vol / 3); return { time: i * 3600, open: o, high: hi, low: lo, close: p, volume: 1000 + rnd() * 500 }; }); };
  const reached = new Map<string, number>(); const bad: string[] = [];
  const seen = (r: ReturnType<typeof getWaveTrendConfirmation>) => {
    assert.ok(r.detailKey, `no detailKey for "${r.detail}"`);
    reached.set(r.detailKey!, (reached.get(r.detailKey!) ?? 0) + 1);
    const got = fill(DEF[r.detailKey!], r.detailVars);
    if (got !== r.detail) bad.push(`${r.detailKey}: "${got}" vs engine "${r.detail}"`);
    const supplied = Object.keys(r.detailVars ?? {}).sort().join(',');
    if (supplied !== phSet(DEF[r.detailKey!])) bad.push(`${r.detailKey}: vars {${supplied}} vs placeholders {${phSet(DEF[r.detailKey!])}}`);
    for (const l of LOCALES) if (phSet(val(r.detailKey!, l)) !== supplied) bad.push(`${r.detailKey}/${l}: placeholders differ from supplied vars`);
  };
  seen(getWaveTrendConfirmation(series(20, 0.02), 'long'));
  seen(getWaveTrendConfirmation(series(80, 0.02), null));
  const paramSets = [DEFAULT_WT_PARAMS, { ...DEFAULT_WT_PARAMS, requireCross: false }, { ...DEFAULT_WT_PARAMS, crossWindowBars: 40 }, { ...DEFAULT_WT_PARAMS, useArmWindow: true }];
  for (let i = 0; i < 600; i++) {
    const c = series(120 + (i % 60), 0.01 + (i % 7) * 0.01);
    for (const dir of ['long', 'short'] as const) for (const p of paramSets) seen(getWaveTrendConfirmation(c, dir, i % 3 === 0 ? 100 : undefined, p));
  }
  assert.deepEqual(bad.slice(0, 12), [], bad.slice(0, 12).join('\n'));
  const want = ['EMA_ROW_WT_NO_DATA', 'EMA_ROW_WT_UNAVAILABLE', 'EMA_ROW_WT_DIV_BULL', 'EMA_ROW_WT_DIV_BEAR', 'EMA_ROW_WT_CROSS_BULL', 'EMA_ROW_WT_CROSS_BEAR', 'EMA_ROW_WT_NONE_BULL', 'EMA_ROW_WT_NONE_BEAR'];
  console.log(`[WT-REACH] ${JSON.stringify(Object.fromEntries(reached))}`);
  assert.deepEqual(want.filter((k) => !reached.has(k)), [], 'a WaveTrend state the series never reached: widen the series, not the assertion');
});
