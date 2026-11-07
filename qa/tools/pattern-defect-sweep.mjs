#!/usr/bin/env node
/* TEMPORAL rate for the two lib/patterns.ts defects, as opposed to the one-moment snapshot.
 *
 *   node qa/tools/pattern-defect-sweep.mjs [interval...]      default: 5 60
 *
 * FREE. Public Bybit v5 kline endpoint, no auth, no AI call, nothing billed.
 *
 * ── WHY THIS FILE EXISTS, WHICH IS A CORRECTION TO MY OWN CLAIM ─────────────────────────────────
 *
 * `pattern-defect-rate.mjs` reads ONE 25-candle window per coin-interval. I ran it, found 0 trend
 * names in 196 windows, and wrote that the trend branch is "effectively dead in production" and
 * that "nobody has ever seen either" name. Both overreach what a snapshot can support:
 *
 *   - a 10-bar monotonic run is a PER-MOMENT event, and there are thousands of windows per coin
 *     per week, of which the snapshot inspects exactly one;
 *   - "nobody has ever seen it" is a claim about HISTORY, inferred from a sample of the present.
 *
 * It mattered because I offered that zero to Dev as grounds for porting or deleting the trend
 * block, and a delete justified by a one-moment zero gets found out later.
 *
 * SO THIS MEASURES THE CLAIM INSTEAD OF CAVEATING IT. 1000 candles per coin - Bybit's maximum - then
 * a 25-candle window slid one bar at a time, which evaluates every window the live detector would
 * have seen across that span. At 5m that is about 3.4 days per coin; at 60m about 41 days.
 *
 * WHAT IT STILL CANNOT TELL YOU: these are the last N candles, not a random sample of all history,
 * so a regime that never occurred in this window is still unmeasured. A zero here is a much tighter
 * bound than a zero from the snapshot, and it is still a bound rather than a proof of unreachability.
 * The cells in __tests__/patterns.test.mts are what prove the branch is reachable at all.
 */
import { detectPatterns } from '../../lib/patterns.ts';
import { BYBIT_SYMS, COINS } from '../../lib/coins.ts';

const WINDOW = 25;                       // what both live call sites pass
const TREND_WINDOW = 10;                 // what the trend check reads inside it
const FETCH = 1000;                      // Bybit v5 maximum
const NEAR_FLAT_PCT = 0.0005;
const UPTREND = 'Higher highs + higher lows (uptrend)';
const DOWNTREND = 'Lower highs + lower lows (downtrend)';
const argIntervals = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const INTERVALS = argIntervals.length ? argIntervals : ['5', '60'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function history(symbol, interval) {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${FETCH}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = await res.json();
  const list = d?.result?.list;
  if (!Array.isArray(list) || list.length < WINDOW + 1) return null;
  return [...list].reverse().map((k) => ({
    o: +k[1], h: +k[2], l: +k[3], c: +k[4],
  }));
}

const s = {
  coins: 0, windows: 0,
  trend: 0, up: 0, down: 0, exactFlat: 0, nearFlat: 0, genuine: 0,
  dblPresent: 0, dblNotFirst: 0, multi: 0,
  trendEx: [], flatEx: [],
  perCoinTrend: new Map(),
};

const targets = COINS.filter((c) => BYBIT_SYMS[c]);
console.log(`SWEEP: ${targets.length} coins x intervals ${INTERVALS.join(',')} x ${FETCH} candles,`);
console.log(`sliding a ${WINDOW}-candle window one bar at a time. Public Bybit, nothing billed.\n`);

for (const coin of targets) {
  for (const interval of INTERVALS) {
    let h = null;
    try { h = await history(BYBIT_SYMS[coin], interval); } catch { /* skipped */ }
    if (h === null) continue;
    s.coins++;

    for (let end = WINDOW; end <= h.length; end++) {
      const w = h.slice(end - WINDOW, end);
      s.windows++;
      const found = detectPatterns(w);
      if (found.length > 1) s.multi++;

      if (found.includes(UPTREND) || found.includes(DOWNTREND)) {
        s.trend++;
        if (found.includes(UPTREND)) s.up++; else s.down++;
        s.perCoinTrend.set(coin, (s.perCoinTrend.get(coin) ?? 0) + 1);

        const t = w.slice(-TREND_WINDOW);
        const highs = t.map((x) => x.h), lows = t.map((x) => x.l);
        const span = Math.max(...highs) - Math.min(...lows);
        const ref = t[t.length - 1].c;
        if (highs.every((x) => x === highs[0]) && lows.every((x) => x === lows[0])) {
          s.exactFlat++;
          if (s.flatEx.length < 6) s.flatEx.push(`EXACT ${coin} ${interval}m  every high ${highs[0]}, every low ${lows[0]}`);
        } else if (ref > 0 && span / ref < NEAR_FLAT_PCT) {
          s.nearFlat++;
          if (s.flatEx.length < 6) s.flatEx.push(`NEAR  ${coin} ${interval}m  ${(span / ref * 100).toFixed(4)}% span`);
        } else {
          s.genuine++;
          if (s.trendEx.length < 6) s.trendEx.push(`${coin} ${interval}m  ${found[0]}`);
        }
      }

      const d = found.findIndex((p) => /^Double (top|bottom)/.test(p));
      if (d >= 0) { s.dblPresent++; if (d > 0) s.dblNotFirst++; }
    }
    await sleep(120);
  }
}

const pct = (n) => s.windows ? `${(n / s.windows * 100).toFixed(2)}%` : 'n/a';
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

console.log(`── ${s.windows.toLocaleString()} WINDOWS across ${s.coins} coin-interval series, taken ${stamp} UTC ──\n`);

console.log('DEFECT 1 - a flat window reports a trend');
console.log(`  any trend name fired:     ${s.trend.toLocaleString()}  (${pct(s.trend)})   up ${s.up} / down ${s.down}`);
console.log(`  of those, EXACT flat:     ${s.exactFlat}   <- the unarguable defect`);
console.log(`  of those, NEAR flat:      ${s.nearFlat}`);
console.log(`  of those, GENUINE:        ${s.genuine}`);
console.log(`  DEFECT 1 RATE: ${pct(s.exactFlat)} exact, ${pct(s.exactFlat + s.nearFlat)} including near-flat`);
if (s.flatEx.length) { console.log('  flat examples:'); for (const e of s.flatEx) console.log(`    ${e}`); }
if (s.trend === 0) {
  console.log('  NO TREND NAME FIRED IN ANY WINDOW. This is a far tighter bound than the snapshot,');
  console.log('  but it is still a bound: these are the last 1000 candles, not all history.');
} else {
  console.log(`  coins where a trend DID fire: ${[...s.perCoinTrend.entries()].map(([c, n]) => `${c}:${n}`).join(' ')}`);
  if (s.trendEx.length) { console.log('  genuine-trend examples:'); for (const e of s.trendEx) console.log(`    ${e}`); }
}

console.log('\nDEFECT 2 - a Double top hidden behind an earlier name');
console.log(`  >1 pattern at once:       ${s.multi.toLocaleString()}  (${pct(s.multi)})`);
console.log(`  Double top/bottom there:  ${s.dblPresent.toLocaleString()}  (${pct(s.dblPresent)})`);
console.log(`  ...and NOT shown:         ${s.dblNotFirst.toLocaleString()}  <- DEFECT 2 RATE = ${pct(s.dblNotFirst)}`);

console.log('\nOverlapping windows are NOT independent samples - consecutive ones share 24 of 25');
console.log('candles - so read these as "share of moments the detector would have been wrong",');
console.log('not as a count of distinct market events.');
