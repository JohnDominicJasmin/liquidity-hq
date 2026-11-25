/* QA: PR #2808 (#1630 owner item 9), Pro copy states the real price-alert limit. The number comes from the code that enforces it (lib/ownRowLimits.ts ACTIVE_ALERT_CAP), so a changed cap turns the copy red.
 *   C1 the three shipped labels carry the cap and none promises unlimited price alerts
 *   C2 the landing pricing line carries the cap in each of its five languages
 *   C3 the migration's rows carry it in every language, prod and dev the same */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVE_ALERT_CAP } from '../lib/ownRowLimits.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CAP = new RegExp(`(?<!\\d)${ACTIVE_ALERT_CAP}(?!\\d)`);
const UNLIMITED = /unlimited price alerts|unlimited alerts|무제한 가격 알림|无限价格提醒|تنبيهات أسعار غير محدودة|[Нн]еограниченные оповещения/i;
const KEYS = ['UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS', 'FAQ_Q_FREE_VS_PRO_A', 'HELP_Q_TRIAL_A'];

test('C1. the shipped labels state the cap and promise no unlimited price alerts', () => {
  for (const file of ['lib/labelDefaults.en.json', 'lib/labelDefaults.critical.json']) {
    const d = JSON.parse(read(file)) as Record<string, string>;
    if (file.endsWith('en.json')) for (const k of KEYS) assert.match(d[k], CAP, `${k} does not say ${ACTIVE_ALERT_CAP}`);
    for (const [k, v] of Object.entries(d)) assert.equal(UNLIMITED.test(v), false, `${file} ${k}: "${v.slice(0, 120)}"`);
  }
});

test('C2. the landing pricing line states the cap in five languages', () => {
  const s = read('lib/i18n/dictionaries.ts');
  const values = [...s.matchAll(/\bunlimitedAlerts: '([^']*)'/g)].map((m) => m[1]);
  assert.equal(values.length, 5, `CONTROL: ${values.length} landing lines found`);
  for (const v of values) { assert.match(v, CAP, v); assert.equal(UNLIMITED.test(v), false, v); }
});

test('C3. the migration rows state the cap, prod and dev the same', () => {
  const sql = read('supabase/migrations/20261130d_labels_price_alerts_cap_copy.sql');
  const rows = [...sql.matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((m) => ({ id: `${m[1]} ${m[2]}`, v: m[3] }));
  assert.equal(rows.length, 28, `CONTROL: ${rows.length} rows parsed (14 per block)`);
  for (const r of rows) { assert.match(r.v, CAP, r.id); assert.equal(UNLIMITED.test(r.v), false, r.id); }
  assert.deepEqual(rows.slice(0, 14), rows.slice(14), 'prod and dev differ');
});
