/* #2456: the briefing page stops presenting missing or old data as current. hToHM runs as the REAL function (sliced from the component); the rest is source anchors on the JSX / provider wiring.
 *   H1  hToHM: 25 minutes is "25m", not "0h"; hours and minutes otherwise (the AI context said "in 0h" for an event 25 minutes away)
 *   Z1  the event time carries the viewer's zone abbreviation and uses a 24-hour cycle that cannot print "24:30" (localZoneAbbr is REAL code; the option is exercised on real dates); both files use it
 *   C1  a calendar that is not loaded or is stale is "unavailable", not "Clean macro backdrop", on the page AND in the AI context (the macro block is not silently dropped)
 *   S1  Top 3 Setups lists only readings of 40+ (a 20/100 reading was shown as a Long or Short setup)
 *   E1  the ETF card carries the date of the newest settled US session; a flow of exactly 0 reads Flat in the neutral colour, not red "Mild outflow"; the AI context says "latest settled US session <date>"
 *   D1  the dominance trend needs six samples and a 0.1-point move either way
 *   M1  a failed macro read clears DXY, S&P, gold, oil and yen (unavailable), like the 10Y
 *   K1  the new keys have English text
 * WHAT IT CANNOT PROVE: the page rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { localZoneAbbr } from '../lib/resetTime.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const BT = read('components/BriefingTerminal.tsx'), BTc = strip(BT);
const a = BT.indexOf('function hToHM('); assert.ok(a > 0, 'CONTROL: hToHM not found');
/* the slice is OUR OWN checked-in source, never input */
const hToHM = new Function(`return (${stripTypeScriptTypes(BT.slice(a, BT.indexOf('\n}\n', a) + 3)).replace(/^function hToHM/, 'function')});`)() as (h: number) => string;

test('H1. hToHM: 25 minutes reads in minutes, whole hours and hours-and-minutes read as such (never "0h" for a near event)', () => {
  assert.notEqual(hToHM(25 / 60), '0h'); assert.match(hToHM(25 / 60), /^25\s?m/);
  assert.match(hToHM(2), /^2\s?h/); assert.match(hToHM(2.5), /^2\s?h\s?30\s?m/); assert.match(hToHM(0.02), /\d+\s?m/);
});
test('Z1. the time is in the viewer\'s zone with its abbreviation and a 24-hour cycle that never prints 24:xx; the real option is exercised on midnight', () => {
  assert.ok(localZoneAbbr().length > 0, 'localZoneAbbr is empty: the time would show no zone');
  const midnight = new Date(Date.UTC(2026, 0, 1, 0, 30));
  assert.equal(midnight.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }), '00:30', 'h23 prints midnight as 00:30');
  for (const f of ['components/EconCalendarWidget.tsx', 'app/(main)/econ-calendar/page.tsx']) {
    const s = strip(read(f)); assert.ok(s.includes("hourCycle: 'h23' }) + ' ' + localZoneAbbr()"), `${f}: the time lost its zone or its 24-hour cycle`); assert.equal(/hour12:\s*false/.test(s), false, `${f}: hour12:false is back (prints 24:30 in some engines)`);
  }
});
test('C1. a calendar not loaded or stale is "unavailable": the page says so instead of "Clean macro backdrop", and the AI context says so instead of dropping the macro block', () => {
  assert.ok(BTc.includes('const calendarUnavailable = econStale || !eventsLoaded;'), 'the unavailable rule changed');
  assert.ok(BTc.includes('const noEvents = !calendarUnavailable && futureEcon.length === 0'), '"no events" can be claimed while the calendar is unavailable');
  assert.ok(BTc.includes("{calendarUnavailable ? t('BRIEFING_CALENDAR_UNAVAILABLE') : t('BRIEFING_NO_EVENTS')}") && BTc.includes('{(calendarUnavailable || noEvents) && ('), 'the page does not show the unavailable line');
  assert.ok(BTc.includes('econStale || !eventsLoaded);') && BTc.includes('if (calendarUnavailable) {'), 'the AI context is not told the calendar is unavailable');
  assert.ok(BT.includes('the economic calendar is unavailable right now, so no events are listed (this does not mean none are scheduled).'), 'the AI context wording changed');
});
test('S1. Top 3 Setups has a floor of 40', () => {
  assert.ok(BTc.includes('const TOP_SETUP_MIN_SCORE = 40;') && BTc.includes('r.sq.score >= TOP_SETUP_MIN_SCORE'), 'the floor is gone: a 20/100 reading is listed as a setup');
});
test('E1. the ETF card is dated, a flow of exactly 0 is Flat in the neutral colour, and the AI context names the settled session', () => {
  assert.ok(BTc.includes("const etfColor = etfFlow == null || etfFlow === 0 ? 'var(--txt3)'"), 'a zero flow is coloured as an outflow/inflow'); assert.ok(BTc.includes("etfFlow < 0    ? t('BRIEFING_ETF_MILD_OUT')") && BTc.includes("t('BRIEFING_ETF_FLAT')"), 'a zero flow reads Mild outflow');
  /* #2501: the date is worded for the reader ("Latest: Nov 13"), not the raw ISO string; a value that is not a date is shown as it came (fmtEtfDate). */
  assert.ok(BTc.includes("{etfDate ? ` · ${t('BRIEFING_ETF_LATEST', { date: fmtEtfDate(etfDate) })}` : ''}"), 'the ETF card lost its date');
  assert.ok(/const fmtEtfDate = \(d: string\): string => \{[\s\S]{0,260}Number\.isFinite\(dt\.getTime\(\)\) \? dt\.toLocaleDateString\([^)]*timeZone: 'UTC'[^)]*\) : d;/.test(BTc), 'the ETF date formatter changed: a non-date must fall back to the raw value and the date must be formatted in UTC');
  assert.ok(BTc.includes('BTC ETF Flow (latest settled US session${store.etfFlowDays?.[0]?.date'), 'the AI context calls the flow "today"');
});
test('D1. the dominance trend needs at least six samples and a 0.1 point move in either direction, otherwise nothing is shown', () => {
  assert.ok(BTc.includes('btcDomHistory.length >= 6 ? btcDomHistory[btcDomHistory.length - 1] - btcDomHistory[0] : 0;'), 'the sample floor changed');
  assert.ok(BTc.includes('const domTrend = domMove >= 0.1') && BTc.includes(': domMove <= -0.1'), 'the 0.1 point thresholds changed');
});
test('M1. a failed macro read makes DXY, S&P, gold, oil and yen unavailable (null), like the 10Y', () => {
  const mp = strip(read('components/MarketProvider.tsx'));
  for (const k of ['oilPrice: null, oilChg: null', 'dxy: null, dxyChg: null', 'spx: null, spxChg: null', 'gold: null, goldChg: null', 'jpy: null, jpyChg: null']) assert.ok(mp.includes(`: { ${k} }`), `a failed read no longer clears: ${k}`);
});
test('K1. the new keys have English text', () => {
  const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.match(en.BRIEFING_CALENDAR_UNAVAILABLE ?? '', /unavailable/i); assert.equal(en.BRIEFING_ETF_FLAT, 'Flat');
});
