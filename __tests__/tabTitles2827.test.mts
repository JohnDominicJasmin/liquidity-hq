/* QA: PR #2827 (#1185 owner item 73). The browser tab follows the reader's language.
 *   T1 exact paths only: a listed page has a name label; coin pages, articles, "/", unknown paths and inherited object names have none
 *   T2 the text drops a heading's closing full stop (Latin and CJK) and adds the brand
 *   T3 every listed path is a real page, and every label is registered and shipped
 *   T4 English keeps the server title, the component is mounted once, and it stops watching and restores on change */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { tabTitle, tabTitleKey } from '../lib/tabTitle';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const listed = [...read('lib/tabTitle.ts').matchAll(/'(\/[a-z-]*)': '([A-Z_]+)'/g)].map((m) => [m[1], m[2]] as const);

test('T1. exact paths only', () => {
  assert.equal(tabTitleKey('/arena'), 'NAV_ARENA');
  assert.equal(tabTitleKey('/funding'), 'NAV_FR_HISTORY');
  for (const p of [null, '', '/', '/ko', '/arena/BTC', '/calc/leverage', '/learn/funding-rate', '/upgrade', 'constructor', 'toString', '__proto__']) assert.equal(tabTitleKey(p), null, String(p));
});

test('T2. the text', () => {
  assert.equal(tabTitle('Funding.'), 'Funding - LiquidityHQ');
  assert.equal(tabTitle('개인정보 처리방침。'), '개인정보 처리방침 - LiquidityHQ');
  assert.equal(tabTitle('v2.0 notes'), 'v2.0 notes - LiquidityHQ');
});

test('T3. every listed path is a page and every label exists', () => {
  assert.equal(listed.length, 31, 'CONTROL: the table parsed');
  const pages = new Set<string>();
  const walk = (dir: URL, url: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`); else if (e.name === 'page.tsx') pages.add(url || '/'); } };
  walk(new URL('../app/', import.meta.url), '');
  const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const keys = read('lib/labelKeys.ts');
  for (const [path, key] of listed) { assert.ok(pages.has(path), `${path}: no page`); assert.ok(en[key] && keys.includes(`'${key}'`), `${key}: not registered or not shipped`); }
});

test('T4. English untouched, mounted once, cleans up', () => {
  const c = read('components/TabTitle.tsx');
  assert.ok(c.includes("if (locale === 'en' || !key) return;"));
  assert.ok(c.includes('watch.disconnect();') && c.includes('if (served && document.title === wanted) document.title = served;'));
  assert.equal(read('components/AppShell.tsx').split('<TabTitle />').length - 1, 1);
});
