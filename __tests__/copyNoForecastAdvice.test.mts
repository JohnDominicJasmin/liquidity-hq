/* COPY BATCH 1 (#1185 "Prediction / advice wording still live"): the product DESCRIBES what the data shows; it never predicts or advises. Dev's approved rewrite table (rows 1-25, with PM's edits: #22 "Price below 50 EMA", #25 drop "entry possible").
 *   Z1  no shipped default in the table's key set carries a forecast or advice phrase (wait for, stay out, reduce size, may push, tends to, pump, dump, magnet, headwind, tailwind, risk-on/off, danger, "so you know", big players, ...); every offender is NAMED with its text
 *   Z2  the approved wording of each rewritten row is the shipped default, exactly (so a later edit that brings an old phrase back, or drifts the new one, is red). If approval changed a row's text, change the line here in the same PR
 *   Z3  the code string in lib/perpSpot.ts (row 11, not a label) no longer says the move "tends to hold better"
 *   Z4  the phrase "entry possible" (#25) is in no label default
 *   Z5  CLASS SWEEP (informational, never fails): every OTHER label default that still contains a forecast/advice phrase is printed, so the next batch has its list
 * WHAT THIS CANNOT PROVE: the ko/zh/ru/ar rows (a held migration, applied by PM; rows in the DB win over these defaults), or that a label row in the live table does not still hold the old wording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DEF = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

/* the approved rewrite: key -> new English default (rows 1-24 of Dev's table, row 22 as PM edited it) */
const APPROVED: Record<string, string> = {
  OI_TREND_STRONG_DOWN_SUB: 'Open interest rising as price falls',
  ACCUMULATION_TRACKER_SUBTITLE: 'quiet coins with buying pressure',
  DISTRIBUTION_TRACKER_SUBTITLE: 'rising coins with selling pressure',
  LIQ_SUBTITLE: 'Estimated liquidation zones · nearest dense cluster',
  LIQ_BIAS_LONG_HEAVY_SUB: 'More long liquidations modeled below price',
  LIQ_BIAS_SHORT_HEAVY_SUB: 'More short liquidations modeled above price',
  LIQ_LEGEND_SHORT_TEXT: 'levels above price where modeled shorts get force-closed.',   /* #2653 (rule 25): shortened to a one-line legend; still "modeled", still no forecast */
  LIQ_LEGEND_LONG_TEXT: 'levels below price where modeled longs get force-closed.',
  MACRO_STRIP_JPY_APPROACHING: 'USD/JPY above {level}',   /* the code passes level 158 (jpyUsd >= 158), so "near 160" would have been wrong */
  MACRO_STRIP_SPX_DOWN: 'S&P down {pct} today',
  MACRO_STRIP_SPX_UP: 'S&P up {pct} today',
  EMA_PHASE_TRENDING_SHORT: 'Trending short - below 9 EMA',
  EMA_PHASE_TRENDING_LONG: 'Trending long - above 9 EMA',
  CHAT_QUICK_5: 'Ask about this setup',
  MARKET_CONDITIONS_WIDGET_SUBTITLE: 'Market conditions',
  ECON_CALENDAR_HINT_BODY: 'High-impact US macro events (FOMC, NFP, CPI, PCE, GDP) and release times.',
  OI_TREND_STRONG_UP_SUB: 'Open interest rising with price',
  OI_TREND_WEAK_UP_SUB: 'Open interest falling as price rises',
  OI_TREND_WEAK_DOWN_SUB: 'Open interest falling with price',
  MULTI_TF_ALIGNMENT_FOOTER_CONFLICTING: 'Higher and lower timeframes disagree - no clear alignment.',
  SESSION_COUNTDOWN_STAY_OUT: 'No follow-through',
  EMA_PHASE_FREEZE_LONG: 'Price below 50 EMA',
  ALERTS_DISTRIBUTION_TITLE: 'Distribution',
};
/* keys whose text is only PARTLY rewritten (a clause dropped) or whose full text is long: scanned for the banned phrases, not matched exactly */
const SCAN_ONLY = ['EMA_PHASE_DAILY_ABOVE_RIBBON_NOT_BULL', 'EMA_PHASE_DAILY_BELOW_RIBBON_NOT_BEAR', 'EMA_PHASE_VALUE_ZONE_LONG', 'EMA_PHASE_VALUE_ZONE_SHORT'];

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

test('Z4. "entry eligible" / "entry possible" (#25) is in no label default, and in the NEWEST stored row of any locale for the EMA value-zone keys', () => {
  const hits = Object.entries(DEF).filter(([, v]) => /entry (?:eligible|possible)/i.test(v)).map(([k, v]) => `${k}: "${v}"`);
  assert.deepEqual(hits, [], `"entry eligible/possible" still shipped as a default:\n${hits.join('\n')}`);
  /* the ko/zh/ru rows live in the labels table: the migrations are applied in file-name order, so the LAST row written for a key and locale is the one in the database after they are all applied */
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'([a-z-]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  const last = new Map<string, { file: string; val: string }>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(f, dir), 'utf8'); const dev = sql.search(/insert into lhq_dev_labels/i);
    const prodBlock = dev > 0 ? sql.slice(0, dev) : sql;
    for (const m of prodBlock.matchAll(rowRe)) if (/^EMA_PHASE_VALUE_ZONE_(LONG|SHORT)$/.test(m[1])) last.set(`${m[1]}|${m[2]}`, { file: f, val: m[3].replace(/''/g, "'") });
  }
  const bad = [...last.entries()].filter(([, v]) => /entry (?:eligible|possible)/i.test(v.val)).map(([k, v]) => `${k} (${v.file}): "${v.val}"`);
  assert.deepEqual(bad, [], `the newest stored row still says "entry eligible/possible" - a migration must upsert these keys in en/ko/zh/ru without it:\n${bad.join('\n')}`);
});

test('Z5. class sweep (informational): other defaults that still read as a forecast or advice', () => {
  const inSet = new Set([...Object.keys(APPROVED), ...SCAN_ONLY]);
  const rest = Object.entries(DEF).filter(([k, v]) => !inSet.has(k) && BANNED.test(v)).map(([k, v]) => `${k}: "${v.slice(0, 110)}"`);
  console.log(`[COPY-SWEEP] ${rest.length} other defaults carry a banned phrase:\n${rest.join('\n')}`);
  assert.ok(true);
});
