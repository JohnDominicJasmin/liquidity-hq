/* QA: PR #2849 (#1185 item 99): the coin drop-down has a name for screen readers.
 *   N1 the combobox is always named: the caller's heading, else "Select coins…"
 *   N2 Settings names the watchlist one with its heading; the label is shipped */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('N1. always named', () => {
  const c = read('components/CoinMultiSelect.tsx');
  const trigger = c.slice(c.indexOf('role="combobox"'), c.indexOf('aria-expanded={open}', c.indexOf('role="combobox"')));
  assert.ok(trigger.includes("aria-label={label ?? t('COIN_SELECT_PLACEHOLDER')}"));
  assert.equal(c.split('role="combobox"').length - 1, 1, 'CONTROL: one trigger');
});

test('N2. Settings passes the heading', () => {
  const s = read('app/(main)/settings/page.tsx');
  assert.ok(s.includes("<CoinMultiSelect\n          label={t('SETTINGS_SECTION_WATCHLIST')}"));
  const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.ok(en.SETTINGS_SECTION_WATCHLIST && en.COIN_SELECT_PLACEHOLDER);
});
