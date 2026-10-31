/* PULL THE 12 FIXTURE WINDOWS ONCE AND COMMIT THEM, BALANCED ACROSS TIMEFRAMES (#1818).
 *
 * WHY COMMITTED AND NOT FETCHED AT RUN TIME. A re-run next month has to compare ENGINES, not
 * market conditions. Fetching live would mean every run tests a different chart, and a difference
 * between two runs would be unattributable.
 *
 * GROUPS ARE ASSIGNED BY `classify.mjs`, NOT BY HAND. See its header for why that matters and what
 * it costs. This script's judgement is the CANDIDATE sweep and the BALANCE constraint below.
 *
 * ── THE FIRST FIXTURE SET WAS CONFOUNDED AND THE OWNER CAUGHT IT ─────────────────────────────
 *
 * Version 1 took the first window of each group it found. The result:
 *
 *     A    eth 4h,  xrp 4h,  doge 4h      <- ALL THREE 4-HOUR
 *     B    btc 15m, btc 1d,  eth 15m
 *
 * **So the set partly tested "is this a 4-hour chart?" rather than "is there a pattern here?".**
 * Showing a trader the timeframe would hand him the answer; hiding it makes the question
 * unanswerable, because a shape worth drawing on a daily is not worth drawing on a 15m. He had
 * already said so in the original proposal - "higher time frame has the highest also accuracy" -
 * and the test we built hid the one variable he had flagged.
 *
 * **It is a confound in the ENGINE run too, not only in the human check**, which is why the
 * fixtures are re-picked rather than relabelled.
 *
 * ── THE CONSTRAINT, AND WHAT MEASURING THE POOL FIRST REVEALED ───────────────────────────────
 *
 * Each group spans at least MIN_TFS distinct timeframes and no timeframe exceeds its cap. 395
 * windows were scanned across 4 timeframes and 20 coins BEFORE the constraint was written,
 * because a constraint written against an unmeasured pool just fails quietly:
 *
 *     tf=15m   A=3   B=47  C=50    z range -1.3 to 4.7
 *     tf=1h    A=15  B=30  C=55    z range -2.8 to 6.0
 *     tf=4h    A=6   B=31  C=63    z range -1.3 to 7.8
 *     tf=1d    A=0   B=55  C=40    z range -3.2 to 2.9
 *
 * **NO DAILY WINDOW REACHES GROUP A, in 95 of them.** The best daily z is 2.9 against a threshold
 * of 3. That is a finding rather than a selection failure, and it is in tension with the owner's
 * own view that the higher timeframe is the more reliable one: by this statistic there is LESS
 * detectable line structure on the daily than on the 4h. Worth his eye rather than our
 * explanation, which is exactly what the blind chart review is for.
 *
 * So group A spans 15m, 1h and 4h, and the daily appears in B and C where it genuinely exists.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { classifyWindow } from './classify.mjs';

const OUT = new URL('./fixtures/', import.meta.url);

/* DAILY FIRST, and the order is load-bearing. Iterating 15m upward filled every group before
   reaching the daily, so the balanced set had no daily window at all - trading one confound
   for another. Taking D first gives it first claim on the groups where it CAN appear; group A
   then fills from the shorter timeframes because no daily window reaches z >= 3 at all. */
const TFS = ['D', '15', '240', '60'];
/** Reported in the manifest: the timeframes a group must include when the pool allows it. A
 *  cannot include the daily - 0 of 95 daily windows reach its threshold - so requiring one
 *  there would fail forever rather than usefully. */
const REQUIRE_TF = { A: [], B: ['D'], C: ['D'] };
/* Spread across liquidity tiers: a structureless window is easier to find on a thin coin and a
   textbook channel on a major, so drawing both from one coin would bias the groups. */
const COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'ATOMUSDT',
  'FILUSDT', 'CRVUSDT', 'SANDUSDT', 'GMTUSDT', 'PYTHUSDT', 'WLDUSDT', 'SEIUSDT', 'JUPUSDT',
  'ARBUSDT', 'OPUSDT', 'INJUSDT', 'TIAUSDT',
];

const WINDOW = 200;
const DEPTH = 1000;
const WANT = { A: 3, B: 3, C: 6 };
const MIN_TFS = { A: 3, B: 3, C: 3 };
const MAX_PER_TF_PER_GROUP = { A: 1, B: 1, C: 2 };
/** One fixture per coin per group, so no group is mostly one asset. */
const MAX_PER_COIN_PER_GROUP = 1;

async function klines(symbol, interval) {
  const u = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${DEPTH}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
  const b = await r.json();
  const rows = (b.result?.list ?? []).map(k => ({
    timestamp: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  })).sort((a, z) => a.timestamp - z.timestamp);
  /* A hole in the series manufactures or vetoes pivots silently, so a candidate is rejected whole
     rather than shipped with a gap in it. */
  if (rows.some(r2 => ![r2.open, r2.high, r2.low, r2.close].every(Number.isFinite))) return [];
  return rows;
}

const found = { A: [], B: [], C: [] };
const full = g => found[g].length >= WANT[g];
const tfCount = (g, tf) => found[g].filter(f => f.interval === tf).length;
const coinCount = (g, sym) => found[g].filter(f => f.symbol === sym).length;

/* BREADTH FIRST, IN TWO ROUNDS, AND THE SECOND ROUND IS NOT OPTIONAL.
 *
 * Round 1 allows at most ONE window per group per timeframe, so every group reaches across the
 * timeframes before any group takes a second of anything. Round 2 then tops groups up to their
 * cap.
 *
 * A single pass with a cap of 2 produced a set where **1h appeared exactly once, in group A** -
 * so "this is a 1h chart" predicted the group, which is version 1's confound in miniature. The
 * check for it is at the bottom of this file and it is what caught this. */
for (let round = 1; round <= 2; round++) {
for (const interval of TFS) {
  for (const symbol of COINS) {
    if (['A', 'B', 'C'].every(full)) break;
    let rows;
    try { rows = await klines(symbol, interval); } catch { continue; }
    if (rows.length < WINDOW) continue;

    /* Non-overlapping windows, newest first - overlapping ones would let two fixtures share most
       of their candles, so an engine's answer on one would predict its answer on the other. */
    for (let end = rows.length; end - WINDOW >= 0; end -= WINDOW) {
      const candles = rows.slice(end - WINDOW, end);
      if (candles.some(r2 => ![r2.open, r2.high, r2.low, r2.close].every(Number.isFinite))) continue;
      const verdict = classifyWindow(candles);
      const g = verdict.group;
      if (full(g)) continue;
      const capThisRound = round === 1 ? 1 : MAX_PER_TF_PER_GROUP[g];
      if (tfCount(g, interval) >= capThisRound) continue;
      if (coinCount(g, symbol) >= MAX_PER_COIN_PER_GROUP) continue;
      found[g].push({
        id: `${g}-${symbol.replace('USDT', '').toLowerCase()}-${interval}-${candles[0].timestamp}`,
        group: g, symbol, interval,
        from: new Date(candles[0].timestamp).toISOString(),
        to: new Date(candles[candles.length - 1].timestamp).toISOString(),
        classifier: verdict,
        candles,
      });
      break;
    }
  }
}
}

/* CLEAR FIRST. Two earlier classifier versions left 9 stale fixtures here, one an `A-btc-15` for
   a window the current classifier calls B - a file asserting a group the code no longer agrees
   with, in a directory the runner globs. */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const g of ['A', 'B', 'C']) {
  for (const f of found[g]) {
    writeFileSync(new URL(`${f.id}.json`, OUT), JSON.stringify(f, null, 1));
    manifest.push({ id: f.id, group: f.group, symbol: f.symbol, interval: f.interval,
                    from: f.from, to: f.to, classifier: f.classifier });
  }
}

/** The composition table, written into the manifest so the next reader can SEE the balance rather
 *  than trust it - which is the whole point of re-picking the set. */
const composition = {};
for (const g of ['A', 'B', 'C']) {
  composition[g] = {
    count: found[g].length,
    timeframes: Object.fromEntries(TFS.map(t => [t, tfCount(g, t)]).filter(([, n]) => n > 0)),
    distinctTimeframes: new Set(found[g].map(f => f.interval)).size,
    coins: found[g].map(f => f.symbol.replace('USDT', '')),
  };
}

writeFileSync(new URL('manifest.json', OUT), JSON.stringify({
  pulledAt: new Date().toISOString(),
  source: 'bybit v5 linear kline',
  window: WINDOW,
  composition,
  requiredTimeframes: REQUIRE_TF,
  notes: [
    'Groups assigned by scripts/bakeoff/classify.mjs, not by hand.',
    'BALANCED ACROSS TIMEFRAMES after the owner found that v1 group A was entirely 4-hour, so the '
      + 'set partly tested "is this a 4h chart?" rather than "is there a pattern?". That was a '
      + 'confound in the engine run as well as in the human check.',
    'NO DAILY WINDOW REACHES GROUP A: over 95 daily windows the best z is 2.9 against a threshold '
      + 'of 3. A finding, not a selection failure - and in tension with the owner own view that '
      + 'the higher timeframe is more reliable, which the blind chart review is the right way to '
      + 'settle.',
  ],
  fixtures: manifest,
}, null, 1));

console.log(`A=${found.A.length}/${WANT.A}  B=${found.B.length}/${WANT.B}  C=${found.C.length}/${WANT.C}`);
console.log('\ngroup  tf    coin      z       touches  null mean');
for (const g of ['A', 'B', 'C']) {
  for (const f of found[g]) {
    const c = f.classifier;
    console.log(`  ${g}    ${String(f.interval).padEnd(5)} ${f.symbol.replace('USDT', '').padEnd(9)} ${String(c.z).padEnd(7)} ${String(c.touches).padEnd(8)} ${c.nullMean}`);
  }
}
console.log('\ncomposition:');
for (const g of ['A', 'B', 'C']) {
  const c = composition[g];
  console.log(`  ${g}  ${c.distinctTimeframes} distinct timeframes  ${JSON.stringify(c.timeframes)}  coins ${c.coins.join(',')}`);
}
const short = ['A', 'B', 'C'].filter(g => found[g].length < WANT[g]);
const unbalanced = ['A', 'B', 'C'].filter(g => composition[g].distinctTimeframes < MIN_TFS[g]);
const missingReq = ['A', 'B', 'C'].filter(g => REQUIRE_TF[g].some(t => !tfCount(g, t)));
/* THE CHECK THAT CAUGHT THE SECOND CONFOUND. A timeframe appearing in exactly one group means
   that timeframe predicts the group, which is what the whole re-pick exists to remove. */
const predictive = [...new Set(manifest.map(f => f.interval))]
  .filter(tf => new Set(manifest.filter(f => f.interval === tf).map(f => f.group)).size === 1);
if (predictive.length) {
  console.log(`
TIMEFRAME PREDICTS THE GROUP: ${predictive.join(', ')} appears in only one group.`);
}
if (missingReq.length) console.log(`
MISSING A REQUIRED TIMEFRAME: ${missingReq.join(', ')}`);
if (short.length) console.log(`\nSHORT: ${short.join(', ')}. Widen COINS rather than loosening classify.mjs.`);
if (unbalanced.length) console.log(`\nUNBALANCED: ${unbalanced.join(', ')} span fewer distinct timeframes than required.`);
if (short.length || unbalanced.length || missingReq.length || predictive.length) process.exitCode = 1;
