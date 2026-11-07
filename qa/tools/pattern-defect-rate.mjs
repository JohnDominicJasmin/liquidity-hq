#!/usr/bin/env node
/* HOW OFTEN DO THE TWO lib/patterns.ts DEFECTS FIRE ON REAL DATA?
 *
 *   node qa/tools/pattern-defect-rate.mjs
 *
 * FREE. Public Bybit v5 kline endpoint, no auth, no AI call, nothing billed. Deliberately NOT via
 * the Arena AI read, which costs a call per look - the trap the owner's manual plan warns about.
 *
 * WHY THIS EXISTS. The cells prove both defects by arithmetic. Neither they nor the owner's manual
 * pass can say whether either has ever happened to a real coin, and that is what decides whether
 * Dev fixes them tonight or as hygiene. A rate of zero is as useful as a high one and must be
 * reported just as plainly - QA has already told the owner alerts can carry wrong text, and if the
 * rate is zero that needs correcting from a measurement rather than left to stand.
 *
 * THE LIVE CONFIGURATION, READ FROM THE CALL SITES RATHER THAN CHOSEN:
 *   app/api/telegram/alert/route.ts:762-780   intervals '5', '60', '240', limit 25
 *   components/MarketProvider.tsx:538,605     interval '15', 121 fetched, patterns on slice(-25)
 * So four intervals and TWENTY-FIVE candles. Not 200: a longer window would change every answer,
 * because the trend check reads slice(-10) of whatever it is given and the double-top check needs
 * exactly 20.
 *
 * DEFECT 1 - a flat window reports an uptrend. `allHH` tests `h >= prev` and `allHL` tests
 * `l >= prev`, so EQUAL highs and lows satisfy both. Reported in three tiers because "flat" has
 * degrees and only the first is unarguable:
 *   EXACT      all 10 highs identical AND all 10 lows identical - the pure bug
 *   NEAR       the 10-bar true range is under 0.05% of price - visually dead, arguably the bug
 *   GENUINE    a real monotonic advance - correct output, not a defect
 *
 * DEFECT 2 - the alert shows `pats[0]`, which is source-code check order. Measured as: how often
 * more than one pattern is present, and of those how often a Double top/bottom is present but NOT
 * first, since that is the case where the user is told the less important thing.
 */
import { detectPatterns } from '../../lib/patterns.ts';
import { BYBIT_SYMS, BINANCE_SYMS, COINS } from '../../lib/coins.ts';

const INTERVALS = ['5', '15', '60', '240'];
const LIMIT = 25;
const NEAR_FLAT_PCT = 0.0005;
const UPTREND = 'Higher highs + higher lows (uptrend)';
const DOWNTREND = 'Lower highs + lower lows (downtrend)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function klines(symbol, interval) {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = await res.json();
  const list = d?.result?.list;
  if (!Array.isArray(list) || list.length < LIMIT) return null;
  /* Bybit returns NEWEST FIRST. Reversing is what both call sites do, and getting it wrong would
     invert every trend answer - which is the kind of error that still produces plausible numbers. */
  return [...list].reverse().map((k) => ({
    o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]),
  }));
}

const stats = {
  requested: 0, ok: 0, failed: 0,
  uptrend: 0, downtrend: 0,
  exactFlat: 0, nearFlat: 0, genuine: 0,
  multi: 0, doubleNotFirst: 0, doublePresent: 0,
  examples: [], flatExamples: [],
  /* Every row, kept so the owner-facing table at the end can be built from the SAME fetch rather
     than a second one. The point of that table: on the Arena a pattern name only appears inside
     the AI read, which costs a billed call per look - but the name itself comes from
     `detectPatterns` on 25 klines, which is free. Printing it means his manual pass is "look at the
     chart, read the row" instead of five paid reads to see a string we can hand him for nothing. */
  rows: [],
};

/* The coins and timeframes the manual plan on #1818 names, so those rows are always printed even
   when nothing is detected - an empty row is an answer he needs ("the app says nothing here"). */
const PLAN_ROWS = [['btc', '240'], ['sol', '60'], ['pepe', '60'], ['eth', '240'], ['xrp', '60']];
const TF = { 5: '5m', 15: '15m', 60: '1h', 240: '4h' };

const bybitOnly = new Set(COINS.filter((c) => BYBIT_SYMS[c] && !BINANCE_SYMS[c]));
const targets = COINS.filter((c) => BYBIT_SYMS[c]);

console.log(`measuring ${targets.length} coins x ${INTERVALS.length} intervals x ${LIMIT} candles, live Bybit, nothing billed`);
console.log(`(${bybitOnly.size} of them are the Bybit-only set MarketProvider polls at '15')\n`);

for (const coin of targets) {
  for (const interval of INTERVALS) {
    stats.requested++;
    let c = null;
    try { c = await klines(BYBIT_SYMS[coin], interval); } catch { /* counted below */ }
    if (c === null) { stats.failed++; continue; }
    stats.ok++;

    const found = detectPatterns(c);
    stats.rows.push({ coin, interval, found });

    if (found.includes(UPTREND) || found.includes(DOWNTREND)) {
      if (found.includes(UPTREND)) stats.uptrend++; else stats.downtrend++;
      /* The window the trend check actually reads. */
      const w = c.slice(-10);
      const highs = w.map((x) => x.h), lows = w.map((x) => x.l);
      const allHighsEqual = highs.every((h) => h === highs[0]);
      const allLowsEqual = lows.every((l) => l === lows[0]);
      const span = Math.max(...highs) - Math.min(...lows);
      const ref = w[w.length - 1].c;
      if (allHighsEqual && allLowsEqual) {
        stats.exactFlat++;
        stats.flatExamples.push(`EXACT  ${coin} ${interval}m  every high ${highs[0]}, every low ${lows[0]}`);
      } else if (ref > 0 && span / ref < NEAR_FLAT_PCT) {
        stats.nearFlat++;
        stats.flatExamples.push(`NEAR   ${coin} ${interval}m  10-bar span ${(span / ref * 100).toFixed(4)}% of price`);
      } else {
        stats.genuine++;
      }
    }

    const dbl = found.findIndex((p) => /^Double (top|bottom)/.test(p));
    if (found.length > 1) stats.multi++;
    if (dbl >= 0) {
      stats.doublePresent++;
      if (dbl > 0) {
        stats.doubleNotFirst++;
        if (stats.examples.length < 8) {
          stats.examples.push(`${coin} ${interval}m  shows "${found[0]}"  hides "${found[dbl]}"  (${found.length} found)`);
        }
      }
    }
  }
  await sleep(120);
}

const pct = (n) => stats.ok ? `${(n / stats.ok * 100).toFixed(1)}%` : 'n/a';

console.log('── REQUESTS ──');
console.log(`  ${stats.ok} of ${stats.requested} windows read (${stats.failed} failed - symbol not on linear, or refused)\n`);

console.log('── DEFECT 1: does a flat window report a trend? ──');
console.log(`  trend reported at all:        ${stats.uptrend + stats.downtrend}  (${pct(stats.uptrend + stats.downtrend)})   up ${stats.uptrend} / down ${stats.downtrend}`);
console.log(`  of those, EXACT flat:         ${stats.exactFlat}  <- the unarguable defect`);
console.log(`  of those, NEAR flat (<0.05%): ${stats.nearFlat}`);
console.log(`  of those, GENUINE advance:    ${stats.genuine}  <- correct output`);
console.log(`  DEFECT 1 RATE: ${stats.exactFlat} of ${stats.ok} windows = ${pct(stats.exactFlat)} exact, ${pct(stats.exactFlat + stats.nearFlat)} including near-flat`);
if (stats.flatExamples.length) {
  console.log('  examples:');
  for (const e of stats.flatExamples.slice(0, 8)) console.log(`    ${e}`);
} else {
  console.log('  NO FLAT WINDOW PRODUCED A TREND. On this sample the defect does not fire.');
}

console.log('\n── DEFECT 2: is a Double top hidden behind an earlier name? ──');
console.log(`  windows with >1 pattern:      ${stats.multi}  (${pct(stats.multi)})`);
console.log(`  Double top/bottom present:    ${stats.doublePresent}  (${pct(stats.doublePresent)})`);
console.log(`  ...and NOT shown (not first): ${stats.doubleNotFirst}  <- DEFECT 2 RATE = ${pct(stats.doubleNotFirst)}`);
if (stats.examples.length) {
  console.log('  examples (what the alert would say vs what it suppressed):');
  for (const e of stats.examples) console.log(`    ${e}`);
} else {
  console.log('  No window had a Double top behind another name on this sample.');
}

console.log('\nONE SAMPLE AT ONE MOMENT. A zero here means "not observed now", not "cannot happen" -');
console.log('the cells prove both are reachable. Re-run at a different hour before treating a zero as settled.');

/* ── THE OWNER-FACING TABLE ────────────────────────────────────────────────────────────────────
   Built from the fetch above, so it costs nothing extra and shows the EXACT string the Telegram
   alert would send - not the AI's prose about it. */
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
console.log(`\n\n=== WHAT THE CODE SAYS RIGHT NOW - taken ${stamp} UTC ===`);
console.log('A pattern label is only true for the minutes around the time above. Read it beside the');
console.log('chart, not later.\n');
console.log('COIN    TF     WHAT THE CODE SAYS RIGHT NOW');

const byKey = new Map(stats.rows.map((r) => [`${r.coin}:${r.interval}`, r]));
const printed = new Set();
const line = (r, mark = '') => {
  const key = `${r.coin}:${r.interval}`;
  if (printed.has(key)) return;
  printed.add(key);
  const names = r.found.length ? r.found.join('; ') : '(nothing)';
  console.log(`${r.coin.toUpperCase().padEnd(7)} ${(TF[r.interval] ?? r.interval).padEnd(6)} ${names}${mark}`);
};

/* 1. the rows the plan names, always, empty or not */
for (const [coin, interval] of PLAN_ROWS) {
  const r = byKey.get(`${coin}:${interval}`);
  if (r) line(r); else console.log(`${coin.toUpperCase().padEnd(7)} ${(TF[interval] ?? interval).padEnd(6)} (no data - symbol not on Bybit linear)`);
}
/* 2. every row where a Double top or bottom is present - Step 4 of his plan asks about exactly this */
console.log('');
const dbl = stats.rows.filter((r) => r.found.some((p) => /^Double (top|bottom)/.test(p)));
if (dbl.length) {
  console.log(`-- Double top/bottom found on ${dbl.length} chart(s). "<<" marks one the alert would NOT show you:`);
  for (const r of dbl.slice(0, 12)) {
    line(r, r.found.findIndex((p) => /^Double (top|bottom)/.test(p)) > 0 ? '   << hidden behind the first name' : '');
  }
} else {
  console.log('-- No double top or bottom on any chart right now, so Step 4 of the plan has nothing to look at yet.');
}
/* 3. a few quiet charts, for the Step 3 question */
console.log('');
const quiet = stats.rows.filter((r) => r.found.length === 0 && !printed.has(`${r.coin}:${r.interval}`));
console.log(`-- ${quiet.length} of ${stats.ok} charts show NOTHING. A sample, for Step 3 (does a dead chart claim an uptrend?):`);
for (const r of quiet.slice(0, 5)) line(r);
