/* #2507: the multi-timeframe card and the EMA card never sit on a skeleton forever.
 *   M1  MTF: with fewer than two RSI readings the verdict is "Loading…" for 20 s (or until the price feed reports failed), then "No data"; never "Mixed"
 *   M2  MTF: the grace timer restarts per coin, is cleared on cleanup, and a reading arriving later (noData false) replaces the state at once
 *   M3  EMA: after 20 s of loading for the same coin and timeframe the badge says Unavailable; the timer is keyed on loading/coin/tf and cleared, so a later signal replaces it
 *   M4  the two new keys exist in the defaults, are registered in labelKeys, and have a stored row in all five locales
 * WHAT IT CANNOT PROVE: the rendered card (browser cell). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('M1/M2. MTF: Loading for 20 s or until the feed fails, then No data; a late reading replaces it', () => {
  const s = read('components/MultiTFAlignment.tsx');
  assert.match(s, /const noData = biases\.filter\(b => b !== 'unknown'\)\.length < 2;/);
  assert.match(s, /setTimeout\(\(\) => setGraceOver\(true\), 20_000\)/);
  assert.match(s, /\}, \[noData, coin\]\);/, 'the grace timer must restart per coin and when the data state flips');
  assert.match(s, /return \(\) => clearTimeout\(id\)/);
  assert.match(s, /const noDataShown = noData && \(graceOver \|\| store\.pricesFailed\);/);
  assert.match(s, /const loadingState = noData && !noDataShown;/);
  assert.match(s, /verdictLabel = loadingState \? t\('EMA_PHASE_LOADING'\) : noData \? t\('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA'\)/, 'loading must come before no data, and no data before any verdict');
  assert.match(s, /footerText = loadingState\s*\? ''\s*:\s*noData\s*\? t\('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA'\)/);
  assert.match(s, /if \(!noData\) return;/, 'no timer once data is present');
});

test('M3. EMA: Unavailable after 20 s of loading, replaced by a later signal', () => {
  const s = read('components/EMASignal.tsx');
  assert.match(s, /setTimeout\(\(\) => setLoadingTooLong\(true\), 20_000\)/);
  assert.match(s, /\}, \[signal\.loading, coin, tf\]\);/);
  assert.match(s, /setLoadingTooLong\(false\);\s*if \(!signal\.loading\) return;/, 'the flag must reset first, so a later signal clears Unavailable');
  assert.match(s, /return \(\) => clearTimeout\(id\)/);
  assert.match(s, /loadingTooLong \? t\('STATE_UNAVAILABLE'\)/);
});

test('M4. the two new keys: default, registered, and a stored row in en/ko/zh/ru/ar', () => {
  const def = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  for (const k of ['MULTI_TF_ALIGNMENT_VERDICT_NO_DATA', 'MULTI_TF_ALIGNMENT_FOOTER_NO_DATA']) {
    assert.ok(def[k], `${k} has no default`); assert.ok(read('lib/labelKeys.ts').includes(`'${k}'`), `${k} is not in labelKeys`);
    const sql = read('supabase/migrations/20261118g_labels_multi_tf_no_data.sql');
    for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) assert.match(sql, new RegExp(`'${k}'\\s*,\\s*'${loc}'\\s*,\\s*'[^']+'`), `${k}/${loc} has no stored row`);
  }
});
