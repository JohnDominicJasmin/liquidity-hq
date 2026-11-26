/* QA: PR #2853 (#1185 item 104): the onboarding tour's example card reads in the app's own words.
 *   T1 no internal setup code and no "FR+" in the tour component or in any shipped tour string
 *   T2 the pill and the funding chip come from the app's own labels
 *   T3 the label file: PROD and DEV blocks hold the same 3 keys x 5 languages; English equals the shipped default; each sentence uses its language's own "Short-heavy" words */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const code = read('components/SpotlightTour.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const CODES = /(LONG|SHORT)_SQ|\bFR[+-](?![A-Za-z])/;

test('T1. no internal codes', () => {
  assert.ok(CODES.test('BTC SHORT_SQ 82/100') && CODES.test("'FR+']"), 'CONTROL: the pattern finds both');
  assert.doesNotMatch(code, CODES);
  const keys = Object.keys(en).filter((k) => k.startsWith('SPOTLIGHT_TOUR_'));
  assert.ok(keys.length > 20, `CONTROL: ${keys.length} tour strings`);
  assert.deepEqual(keys.filter((k) => CODES.test(en[k])), []);
});

test('T2. the pill and the chip use the app\'s own labels', () => {
  assert.ok(code.includes("{t('SETUP_WORD_SQUEEZE')}</span>"));
  assert.ok(code.includes("t('SPOTLIGHT_TOUR_CHIP_SHORTS_PAYING')]"));
  assert.equal(en.SETUP_WORD_SQUEEZE, 'Short-heavy');
});

const KEYS = ['SPOTLIGHT_TOUR_ALERT_FIRED', 'SPOTLIGHT_TOUR_CARD3_SUB', 'SPOTLIGHT_TOUR_TELEGRAM_BODY'];
const WORDS: Record<string, string> = { ar: 'غلبة مراكز البيع', en: 'short-heavy', ko: '숏 우세', ru: 'перекос в шорты', zh: '空头偏重' };

test('T3. the label file', () => {
  const sql = read('supabase/migrations/20261130o_labels_tour_example_plain_words.sql');
  const blocks = sql.split(/insert into (lhq(?:_dev)?_labels) \(key, locale, value\) values/).slice(1);
  assert.deepEqual([blocks[0], blocks[2]], ['lhq_labels', 'lhq_dev_labels']);
  const rows = (b: string) => [...b.matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((m) => [m[1], m[2], m[3]] as const);
  const prod = rows(blocks[1]), dev = rows(blocks[3]);
  assert.deepEqual(prod, dev);
  assert.deepEqual(prod.map(([k, l]) => `${k} ${l}`).sort(), KEYS.flatMap((k) => Object.keys(WORDS).map((l) => `${k} ${l}`)).sort());
  for (const [k, l, v] of prod) {
    assert.doesNotMatch(v, CODES, `${k} ${l}`);
    assert.ok(v.toLowerCase().includes(WORDS[l]), `${k} ${l}: not the app's words`);
    if (l === 'en') assert.equal(v, en[k], k);
    const score = /ALERT/.test(k) ? '87/100' : /TELEGRAM/.test(k) ? '82/100' : null;
    if (score) assert.ok(v.includes(score), `${k} ${l}: the score`);
  }
});
