// Audit the Strategy Card's verdict logic (lib/useEMAStrategy.ts) across coins and
// timeframes. This is a SEPARATE system from the chart markers/backtest engine —
// the verdict additionally requires the Daily 200 SMA direction to agree with the
// selected timeframe's EMA9/20/50 ribbon alignment before it will ever call LONG or
// SHORT. If they disagree, verdict = FREEZE regardless of how strong the ribbon move
// looks on the selected TF. This script snapshots current live state across the board
// to see how often that gate is actually the deciding factor.
import { emaArr, smaArr } from './lib/strategyCore';

const TF_BN: Record<string, string> = { '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };
const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LTCUSDT', 'ADAUSDT', 'DOGEUSDT'];
const TFS = ['15m', '30m', '1h', '4h', '1d'];

async function fetchKlines(sym: string, interval: string, limit: number) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
  if (!r.ok) throw new Error(`${sym} ${interval} -> ${r.status}`);
  const raw = await r.json() as (string | number)[][];
  return raw.map(k => ({ time: +k[0], close: +k[4] }));
}

async function main() {
  // Fetch each coin's daily context once (shared across all TFs for that coin)
  const dailyByCoin: Record<string, { above200D: boolean; priceD: number; sma200: number }> = {};
  for (const sym of COINS) {
    try {
      const c1d = await fetchKlines(sym, '1d', 220);
      const cl1d = c1d.map(c => c.close);
      const s200arr = smaArr(cl1d, 200);
      const priceD = cl1d.at(-1)!;
      const sma200 = s200arr.at(-1)!;
      dailyByCoin[sym] = { above200D: priceD > sma200, priceD, sma200 };
    } catch (e) {
      console.warn(`skip daily ${sym}: ${e}`);
    }
  }

  console.log('\n=== Daily 200 SMA macro state ===');
  for (const sym of COINS) {
    const d = dailyByCoin[sym];
    if (!d) continue;
    const pct = ((d.priceD - d.sma200) / d.sma200 * 100).toFixed(1);
    console.log(`${sym.padEnd(10)} Daily ${d.above200D ? 'ABOVE' : 'BELOW'} 200 SMA (${pct}%)`);
  }

  console.log('\n=== Verdict category per coin x timeframe ===');
  console.log('(BULL=ribbon bullish, BEAR=ribbon bearish, FLAT=tangled/neither)');
  console.log('coin'.padEnd(10) + TFS.map(t => t.padStart(8)).join(''));

  for (const sym of COINS) {
    const d = dailyByCoin[sym];
    if (!d) continue;
    const row: string[] = [];
    for (const tf of TFS) {
      try {
        const candles = await fetchKlines(sym, TF_BN[tf], 500);
        const cl = candles.map(c => c.close);
        const e9 = emaArr(cl, 9), e20 = emaArr(cl, 20), e50 = emaArr(cl, 50);
        const ema9 = e9.at(-1)!, ema20 = e20.at(-1)!, ema50 = e50.at(-1)!;
        const ribbonBull = ema9 > ema20 && ema20 > ema50;
        const ribbonBear = ema50 > ema20 && ema20 > ema9;

        let verdict: string;
        if (d.above200D && ribbonBull) verdict = 'LONG_OK';
        else if (!d.above200D && ribbonBear) verdict = 'SHORT_OK';
        else if (ribbonBull || ribbonBear) verdict = 'FREEZE*'; // ribbon has a direction but disagrees with daily
        else verdict = 'freeze';  // ribbon itself is tangled/flat, unrelated to the daily gate
        row.push(verdict.padStart(8));
      } catch (e) {
        row.push('ERR'.padStart(8));
      }
    }
    console.log(sym.padEnd(10) + row.join(''));
  }

  console.log('\nLONG_OK/SHORT_OK = verdict clears the gate (real setup possible)');
  console.log('FREEZE* = ribbon has a clear directional lean but DISAGREES with Daily 200 SMA — this is the gate the user is asking about');
  console.log('freeze  = ribbon itself is tangled/flat on that TF (unrelated to the daily gate)');
}

main().catch(e => { console.error(e); process.exit(1); });
