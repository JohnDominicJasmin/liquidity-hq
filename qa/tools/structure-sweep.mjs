/* CROSS-TIMEFRAME, CROSS-COIN SWEEP of #1818 Phase 1 detection. Owner's request, 2026-11-07:
 * "different time frames, different coins".
 *
 * WHY THIS TOOL EXISTS RATHER THAN A SPEC: every threshold in `chartStructureDetect.ts` was chosen
 * on 4h and 1d only, and its header says so — *"unverified: whether these thresholds hold for 15m
 * or 1W"*. A spec pins a decision; this measures whether the decision generalises. The answer is a
 * table, not a pass/fail, so it does not belong in the suite.
 *
 * NOTHING BILLED AND NO DATABASE: `detectStructures` is a pure function and the candles come from
 * the public Binance klines endpoint. No xAI call, no quota column, no /api/grok. This is
 * deliberately NOT the Draw Structure route — that one spends money and is switched off anyway.
 *
 * USAGE:  node qa/tools/structure-sweep.mjs            (default coin and timeframe set)
 *         node qa/tools/structure-sweep.mjs BTCUSDT,ETHUSDT 15m,4h
 */
import { detectStructures } from '../../lib/chartStructureDetect.ts';

const SYMBOLS = (process.argv[2] ?? 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,ADAUSDT,DOGEUSDT,LINKUSDT')
  .split(',').map(s => s.trim()).filter(Boolean);
const TFS = (process.argv[3] ?? '15m,1h,4h,1d,1w').split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = 500;

/** Closed candles only — drop the forming one, which is what `chartStructures.ts` asks of callers. */
async function klines(symbol, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${symbol} ${interval}: HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${symbol} ${interval}: empty`);
  return raw.slice(0, -1).map(k => ({
    timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

const rows = [];
const errors = [];

for (const symbol of SYMBOLS) {
  for (const tf of TFS) {
    try {
      const candles = await klines(symbol, tf);
      const r = detectStructures(candles, { timeframe: tf });
      if (r.structures.length === 0) {
        rows.push({ symbol, tf, bars: candles.length, kind: '-', excess: null, r2: null, cand: null, reason: r.reason });
      } else {
        for (const s of r.structures) {
          const touches = s.rails.reduce((a, x) => a + x.quality.touchCount, 0);
          const points = s.rails.reduce((a, x) => a + x.fit.pointCount, 0);
          const r2s = s.rails.map(x => x.fit.r2).filter(v => typeof v === 'number');
          rows.push({
            symbol, tf, bars: candles.length, kind: s.kind,
            excess: touches - points,
            r2: r2s.length ? Math.min(...r2s) : null,
            cand: s.candidatesConsidered, reason: null,
          });
        }
      }
    } catch (e) {
      errors.push(`${symbol} ${tf}: ${e.message}`);
      rows.push({ symbol, tf, bars: null, kind: 'ERR', excess: null, r2: null, cand: null, reason: e.message });
    }
    await new Promise(r => setTimeout(r, 120)); // be polite to the public endpoint
  }
}

const pad = (v, n) => String(v ?? '-').padEnd(n);
console.log('\n' + pad('SYMBOL', 10) + pad('TF', 5) + pad('BARS', 6) + pad('KIND', 11) + pad('EXCESS', 8) + pad('minR2', 11) + pad('CAND', 6) + 'REASON');
console.log('-'.repeat(86));
for (const r of rows) {
  console.log(
    pad(r.symbol, 10) + pad(r.tf, 5) + pad(r.bars, 6) + pad(r.kind, 11) +
    /* SIX DECIMALS, NOT FOUR. At toFixed(4) ADAUSDT 15m printed "1.0000" and I read it as a perfect
       fit on live market data, which would be a real finding. The value is 0.9999680 — the display
       invented the result. An R² column that cannot show the difference between 0.99997 and 1 is
       not reporting R². */
    pad(r.excess, 8) + pad(r.r2 === null ? '-' : r.r2.toFixed(6), 11) + pad(r.cand, 6) + (r.reason ?? ''),
  );
}

/* THE SUMMARY IS PER TIMEFRAME, because that is the question the thresholds cannot currently answer.
   A hit rate that climbs on the fast timeframes means the tolerance is too loose there, and one that
   falls to zero on 1w means the window is too short for the pivot spacing — opposite problems with
   the same symptom in a single overall number. */
console.log('\nPER TIMEFRAME:');
for (const tf of TFS) {
  const mine = rows.filter(r => r.tf === tf && r.kind !== 'ERR');
  const found = mine.filter(r => r.kind !== '-');
  const kinds = [...new Set(found.map(r => r.kind))].join('/') || '-';
  const exc = found.map(r => r.excess).filter(v => typeof v === 'number');
  console.log(
    `  ${pad(tf, 5)} ${found.length}/${mine.length} symbols produced a structure` +
    `   kinds: ${pad(kinds, 12)}` +
    `  excess min/median/max: ${exc.length
      ? `${Math.min(...exc)}/${exc.sort((a, b) => a - b)[Math.floor(exc.length / 2)]}/${Math.max(...exc)}`
      : '-'}`,
  );
}
if (errors.length) {
  console.log('\nERRORS (a fetch failure is not a detector result):');
  for (const e of errors) console.log('  ' + e);
}
console.log('\nNOTE: a "-" is the detector REFUSING, which is the non-negotiable behaviour, not a gap.');
