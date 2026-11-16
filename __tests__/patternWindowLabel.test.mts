/* #2453: every pattern label states its window. The pattern is read from the last 25 closed 15-minute bars (about 6 hours): the Dashboard sidebar and selected-coin card append " · 15m", the Telegram alert appends the alert's own candle interval. Source anchors (JSX and a route). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('P1. the dashboard sidebar and the selected-coin card append the 15m window, and the card does not show a window for no pattern', () => {
  const d = read('components/DashboardTerminal.tsx');
  assert.ok(d.includes("patternWord(t, d.chartPattern.split(';')[0].split('(')[0].trim()) + ' · 15m'"), 'the sidebar label lost its window');
  assert.ok(d.includes("const pattern = patternName ? patternName + ' · 15m' : patternName;"), 'the card lost its window, or shows " · 15m" with no pattern');
});
test('P2. the Telegram alert states the candle interval of the alert (60 -> 1h, otherwise N m)', () => {
  assert.ok(read('app/api/telegram/alert/route.ts').includes("Pattern: <b>${patternStr}</b> (${bybitInterval === '60' ? '1h' : bybitInterval + 'm'})"), 'the alert pattern line lost its interval');
});
