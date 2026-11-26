/* QA: PR #2825 (#1263 owner item 66). A failed price-alert request says a label, never the server's words.
 *   E1 each refusal code and a 401 pick their own label; the limit sentence is given the real cap
 *   E2 an unknown code, no code, a raw server sentence or a browser message get the caller's own "it failed" label, and are not shown
 *   E3 every refusal code the add path can answer has its own label (a new code in the route turns this red)
 *   E4 neither page prints the route's error or message for price alerts, and a request with no answer shows a label
 *   E5 the four new keys are registered, shipped in English and held for five languages */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alertErrorText } from '../lib/alertErrorText';
import { ACTIVE_ALERT_CAP } from '../lib/ownRowLimits';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const say = (status: number, code?: string) => alertErrorText(t, status, code, 'ALERTS_ADD_ALERT_FAILED');
const CODES: Record<string, string> = {
  PRO_REQUIRED: 'ALERTS_PRICE_LOCKED_DESC', COIN_NOT_COVERED: 'ARENA_ALERT_MAIN_COINS_ONLY', ALERT_LIMIT: `ALERTS_ERR_LIMIT {"max":${ACTIVE_ALERT_CAP}}`,
  TOO_LONG: 'ALERTS_ERR_NOTE_TOO_LONG', INVALID_INPUT: 'ALERTS_ERR_INVALID',
};

test('E1. codes and 401 pick their labels', () => {
  for (const [code, label] of Object.entries(CODES)) assert.equal(say(400, code), label, code);
  assert.equal(say(401, 'Unauthorized'), 'ALERTS_ERR_SIGN_IN');
});

test('E2. anything else is the fallback, and the server text is never shown', () => {
  for (const code of [undefined, '', 'Request body too large', 'Not found', 'coin, target_price, direction required', 'ROW_LIMIT', 'Failed to fetch']) assert.equal(say(500, code), 'ALERTS_ADD_ALERT_FAILED', String(code));
  assert.equal(alertErrorText(t, 404, 'Not found', 'ALERTS_REMOVE_ALERT_FAILED'), 'ALERTS_REMOVE_ALERT_FAILED');
});

test('E3. every code the route answers on adding has a label', () => {
  const route = read('app/api/price-alerts/route.ts');
  const codes = new Set([...route.matchAll(/error: '([A-Z][A-Z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.has('ALERT_LIMIT') && codes.has('INVALID_INPUT'), `CONTROL: ${[...codes]}`);
  for (const code of codes) assert.ok(code in CODES, `${code}: the route answers it and the pages have no label for it`);
});

test('E4. neither page prints the route\'s words for price alerts', () => {
  const alerts = read('app/(main)/alerts/page.tsx');
  assert.ok(alerts.includes("setPaError(alertErrorText(t, res.status, d.error, 'ALERTS_ADD_ALERT_FAILED'))"));
  assert.ok(alerts.includes("setPaError(alertErrorText(t, res.status, d.error, 'ALERTS_REMOVE_ALERT_FAILED'))"));
  assert.equal(/setPaError\([^)\n]*(e\.message|d\.error \?\?|d\.message)/.test(alerts), false);
  const arena = read('app/(main)/arena/page.tsx');
  assert.ok(arena.includes("setAlertError(alertErrorText(t, res.status, d.error, 'ALERTS_ADD_ALERT_FAILED'));"));
  assert.equal(/setAlertError\([^)\n]*(\.message|d\.error \?\?)/.test(arena), false);
});

test('E5. keys registered, shipped and held', () => {
  const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const keys = read('lib/labelKeys.ts');
  const sql = read('supabase/migrations/20261130i_labels_price_alert_errors.sql');
  for (const k of ['ALERTS_ERR_SIGN_IN', 'ALERTS_ERR_LIMIT', 'ALERTS_ERR_NOTE_TOO_LONG', 'ALERTS_ERR_INVALID']) {
    assert.ok(keys.includes(`'${k}'`) && en[k], k);
    for (const locale of ['en', 'ko', 'zh', 'ru', 'ar']) assert.equal(sql.split(`('${k}','${locale}',`).length - 1, 2, `${k}/${locale}: PROD and DEV`);
  }
  assert.ok(en.ALERTS_ERR_LIMIT.includes('{max}'));
});
