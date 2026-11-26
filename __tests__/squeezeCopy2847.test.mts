/* QA: PR #2847 (#1185 item 100): the copy about the Scanner's squeeze score says the number the Scanner uses.
 *   S1 the Scanner's strong line and the chart marker are 65; Help, About and the explainer say 65 (shipped English, both files)
 *   S2 the held rows say 65 in every language they carry, never 70; the Telegram alert copy still says 70 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const KEYS = ['ABOUT_STEP1_TEXT', 'HELP_Q_FIRST_LOOK_A', 'SEO_SCANNER_A1'];

test('S1. the code and the English copy agree on 65', () => {
  assert.equal(read('components/SetupScanner.tsx').split("r.score >= 65 && r.dir !== 'NEUTRAL'").length - 1, 2, 'the Scanner no longer uses 65: this copy must follow');
  assert.ok(read('components/KLineProChart.tsx').includes('sq.score >= 65'));
  for (const file of ['lib/labelDefaults.en.json', 'lib/labelDefaults.critical.json']) {
    const j = JSON.parse(read(file)) as Record<string, string>;
    for (const k of KEYS.filter((k) => j[k] !== undefined)) { assert.match(j[k], /\b65\+?/, `${file} ${k}`); assert.doesNotMatch(j[k], /\b70\b|70\+/, `${file} ${k}`); }
  }
  assert.match((JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>).ALERTS_SQUEEZE_TITLE, /70/, 'the Telegram alert threshold is a different number');
});

test('S2. every held row says 65', () => {
  const sql = read('supabase/migrations/20261130n_labels_scanner_squeeze_score_65.sql');
  const rows = [...sql.matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)];
  assert.equal(rows.length, 26, '13 rows in each block');
  for (const [, key, locale, value] of rows) { assert.ok(KEYS.includes(key), key); assert.match(value, /65/, `${key}/${locale}`); assert.doesNotMatch(value, /70/, `${key}/${locale}`); }
});
