/* QA: PR #2840 (#1651 owner item 96). The live liquidations panel prints 1h figures only for an hour it has read. The coverage rule and the state lines are cut out of components/LiqFeed.tsx and run.
 *   H1 a read that ran to its end covers the hour, even with no rows (a real zero); a cut or failed read covers it only if its oldest row is older than the hour
 *   H2 known when either read that serves the coin covers the hour; pending ("…") while one is still out; otherwise "No data"
 *   H3 all three figures and the bias bar are behind it, and both stored reads record failure as well as success */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const strip = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/LiqFeed.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (from: string, to: string) => { const a = src.indexOf(from); assert.ok(a >= 0, `CONTROL: ${from}`); const b = src.indexOf(to, a); assert.ok(b > a, `CONTROL: end of ${from}`); return src.slice(a, b + to.length); };
const HOUR = 3_600_000;

test('H1. what covers the last hour', () => {
  const NOW = 1_800_000_000_000;
  const fn = new Function('Date', 'STATS_WIN', `${strip(cut('function coversStatsWindow(', '\n}'))}\nreturn coversStatsWindow;`)({ now: () => NOW }, HOUR) as (rows: Array<{ ts: number }>, partial: boolean) => boolean;
  assert.equal(fn([], false), true, 'a finished read with no rows is a real zero');
  assert.equal(fn([{ ts: NOW - 1000 }], false), true);
  assert.equal(fn([], true), false, 'a failed first page');
  assert.equal(fn([{ ts: NOW - HOUR + 1 }, { ts: NOW }], true), false);
  assert.equal(fn([{ ts: NOW - HOUR }, { ts: NOW }], true), true);
  assert.equal(fn([{ ts: NOW - 5 * HOUR }, { ts: NOW }], true), true, 'cut short but reaching past the hour');
});

test('H2. known, pending or no data', () => {
  const lines = strip(cut('const hourReads', "hourReads.includes(undefined);"));
  const state = (coinFilter: string, hourBy: Record<string, boolean>) => new Function('coinFilter', 'hourBy', `${lines}\nreturn hourKnown ? 'figures' : hourPending ? 'pending' : 'none';`)(coinFilter, hourBy) as string;
  assert.equal(state('BTC', {}), 'pending'); assert.equal(state('ALL', {}), 'pending');
  assert.equal(state('BTC', { ALL: true }), 'figures'); assert.equal(state('BTC', { BTC: true }), 'figures');
  assert.equal(state('BTC', { BTC: false }), 'pending'); assert.equal(state('BTC', { BTC: false, ALL: false }), 'none');
  assert.equal(state('ALL', { ALL: false }), 'none'); assert.equal(state('ALL', { BTC: true }), 'pending', 'one coin\'s read says nothing about all coins');
});

test('H3. every 1h figure is behind it', () => {
  assert.ok(src.includes("const hourGap   = hourPending ? '…' : t('ARENA_SCANNER_UNAVAILABLE_NARROW');"));
  for (const shown of ['{hourKnown ? fmtUSD(stats.longUsd) : hourGap}', '{hourKnown ? stats.count : hourGap}', '{hourKnown ? fmtUSD(stats.shortUsd) : hourGap}', '{hourKnown && totalUsd > 0 && (']) assert.ok(src.includes(shown), shown);
  assert.equal(src.split('setHourBy(m => ({ ...m, [cf]:').length - 1, 2);
  assert.equal(src.split('setHourBy(m => ({ ...m, ALL:').length - 1, 2);
});
