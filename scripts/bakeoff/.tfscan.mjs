/* Can each timeframe reach each group? If 15m cannot reach z>=3 that is a finding about where
   structure lives, not a selection failure - so it has to be measured before the constraint is
   written, or the constraint will just quietly fail. */
import { classifyWindow } from './classify.mjs';
const TFS = ['15','60','240','D'];
const COINS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','ATOMUSDT','FILUSDT','CRVUSDT','SANDUSDT','GMTUSDT','PYTHUSDT','WLDUSDT','SEIUSDT','JUPUSDT','ARBUSDT','OPUSDT','INJUSDT','TIAUSDT'];
const W=200, DEPTH=1000;
const rows=[];
for (const tf of TFS) {
  for (const sym of COINS) {
    let b; try {
      b = await (await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${tf}&limit=${DEPTH}`,{signal:AbortSignal.timeout(25000)})).json();
    } catch { continue; }
    const all=(b.result?.list??[]).map(k=>({timestamp:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]})).sort((a,z)=>a.timestamp-z.timestamp);
    if (all.length < W) continue;
    for (let end=all.length; end-W>=0; end-=W) {
      const c=all.slice(end-W,end);
      if (c.some(r=>![r.open,r.high,r.low,r.close].every(Number.isFinite))) continue;
      const v=classifyWindow(c);
      rows.push({tf, sym, z:v.z, group:v.group, t0:c[0].timestamp});
    }
  }
  const mine=rows.filter(r=>r.tf===tf);
  const g=l=>mine.filter(r=>r.group===l).length;
  const zs=mine.map(r=>r.z).filter(v=>v!==null).sort((a,b)=>a-b);
  console.log(`tf=${tf.padEnd(4)} windows=${String(mine.length).padEnd(4)} A=${g('A')} B=${g('B')} C=${g('C')}  z min=${zs[0]} max=${zs[zs.length-1]}`);
}
console.log('\nA-capable timeframes:', [...new Set(rows.filter(r=>r.group==='A').map(r=>r.tf))].join(' ') || 'NONE');
console.log('B-capable timeframes:', [...new Set(rows.filter(r=>r.group==='B').map(r=>r.tf))].join(' ') || 'NONE');
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./.tfscan.json', import.meta.url), JSON.stringify(rows));
console.log('\nwrote', rows.length, 'window verdicts to .tfscan.json');
