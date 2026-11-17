/* COPY BATCH 2 (#2508, #1185 "Prediction / advice wording still live"): the 32 keys PM approved after batch 1. The product describes what the data shows; it never predicts or advises.
 *   Y1  no shipped default in the batch-2 key set carries a forecast or advice phrase (wait for, stay out, reduce size, may push, tends to, pump, dump, magnet, headwind, tailwind, risk-on/off, danger, ...); every offender is named with its text
 *   Y2  the approved wording is the shipped default, EXACTLY (so a later edit that brings an old phrase back, or drifts the new one, is red). If approval changes a row, change its line here in the same PR
 *   Y3  the newest stored row of each of these keys in every locale (the migrations are read in file order) carries the same {placeholders} as the English default, and its en row equals the default
 * WHAT THIS CANNOT PROVE: the live labels table (rows in the database win over these defaults), or that ko/zh/ru/ar read well (AI-drafted, owner's ruling). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DEF = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

const APPROVED: Record<string, string> = {
  CALC_SIZER_WARN_HIGH_LEVERAGE: "Leverage over 10x - the liquidation price is close to entry",
  DASH_SIDEBAR_SIG_BUYERS_PROFIT: "Selling into strength",
  ARENA_NOTIF_SENTIMENT_BEAR_BODY: "F&G {fng} (Extreme Greed) · FR +{fr}% · {longPct}% Long - all 3 at extremes.",
  ARENA_NOTIF_SENTIMENT_BULL_BODY: "F&G {fng} (Extreme Fear) · FR {fr}% · {shortPct}% Short - all 3 at extremes.",
  ARENA_WAIT_FOR: "Needs:",
  ARENA_DIST_WARN_PULLBACK: "Buying is weakening as price rises",
  LIQ_WHALE_LONG_SQUEEZE_BODY: "Retail is {retailPct}% long and whales are {whalePct}% short.",
  LIQ_WHALE_SHORT_SQUEEZE_BODY: "Retail is {retailPct}% short and whales are {whalePct}% long.",
  LIQ_LEGEND_MAGNET_BOLD: "Densest cluster",
  LIQ_LEGEND_MAGNET_TEXT: "the largest estimated cluster in the selected window.",
  FUNDING_REGIME_OVERVIEW_TIP: "A snapshot of every coin's current funding regime: coins where shorts are crowded, coins where longs are crowded, and coins whose funding rate is extreme enough to arbitrage.",
  FUNDING_LEGEND_POSITIVE_DESC: "longs paying shorts",
  FUNDING_LEGEND_NEGATIVE_DESC: "shorts paying longs",
  BRIEFING_DXY_TIP: "The US dollar's strength against a basket of major currencies. A rising dollar has often coincided with weaker risk assets like crypto, and a falling dollar with stronger ones.",
  BRIEFING_DXY_HEADWIND: "↑ Dollar rising",
  BRIEFING_DXY_TAILWIND: "↓ Dollar falling",
  BRIEFING_YEN_DANGER: "USD/JPY at 160+",
  DISTRIBUTION_TRACKER_TOOLTIP: "Scores every coin for profit-taking by big players: price still up on the day while CVD shows sellers into strength, open interest unwinds out of the rally, top traders lean out of longs, and retail keeps paying positive funding. A high score means several of these signs are present at once.",
  MULTI_TF_ALIGNMENT_FOOTER_MIXED: "No clear directional bias across timeframes.",
  GEX_TABLE_LEAN_MAGNET_ABOVE: "the strongest level (${strike}K) sits above price",
  GEX_TABLE_LEAN_MAGNET_BELOW: "the strongest level (${strike}K) sits below price",
  GEX_TABLE_REGIME_DESC_RANGING: "dealer positioning dampens moves in this regime",
  GEX_TABLE_REGIME_DESC_TRENDING: "dealer positioning amplifies moves in this regime",
  GEX_TABLE_COL_WALL_STRENGTH: "Wall strength (bigger = larger gamma at the strike)",
  GEX_TABLE_STRONGEST_MAGNET_LABEL: "Strongest level:",
  GEX_TABLE_STRONGEST_MAGNET_DESC: "- the strike with the largest gamma exposure",
  STOP_LOSS_ZONE_NEUTRAL_HINT: "Signals are split: RSI and OI do not agree on direction.",
  GLOBAL_MACRO_CONTEXT_LOCKED_DESC: "DXY, VIX, gold, oil, and bond yields with an AI read of the macro backdrop - part of Pro.",
  MACRO_STRIP_DXY_UP: "USD strengthening",
  MACRO_STRIP_DXY_DOWN: "USD weakening",
  MACRO_STRIP_GOLD_UP: "Gold rising",
  MACRO_STRIP_JPY_DANGER: "USD/JPY at 160+"
};

const BANNED = new RegExp(['wait for','stay out','reduce size','may push','push(?:es)? price','tends? to','pump','dump','magnet','headwind','tailwind','risk-(?:on|off)','danger','so you know','big players','taking profit','good time','trade now','expect (?:dump|squeeze)','fade the','follow the momentum','bullish pressure','bearish pressure'].map((w) => '\\b' + w + '\\b').join('|'), 'i');

test('Y1. no forecast or advice phrase in any batch-2 key', () => {
  const keys = Object.keys(APPROVED); assert.ok(keys.every((k) => k in DEF), 'a batch-2 key was renamed or removed: re-read the table');
  const offenders = keys.filter((k) => BANNED.test(DEF[k])).map((k) => `${k}: "${DEF[k]}" (${BANNED.exec(DEF[k])![0]})`);
  assert.deepEqual(offenders, [], `forecast/advice wording still shipped:
${offenders.join(' | ')}`);
});

test('Y2. the approved wording is the shipped default, exactly (' + Object.keys(APPROVED).length + ' keys)', () => {
  const wrong = Object.entries(APPROVED).filter(([k, v]) => DEF[k] !== v).map(([k, v]) => `${k}
   shipped:  ${JSON.stringify(DEF[k])}
   approved: ${JSON.stringify(v)}`);
  assert.deepEqual(wrong, [], `these defaults are not the approved wording:
${wrong.join(' | ')}`);
});

test('Y3. the newest stored row of each batch-2 key keeps the English default placeholders (and the en row equals the default)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'(en|ko|zh|ru|ar)'\s*,\s*'((?:[^']|'')*)'\s*\)/g; const latest = new Map<string, { file: string; val: string }>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(f, dir), 'utf8'); const dev = sql.search(/insert into lhq_dev_labels/i); const prod = dev > 0 ? sql.slice(0, dev) : sql;
    for (const m of prod.matchAll(rowRe)) if (m[1] in APPROVED) latest.set(`${m[1]}|${m[2]}`, { file: f, val: m[3].replace(/''/g, "'") });
  }
  const bad: string[] = [];
  for (const [id, r] of latest) { const [key, loc] = id.split('|'); if (ph(r.val) !== ph(DEF[key])) bad.push(`${key}/${loc} (${r.file}): placeholders [${ph(r.val)}] differ from the English default [${ph(DEF[key])}]`); if (loc === 'en' && r.val !== DEF[key]) bad.push(`${key}/en (${r.file}): the newest stored en row differs from the shipped default`); }
  assert.deepEqual(bad, [], `
${bad.join(' | ')}`);
  const missing = Object.keys(APPROVED).filter((k) => !latest.has(`${k}|en`)); assert.deepEqual(missing, [], `batch-2 keys with NO stored en row in any migration (the old words stay live in the database until one is written): ${missing.join(', ')}`);
});
