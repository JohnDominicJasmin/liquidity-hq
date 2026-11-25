/* QA: PR #2843 (owner item 74), the held Korean rows for labels that showed English.
 *   K1 eleven keys, Korean rows only, the same in both blocks; each key is registered and shipped
 *   K2 every value holds Korean script and keeps exactly the English text's placeholders; brand names stay
 *   K3 legal text is not among them */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261130m_labels_korean_shown_in_english.sql');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const [prod, dev] = sql.split(/-- =+ DEV =+/);
const rows = (block: string) => [...block.matchAll(/\('([A-Z0-9_]+)','([a-zA-Z-]+)','((?:[^']|'')*)'\)/g)].map((m) => ({ key: m[1], locale: m[2], value: m[3].replace(/''/g, "'") }));
const KEYS = ['ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE', 'BTC_RISK_LEVEL_BAR_LOW', 'DASH_PULSE_VOL_LABEL', 'GLOBAL_MACRO_CONTEXT_PREPARING', 'LEARN_CONTENT_RESULTS_COUNT', 'LIQ_HEATMAP_ESTIMATED_TAG', 'SETUP_SCANNER_TAKER_NONE', 'SETUP_SCANNER_TAKER_VAL', 'WHALE_TRADES_FEED_BADGE_MEGA', 'WHALE_TRADES_FEED_BADGE_WHALE'];

test('K1. eleven Korean rows, the same in both blocks', () => {
  const p = rows(prod), d = rows(dev ?? '');
  assert.deepEqual(p.map((r) => r.key).sort(), [...KEYS].sort());
  assert.deepEqual(d, p);
  assert.ok(p.every((r) => r.locale === 'ko'));
  assert.ok(/insert into lhq_labels /.test(prod) && /insert into lhq_dev_labels /.test(dev ?? ''));
  const keys = read('lib/labelKeys.ts');
  for (const k of KEYS) assert.ok(en[k] !== undefined && keys.includes(`'${k}'`), k);
});

test('K2. Korean, with the same placeholders', () => {
  const holders = (s: string) => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort();
  for (const r of rows(prod)) {
    assert.match(r.value, /[가-힣]/, r.key);
    assert.deepEqual(holders(r.value), holders(en[r.key]), r.key);
  }
  assert.ok(rows(prod).find((r) => r.key === 'ARENA_LIVE_BADGE')!.value.includes('LiquidityAI'));
});

test('K3. no legal text', () => {
  assert.equal(rows(sql).some((r) => /^(PRIVACY|TERMS|DISCLAIMER|REFUND)_/.test(r.key)), false);
});
