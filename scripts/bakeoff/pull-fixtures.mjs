/* PULL THE 12 FIXTURE WINDOWS ONCE AND COMMIT THEM (#1818).
 *
 * WHY COMMITTED AND NOT FETCHED AT RUN TIME. A re-run next month has to compare ENGINES, not
 * market conditions. Fetching live would mean every run tests a different chart, and a difference
 * between two runs would be unattributable - the exact failure the spec's "saved as JSON so the
 * run is reproducible" line exists to prevent.
 *
 * WHY BYBIT DIRECTLY RATHER THAN OUR OWN ROUTE. `/api/market/klines` needs a running server and an
 * auth token; this is a one-off script. The shape is converted to PACandle here, which is what
 * `lib/chartStructures.ts` consumes, so the fixtures are in the app's own units.
 *
 * GROUPS ARE ASSIGNED BY `classify.mjs`, NOT BY ME. See its header for why that matters and what
 * it costs. This script's only judgement is the CANDIDATE list - which coins and timeframes to
 * look at - and that is stated below rather than being an accident of what I happened to try.
 *
 * Run: node scripts/bakeoff/pull-fixtures.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { classifyWindow } from './classify.mjs';

const OUT = new URL('./fixtures/', import.meta.url);

/* THE CANDIDATE SWEEP. Spread across the timeframes the spec names (15m/1h/4h/1d) and across
   liquidity tiers, because a structureless window is easier to find on a thin coin and a textbook
   channel is easier to find on a major - taking both from one coin would bias the groups. */
const CANDIDATES = [
  ['BTCUSDT', '15'], ['BTCUSDT', '60'], ['BTCUSDT', '240'], ['BTCUSDT', 'D'],
  ['ETHUSDT', '15'], ['ETHUSDT', '60'], ['ETHUSDT', '240'], ['ETHUSDT', 'D'],
  ['SOLUSDT', '60'], ['SOLUSDT', '240'],
  ['XRPUSDT', '60'], ['XRPUSDT', '240'],
  ['DOGEUSDT', '60'], ['DOGEUSDT', '240'],
  ['LINKUSDT', '60'], ['LINKUSDT', '240'],
  ['AVAXUSDT', '60'], ['AVAXUSDT', '240'],
  ['ATOMUSDT', '60'], ['FILUSDT', '60'], ['CRVUSDT', '60'], ['SANDUSDT', '60'],
  ['MANAUSDT', '60'], ['GMTUSDT', '60'], ['PYTHUSDT', '60'], ['WLDUSDT', '60'],
  ['SEIUSDT', '60'], ['JUPUSDT', '60'], ['ARBUSDT', '60'], ['OPUSDT', '60'],
];

const WINDOW = 200;   // candles per fixture - enough for 3-pivot lines with room to confirm
const DEPTH = 600;    // fetched per candidate, so several non-overlapping windows come from one call

async function klines(symbol, interval) {
  const u = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${DEPTH}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
  const b = await r.json();
  const rows = (b.result?.list ?? []).map(k => ({
    timestamp: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  })).sort((a, z) => a.timestamp - z.timestamp);
  /* A hole in the series manufactures or vetoes pivots silently - findSwingPivots' own comment
     says a non-finite high disqualifies the centre bar. Reject the whole candidate rather than
     ship a fixture with a gap in it. */
  if (rows.some(r => ![r.open, r.high, r.low, r.close].every(Number.isFinite))) return [];
  return rows;
}

const found = { A: [], B: [], C: [] };
const WANT = { A: 3, B: 3, C: 6 };

for (const [symbol, interval] of CANDIDATES) {
  if (Object.keys(WANT).every(g => found[g].length >= WANT[g])) break;
  let rows;
  try { rows = await klines(symbol, interval); } catch { continue; }
  if (rows.length < WINDOW * 2) continue;

  /* Non-overlapping windows, newest first. Overlapping ones would let two fixtures share most of
     their candles, so an engine's answer on one would predict its answer on the other. */
  for (let end = rows.length; end - WINDOW >= 0; end -= WINDOW) {
    const candles = rows.slice(end - WINDOW, end);
    const verdict = classifyWindow(candles);
    const g = verdict.group;
    if (found[g].length >= WANT[g]) continue;
    /* One fixture per coin+timeframe per group, so the set does not become six views of one coin. */
    if (found[g].some(f => f.symbol === symbol && f.interval === interval)) continue;
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

/* CLEAR FIRST. Two earlier classifier versions left 9 stale fixtures here, one of them an
   `A-btc-15` for a window the current classifier calls B - a file asserting a group the code no
   longer agrees with. A re-run that only ADDS files leaves the directory a mix of verdicts from
   different versions, and the runner globs the directory. */
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
writeFileSync(new URL('manifest.json', OUT), JSON.stringify({
  pulledAt: new Date().toISOString(),
  source: 'bybit v5 linear kline',
  window: WINDOW,
  note: 'Groups assigned by scripts/bakeoff/classify.mjs, not by hand. See its header for the limit this creates.',
  fixtures: manifest,
}, null, 1));

console.log(`A=${found.A.length}/${WANT.A}  B=${found.B.length}/${WANT.B}  C=${found.C.length}/${WANT.C}`);
for (const g of ['A', 'B', 'C']) {
  for (const f of found[g]) {
    const c = f.classifier;
    console.log(`  ${f.group}  ${f.symbol.padEnd(10)} ${String(f.interval).padEnd(4)} z=${String(c.z).padEnd(7)} touches=${String(c.touches).padEnd(4)} null=${String(c.nullMean).padEnd(6)}sd=${String(c.nullSd).padEnd(6)} max=${String(c.nullMax).padEnd(4)} ${f.id}`);
  }
}
if (Object.keys(WANT).some(g => found[g].length < WANT[g])) {
  console.log('\nSHORT OF THE TARGET. Widen CANDIDATES rather than loosening classify.mjs -');
  console.log('moving a threshold to fill a group is how group A stops meaning "unambiguous".');
  process.exitCode = 1;
}
