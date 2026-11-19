import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2682 (#1185 audit B1-B5, owner's feature-freeze order): THE BRIEFING PAGE SHOWS WHAT IT HAS, NOT FAILURE TEXT. Written rule (PR body):
 *   B1 the "calendar unavailable" sentence only when the calendar HAS loaded, is stale, and there is nothing to list (it used to flash on every visit and to contradict a stale calendar that still had events)
 *   B2 the price-driven panels render with ONE priced coin (they needed 8) and hide only when no coin has a price once the wait is over
 *   B3 Yen Watch hides until a rate exists (after the wait)   B4 Macro Pulse hides when there is no reading at all (after the wait)
 *   B5 a failed Regenerate keeps the previous briefing (it is no longer wiped up front) and shows ONE translated error line, never a raw exception text
 * The AI context still says the calendar is unavailable whenever it is stale or unloaded (briefingHonesty C1 keeps that half). The REAL expressions are cut out of components/BriefingTerminal.tsx and run on tables.
 *   P1 the calendar note   P2 one priced coin   P3 the hide conditions of the three panels (and which panel each guards)   P4 Regenerate */
const src = readFileSync(new URL('../components/BriefingTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };
const ev = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));
const bools = [false, true];

test('P1. the calendar note shows only for a LOADED, STALE calendar with nothing urgent to list; the "no events" claim is never made while it is unavailable', () => {
  const note = must(code, /const showCalendarNote = (.+?);\n/, 'showCalendarNote'); const noEvents = must(code, /const noEvents = (.+?);\n/, 'noEvents'); const unavailable = must(code, /const calendarUnavailable = (.+?);\n/, 'calendarUnavailable');
  for (const eventsLoaded of bools) for (const econStale of bools) for (const n of [0, 1, 3]) {
    const v = { eventsLoaded, econStale, urgentEcon: new Array(n) }; assert.equal(ev(note, v), eventsLoaded && econStale && n === 0, `note: ${JSON.stringify({ eventsLoaded, econStale, n })}`);
    const un = ev(unavailable, v) as boolean; assert.equal(un, econStale || !eventsLoaded, 'the AI-context rule must stay');
    assert.equal(ev(noEvents, { ...v, calendarUnavailable: un, futureEcon: [], recentGeo: [], whaleAlerts: [] }), !un, 'no-events is claimed only when the calendar is available');
  }
  assert.equal(ev(note, { eventsLoaded: false, econStale: true, urgentEcon: [] }), false, 'before the calendar has loaded nothing is said (it flashed on every visit)'); assert.equal(ev(note, { eventsLoaded: true, econStale: true, urgentEcon: [{}] }), false, 'a stale calendar that still has events lists them instead of apologising');
  assert.match(code, /\{\(showCalendarNote \|\| noEvents\) && \(/); assert.match(code, /\{showCalendarNote \? t\('BRIEFING_CALENDAR_UNAVAILABLE'\) : t\('BRIEFING_NO_EVENTS'\)\}/);
});
test('P2. one priced coin is enough: the threshold is 1 (it was 8), zero prices is not', () => {
  const expr = must(code, /const pricesLoaded = (coinRows\.filter\(.+?\)\.length >= \d+);\n/, 'pricesLoaded');
  const rows = (n: number, bad = 0) => [...Array.from({ length: n }, () => ({ c: { price: 100 } })), ...Array.from({ length: bad }, () => ({ c: { price: 0 } })), { c: null }, { c: { price: null } }];
  for (const [n, want] of [[0, false], [1, true], [2, true], [7, true], [8, true]] as const) assert.equal(ev(expr, { coinRows: rows(n) }), want, `${n} priced coins`);
  assert.equal(ev(expr, { coinRows: rows(0, 5) }), false, 'a price of 0 does not count');
});
test('P3. the panels hide only after the wait and only when there is truly nothing: Top Setups and Notable Signals (no priced coin), Macro Pulse (no reading), Yen Watch (no rate)', () => {
  const styleOf = (re: RegExp, what: string) => must(src, re, what);
  const top = styleOf(/<TPanel style=\{(!pricesLoaded && graceOver) \? \{ display: 'none' \} : undefined\}>\s*\n?\s*\{?\/?\*?[^\n]*Top 3|<TPanel style=\{(!pricesLoaded && graceOver) \? \{ display: 'none' \} : undefined\}>/, 'Top Setups panel');
  const topCount = (src.match(/<TPanel style=\{!pricesLoaded && graceOver \? \{ display: 'none' \} : undefined\}>/g) ?? []).length; assert.equal(topCount, 2, 'the two price-driven panels (Top Setups, Notable Signals) are guarded');
  const macro = must(src, /<TPanel style=\{(graceOver && fng == null && store\.btcDom == null && store\.dxy == null && !\(etfFlow != null && etfDate != null\)) \? \{ display: 'none' \} : undefined\}>/, 'Macro Pulse guard'); const yen = must(src, /<TPanel style=\{(jpyUsd == null && graceOver) \? \{ display: 'none' \} : undefined\}>/, 'Yen Watch guard');
  void top;
  for (const graceOver of bools) for (const priced of bools) assert.equal(ev('!pricesLoaded && graceOver', { pricesLoaded: priced, graceOver }), !priced && graceOver, 'price panels'); /* the same expression the source uses */
  for (const graceOver of bools) for (const fng of [null, 50]) for (const btcDom of [null, 55]) for (const dxy of [null, 104]) for (const etf of [[null, null], [1, null], [null, '2026-11-18'], [1, '2026-11-18']] as const) {
    const hidden = ev(macro, { graceOver, fng, store: { btcDom, dxy }, etfFlow: etf[0], etfDate: etf[1] }) as boolean; const nothing = fng == null && btcDom == null && dxy == null && !(etf[0] != null && etf[1] != null);
    assert.equal(hidden, graceOver && nothing, `Macro Pulse ${JSON.stringify({ graceOver, fng, btcDom, dxy, etf })}`); if (!graceOver) assert.equal(hidden, false, 'nothing hides before the wait is over (no flicker)');
  }
  for (const graceOver of bools) for (const jpyUsd of [null, 158.4]) assert.equal(ev(yen, { graceOver, jpyUsd }), jpyUsd == null && graceOver, 'Yen Watch');
});
test('P4. Regenerate keeps the previous briefing and shows one translated error line', () => {
  const fn = must(src, /async function generateBriefing\(\) \{([\s\S]*?)\n  \}\n/, 'generateBriefing').replace(/\/\*[\s\S]*?\*\//g, '');
  const start = fn.slice(0, fn.indexOf('try {')); assert.match(start, /setGen\(true\); setBriefErr\(''\);/); assert.equal(/setBrief\(''\)/.test(start), false, 'the previous briefing is wiped up front again (a failed Regenerate would leave nothing)');
  const catchAt = fn.lastIndexOf('catch'); const tail = fn.slice(catchAt); assert.match(tail, /setBriefErr\(t\('BRIEFING_UNKNOWN_ERROR'\)\);/, 'a thrown error is not one translated line'); assert.equal(/String\(e\)|e\.message|e instanceof Error/.test(tail.slice(0, tail.indexOf('finally') > 0 ? tail.indexOf('finally') : undefined)), false, 'a raw exception text can reach the screen');
  assert.equal((fn.match(/setBrief\(''\)/g) ?? []).length, 0, 'the briefing text is cleared somewhere in the handler');
});
