/* COPY BATCH 1 (#1185 "Prediction / advice wording still live"): the product DESCRIBES what the data shows; it never predicts or advises. Dev's approved rewrite table (rows 1-25, with PM's edits: #22 "Price below 50 EMA", #25 drop "entry possible").
 *   Z1  no shipped default in the table's key set carries a forecast or advice phrase (wait for, stay out, reduce size, may push, tends to, pump, dump, magnet, headwind, tailwind, risk-on/off, danger, "so you know", big players, ...); every offender is NAMED with its text
 *   Z2  the approved wording of each rewritten row is the shipped default, exactly (so a later edit that brings an old phrase back, or drifts the new one, is red). If approval changed a row's text, change the line here in the same PR
 *   Z3  the code string in lib/perpSpot.ts (row 11, not a label) no longer says the move "tends to hold better"
 *   Z4  the phrase "entry possible" (#25) is in no label default
 *   Z5  CLASS SWEEP (informational, never fails): every OTHER label default that still contains a forecast/advice phrase is printed, so the next batch has its list
 * WHAT THIS CANNOT PROVE: the ko/zh/ru/ar rows (a held migration, applied by PM; rows in the DB win over these defaults), or that a label row in the live table does not still hold the old wording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DEF = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

/* the approved rewrite: key -> new English default (rows 1-24 of Dev's table, row 22 as PM edited it) */
const APPROVED: Record<string, string> = {
  OI_TREND_STRONG_DOWN_SUB: 'Open interest rising as price falls',
  ACCUMULATION_TRACKER_SUBTITLE: 'quiet coins with buying pressure',
  DISTRIBUTION_TRACKER_SUBTITLE: 'rising coins with selling pressure',
  LIQ_SUBTITLE: 'Estimated liquidation zones · nearest dense cluster',
  LIQ_BIAS_LONG_HEAVY_SUB: 'More long liquidations modeled below price',
  LIQ_BIAS_SHORT_HEAVY_SUB: 'More short liquidations modeled above price',
  MACRO_STRIP_JPY_APPROACHING: 'USD/JPY near 160',
  MACRO_STRIP_SPX_DOWN: 'S&P down {pct} today',
  MACRO_STRIP_SPX_UP: 'S&P up {pct} today',
  EMA_PHASE_TRENDING_SHORT: 'Trending short - below 9 EMA',
  EMA_PHASE_TRENDING_LONG: 'Trending long - above 9 EMA',
  CHAT_QUICK_5: 'Ask about this setup',
  MARKET_CONDITIONS_WIDGET_SUBTITLE: 'Market conditions',
  ECON_CALENDAR_HINT_BODY: 'High-impact US macro events - FOMC, NFP, CPI, PCE, GDP and more - and when each one releases. Volatility is often higher around a release.',
  OI_TREND_STRONG_UP_SUB: 'Open interest rising with price',
  OI_TREND_WEAK_UP_SUB: 'Open interest falling as price rises',
  OI_TREND_WEAK_DOWN_SUB: 'Open interest falling with price',
  MULTI_TF_ALIGNMENT_FOOTER_CONFLICTING: 'Higher and lower timeframes disagree - no clear alignment.',
  SESSION_COUNTDOWN_STAY_OUT: 'No follow-through',
  EMA_PHASE_FREEZE_LONG: 'Price below 50 EMA',
  ALERTS_DISTRIBUTION_TITLE: 'Distribution - Selling Into Strength',
};
/* keys whose text is only PARTLY rewritten (a clause dropped) or whose full text is long: scanned for the banned phrases, not matched exactly */
const SCAN_ONLY = ['LIQ_LEGEND_SHORT_TEXT', 'LIQ_LEGEND_LONG_TEXT', 'EMA_PHASE_DAILY_ABOVE_RIBBON_NOT_BULL', 'EMA_PHASE_DAILY_BELOW_RIBBON_NOT_BEAR'];

/* forecast and advice phrases, each of which was in the audit */
const BANNED = /\bwait for\b|\bstay out\b|\breduce size\b|\bmay push\b|\bpush(?:es)? price\b|\btends? to\b|\bpump\b|\bdump\b|\bmagnet\b|\bheadwind\b|\btailwind\b|\brisk-(?:on|off)\b|\bdanger\b|\bso you know\b|\bbig players\b|\btaking profit\b|\bgood time\b|\btrade now\b|\bpotential diversification\b|\bentry possible\b|\bbefore the\b.*\bpump\b|\bwait,?\s*$|\bwill (?:rise|fall|drop|pump|dump)\b/i;

test('Z1. no forecast or advice phrase in any key of the rewrite set (every offender named)', () => {
  const keys = [...Object.keys(APPROVED), ...SCAN_ONLY].filter((k) => k in DEF);
  assert.ok(keys.length >= 20, `only ${keys.length} of the table's keys exist: a key was renamed, re-read the table`);
  const offenders = keys.filter((k) => BANNED.test(DEF[k])).map((k) => `${k}: "${DEF[k]}" (${BANNED.exec(DEF[k])![0]})`);
  assert.deepEqual(offenders, [], `forecast/advice wording still shipped:\n${offenders.join('\n')}`);
});

test('Z2. the approved wording is the shipped default, exactly', () => {
  const wrong = Object.entries(APPROVED).filter(([k, v]) => DEF[k] !== v).map(([k, v]) => `${k}\n   shipped:  ${JSON.stringify(DEF[k])}\n   approved: ${JSON.stringify(v)}`);
  assert.deepEqual(wrong, [], `these defaults are not the approved wording:\n${wrong.join('\n')}`);
});

test('Z3. perpSpot no longer says the move "tends to hold better"', () => {
  const src = readFileSync(new URL('../lib/perpSpot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /tends to hold better/i, 'lib/perpSpot.ts still carries the forecast clause (row 11)');
  assert.match(src, /More of this move is people actually buying the coin\./, 'the rewritten sentence (row 11) is not there');
});

test('Z4. "entry possible" is in no label default (#25)', () => {
  const hits = Object.entries(DEF).filter(([, v]) => /entry possible/i.test(v)).map(([k, v]) => `${k}: "${v}"`);
  assert.deepEqual(hits, [], `"entry possible" still shipped:\n${hits.join('\n')}`);
});

test('Z5. class sweep (informational): other defaults that still read as a forecast or advice', () => {
  const inSet = new Set([...Object.keys(APPROVED), ...SCAN_ONLY]);
  const rest = Object.entries(DEF).filter(([k, v]) => !inSet.has(k) && BANNED.test(v)).map(([k, v]) => `${k}: "${v.slice(0, 110)}"`);
  console.log(`[COPY-SWEEP] ${rest.length} other defaults carry a banned phrase:\n${rest.join('\n')}`);
  assert.ok(true);
});
