/* #2403: News > Events table, a11y and phone-layout items from the UI audit (#1185). Source/CSS pins (rendering is the browser cell at 390/768/1280, dark+light).
 *   N1  the events grid is ONE class (.ne-row) for the header and every row: 5 columns wide (70px / flexible event / 72 / 72 / 72) and 4 columns under 480 px with the Previous column (.ne-prev) hidden in BOTH the header and the rows, so the columns cannot drift; the header has 5 cells and a row has 5 children
 *   N2  there is NO Impact column, and the reason holds: the calendar route marks every event it returns 'high' (so a fixed HIGH on each row said nothing)
 *   N3  the Free plan card says "Not included:" in words for an excluded row (the cross is aria-hidden), through a registered key with an English default
 *   N4  the chart toolbar's S/R, price-action and Liq toggles expose aria-pressed; the Journal thesis ticker/direction/date inputs have a labelled name through registered keys
 *   N5  native controls follow the theme (color-scheme dark / light on html) and the minimise/dismiss controls are at least 24 x 24 (WCAG 2.5.8)
 * WHAT IT CANNOT PROVE: the rendered table at 390 (no sideways scroll, no clipped Est/Actual), picker colours in each theme, real screen-reader output: browser cells. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('app/globals.css'), news = read('app/(main)/news/page.tsx'), en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>, keys = read('lib/labelKeys.ts');

test('N1. one .ne-row class for header and rows: 5 columns, 4 under 480 px with the Previous column hidden in both', () => {
  assert.ok(/\.ne-row\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*70px minmax\(140px, 1fr\) 72px 72px 72px;/.test(css), 'the wide grid changed');
  const m = css.match(/@media \(max-width: 479px\)\s*\{\s*\.ne-row\s*\{\s*grid-template-columns:\s*([^;]+);[^}]*\}\s*\.ne-prev\s*\{\s*display:\s*none;\s*\}/);
  assert.ok(m, 'the phone rule (4 columns, .ne-prev hidden) is gone'); assert.equal(m![1].trim().split(/\s+(?![^(]*\))/).length, 4, `phone grid is not 4 columns: ${m![1]}`);
  const hdrAt = news.indexOf('<div className="ne-row"'); assert.ok(hdrAt > 0, 'CONTROL: header row not found'); const hdr = news.slice(hdrAt, news.indexOf('</div>', hdrAt));
  assert.equal((hdr.match(/<span/g) ?? []).length, 5, 'the header does not have 5 cells'); assert.equal((hdr.match(/className="ne-prev"/g) ?? []).length, 1, 'the header Previous cell lost .ne-prev');
  const rowAt = news.indexOf('<div key={ei} className="ne-row"'); assert.ok(rowAt > 0, 'CONTROL: event row not found'); const rowEnd = news.indexOf('\n                  );', rowAt); const row = news.slice(rowAt, rowEnd);
  assert.equal((row.match(/className="ne-prev"/g) ?? []).length, 1, 'the row Previous cell lost .ne-prev');
  assert.equal((row.match(/^\s{22}<(span|div)\b/gm) ?? []).length, 5, 'an event row does not have 5 direct cells (the grid would shift)');
});
test('N2. no Impact column, and the reason holds: the calendar route returns every event as high', () => {
  assert.equal(/NEWS_EVENTS_COL_IMPACT|NEWS_EVENTS_IMPACT/.test(news), false, 'an Impact column is back');
  const r = read('app/api/econ-calendar/route.ts'); const impacts = [...r.matchAll(/impact:\s*'([a-z]+)'/g)].map((x) => x[1]); assert.ok(impacts.length >= 2, 'CONTROL: no impact values found');
  assert.deepEqual([...new Set(impacts)], ['high'], 'the route now returns other impacts: a fixed/removed Impact column hides real information');
});
test('N3. the Free plan card names an excluded row in words for a screen reader, through a registered key with an English default', () => {
  const up = read('app/(main)/upgrade/page.tsx'); assert.ok(up.includes("{!included && <span className=\"sr-only\">{t('UPGRADE_FREE_NOT_INCLUDED_SR')}{' '}</span>}"), 'the excluded row has no visually-hidden "Not included"');
  assert.equal(en.UPGRADE_FREE_NOT_INCLUDED_SR, 'Not included:'); assert.ok(keys.includes("'UPGRADE_FREE_NOT_INCLUDED_SR'"), 'the key is not registered');
  assert.ok(/\.sr-only\s*\{/.test(css), 'CONTROL: no .sr-only class exists, the text would be visible');
});
test('N4. toggles expose aria-pressed; the Journal thesis fields have a named input; keys registered with English defaults', () => {
  const chart = read('components/KLineProChart.tsx'); for (const v of ['showSR', 'showPA', 'showLiq']) assert.ok(chart.includes(`aria-pressed={${v}}`), `${v} toggle lost aria-pressed`);
  const tj = read('components/TradeJournal.tsx'); for (const k of ['TRADE_JOURNAL_THESIS_TICKER_ARIA', 'TRADE_JOURNAL_THESIS_DIRECTION_ARIA', 'TRADE_JOURNAL_THESIS_DATE_ARIA']) {
    assert.ok(tj.includes(`aria-label={t('${k}')}`), `${k} not applied`); assert.ok(keys.includes(`'${k}'`), `${k} not registered`); assert.ok(typeof en[k] === 'string' && en[k].length > 2, `${k} has no English default`);
  }
});
test('N5. native controls follow the theme and the dismiss/minimise controls are 24 x 24 or more', () => {
  assert.ok(/html\s*\{\s*color-scheme:\s*dark;\s*\}/.test(css) && /html\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/.test(css), 'color-scheme does not follow the theme');
  assert.ok(/min-width: 24px; min-height: 24px;\s*\n\s*display: inline-flex; align-items: center; justify-content: center;/.test(css), 'the 24 x 24 touch target for minimise/dismiss is gone');
});
