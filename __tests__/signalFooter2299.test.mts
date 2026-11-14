import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* QA's cells for #2299 (owner option A on #1651): one plain line on /alerts and on every signal alert. flushSignals is not exported and the cron needs CRON_SECRET + Telegram, so these are
 * SOURCE guards on the route and the label files (not a send). The live page cells come after PM's dev apply of 20261114b. */
const route = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8');
const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
const keys = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8');
const BS = String.fromCharCode(92);                         // one backslash: the route source spells its newlines as backslash-n

const footerDef = /const SIGNAL_FOOTER = "([^"]*)";/.exec(route);
test('a. the footer constant is one italic Telegram line that says signals, not predictions', () => {
  assert.ok(footerDef, 'SIGNAL_FOOTER is not defined');
  const body = footerDef![1];
  assert.ok(body.startsWith(BS + 'n' + BS + 'n<i>Signals, not predictions.'), `starts with: ${body.slice(0, 40)}`);
  assert.ok(body.endsWith('</i>'));
});
test('b. the English label is the same sentence as the footer (page and message say one thing)', () => {
  const sentence = footerDef![1].replace(BS + 'n' + BS + 'n<i>', '').replace(/<\/i>$/, '');
  assert.equal(en.ALERTS_SIGNALS_NOT_PREDICTIONS, sentence);
});
test('c. the single-signal and the confluence-group message both carry the footer', () => {
  const start = route.indexOf('async function flushSignals');
  const fn = route.slice(start, start + 6000);
  assert.ok(fn.includes('tg(token, chatIds, elig[0].body + SIGNAL_FOOTER)'), 'single signal');
  assert.ok(fn.includes('`<i>${stamp}</i>` + SIGNAL_FOOTER'), 'N Signals Aligned group');
});
test('d. CONTROL: the footer appears only in its definition and the two flushSignals sends: price alerts and the rest of the cron are untouched', () => {
  assert.equal(route.split('SIGNAL_FOOTER').length - 1, 3, 'definition + two uses');
  const fnStart = route.indexOf('async function flushSignals');
  const outside = route.slice(0, fnStart) + route.slice(fnStart + 6000);
  assert.equal((outside.match(/SIGNAL_FOOTER/g) || []).length, 1, 'only the definition outside flushSignals');
});
test('e. the label key is registered and ships an English default', () => {
  assert.ok(keys.includes("'ALERTS_SIGNALS_NOT_PREDICTIONS'"));
  assert.ok(typeof en.ALERTS_SIGNALS_NOT_PREDICTIONS === 'string' && en.ALERTS_SIGNALS_NOT_PREDICTIONS.length > 20);
});
test('f. the migration upserts the key for ko, zh, ru and ar into both label tables, and nothing destructive', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261114b_labels_signals_not_predictions.sql', import.meta.url), 'utf8');
  for (const t of ['lhq_labels', 'lhq_dev_labels']) {
    const from = sql.indexOf(`insert into ${t} (key, locale, value) values`);
    assert.ok(from > -1, `${t} block missing`);
    const to = sql.indexOf('on conflict (key, locale) do update', from);
    const rows = [...sql.slice(from, to).matchAll(/\('([A-Z_]+)','([a-z]{2})'/g)].map(m => `${m[1]}:${m[2]}`).sort();
    assert.deepEqual(rows, ['ALERTS_SIGNALS_NOT_PREDICTIONS:ar', 'ALERTS_SIGNALS_NOT_PREDICTIONS:ko', 'ALERTS_SIGNALS_NOT_PREDICTIONS:ru', 'ALERTS_SIGNALS_NOT_PREDICTIONS:zh'], t);
  }
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i);
});
