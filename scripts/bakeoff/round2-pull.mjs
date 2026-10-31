/* ROUND 2: DOES SHAPE ADD ANYTHING ONCE THE TIMEFRAME IS KNOWN? (#1818)
 *
 * ── WHY ROUND 1 CANNOT ANSWER IT ─────────────────────────────────────────────────────────────
 *
 * The owner answered twelve blind charts. Scored structure=1 / maybe=0.5 / noise=0, his mean on
 * our high-z group was **0.67** and on our low-z group was **0.67** - identical. He called
 * structure on our lowest-z window (z = -1.0) and noise on a z of 2.1. **Our statistic predicted
 * nothing about what he would draw.**
 *
 * But his answers were not random. They tracked the timeframe almost perfectly:
 *
 *     15m   0 of 4 structure
 *     1h    1 of 2
 *     4h    3 of 3
 *     1d    2 of 3
 *
 * **He is judging the timeframe. Our statistic has no timeframe term at all** - and the timeframe
 * is the one thing he named in the original proposal.
 *
 * **In round 1 timeframe and z varied together, so the two explanations are indistinguishable.**
 * This set holds the timeframe CONSTANT within a block and varies z inside it. That is the whole
 * design, and it is the only way to tell "the shape statistic works" from "he is answering from
 * the timeframe and the shape is doing no work".
 *
 * ── WHAT THE TWO POSSIBLE READS MEAN, WRITTEN BEFORE THE ANSWERS EXIST ───────────────────────
 *
 * **If his answers separate by z inside a block:** the shape statistic is real, A' is a genuine
 * filter, and the only open parameter is the timeframe floor.
 *
 * **If they do not:** shape is noise, A' collapses to "draw on 4h and above", and the honest
 * recommendation changes - the feature is far simpler, or not worth building. **Recording both
 * reads now, because a criterion chosen after the answers arrive is not a criterion.**
 *
 * ── CHOICES AND THE REASON FOR EACH ──────────────────────────────────────────────────────────
 *
 * **4h and 1h only. 15m is dropped** - he said noise to 4 of 4, so spending his attention there
 * buys nothing. **1h is in because it is where he was ambivalent**, and a threshold would sit
 * exactly there. The daily is out: only 3 windows and the pool has no high-z daily at all.
 *
 * **NO TIMEFRAME FLOOR IS HARDCODED ANYWHERE.** Twelve answers do not set a parameter, and
 * writing 4h into the code now would bake in the thing round 2 exists to test.
 *
 * Run: node scripts/bakeoff/round2-pull.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { classifyWindow } from './classify.mjs';

const OUT = new URL('./round2/', import.meta.url);

/* Blocks, not groups. A block is one timeframe; the split inside it is the variable. */
const BLOCKS = [
  { tf: '240', label: '4 hour' },
  { tf: '60', label: '1 hour' },
];
const PER_ARM = 4;          // 4 high-z + 4 low-z per block = 8 charts, 16 in total
const HIGH_Z = 3;
const LOW_Z = 0;

const COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'ATOMUSDT',
  'FILUSDT', 'CRVUSDT', 'SANDUSDT', 'GMTUSDT', 'PYTHUSDT', 'WLDUSDT', 'SEIUSDT', 'JUPUSDT',
  'ARBUSDT', 'OPUSDT', 'INJUSDT', 'TIAUSDT',
];

const WINDOW = 200;
const DEPTH = 1000;

async function klines(symbol, interval) {
  const u = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${DEPTH}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
  const b = await r.json();
  const rows = (b.result?.list ?? []).map(k => ({
    timestamp: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  })).sort((a, z) => a.timestamp - z.timestamp);
  if (rows.some(r2 => ![r2.open, r2.high, r2.low, r2.close].every(Number.isFinite))) return [];
  return rows;
}

const picked = [];

for (const block of BLOCKS) {
  const arms = { high: [], low: [] };
  for (const symbol of COINS) {
    if (arms.high.length >= PER_ARM && arms.low.length >= PER_ARM) break;
    let rows;
    try { rows = await klines(symbol, block.tf); } catch { continue; }
    if (rows.length < WINDOW) continue;
    for (let end = rows.length; end - WINDOW >= 0; end -= WINDOW) {
      const candles = rows.slice(end - WINDOW, end);
      if (candles.some(r2 => ![r2.open, r2.high, r2.low, r2.close].every(Number.isFinite))) continue;
      const v = classifyWindow(candles);
      if (v.z === null) continue;
      const arm = v.z >= HIGH_Z ? 'high' : v.z <= LOW_Z ? 'low' : null;
      if (!arm || arms[arm].length >= PER_ARM) continue;
      /* One window per coin per arm, so an arm is not four views of one asset - and one per coin
         per BLOCK, so he cannot recognise the same coin twice at the same timeframe. */
      if (arms[arm].some(f => f.symbol === symbol)) continue;
      if (arms.high.concat(arms.low).some(f => f.symbol === symbol && f.tf === block.tf)) continue;
      arms[arm].push({
        id: `r2-${block.tf}-${arm}-${symbol.replace('USDT', '').toLowerCase()}-${candles[0].timestamp}`,
        block: block.label, tf: block.tf, arm, symbol,
        from: new Date(candles[0].timestamp).toISOString(),
        classifier: v,
        candles,
      });
      break;
    }
  }
  picked.push(...arms.high, ...arms.low);
  console.log(`${block.label.padEnd(7)} high-z ${arms.high.length}/${PER_ARM}  low-z ${arms.low.length}/${PER_ARM}`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of picked) writeFileSync(new URL(`${f.id}.json`, OUT), JSON.stringify(f, null, 1));

/** The composition, written out so the balance is visible rather than trusted. */
const comp = {};
for (const b of BLOCKS) {
  const mine = picked.filter(f => f.tf === b.tf);
  comp[b.label] = {
    high: mine.filter(f => f.arm === 'high').map(f => ({ coin: f.symbol.replace('USDT', ''), z: f.classifier.z })),
    low: mine.filter(f => f.arm === 'low').map(f => ({ coin: f.symbol.replace('USDT', ''), z: f.classifier.z })),
  };
}

writeFileSync(new URL('manifest.json', OUT), JSON.stringify({
  pulledAt: new Date().toISOString(),
  question: 'Within a FIXED timeframe, do his answers separate by our z? Round 1 could not tell '
          + 'shape from timeframe because the two varied together.',
  readIfYes: 'The shape statistic is real, A-prime is a genuine filter, and the timeframe floor '
           + 'is the only open parameter.',
  readIfNo: 'Shape is noise, A-prime collapses to "draw on 4h and above", and the honest '
          + 'recommendation changes - simpler, or not worth building.',
  round1: {
    hisMeanOnOurHighZ: 0.67,
    hisMeanOnOurLowZ: 0.67,
    note: 'Identical. He called structure on z = -1.0 and noise on z = 2.1. By timeframe his '
        + 'structure rate was 15m 0/4, 1h 1/2, 4h 3/3, 1d 2/3.',
  },
  design: {
    blocks: BLOCKS.map(b => b.label),
    perArm: PER_ARM, highZ: `>= ${HIGH_Z}`, lowZ: `<= ${LOW_Z}`,
    dropped15m: 'he answered noise to 4 of 4, so his attention there buys nothing',
    droppedDaily: 'the pool contains no high-z daily window at all, in 95 of them',
    noTimeframeFloor: 'NOT hardcoded anywhere. Twelve answers do not set a parameter, and writing '
                    + '4h into the code now would bake in the thing this round exists to test.',
  },
  composition: comp,
  fixtures: picked.map(f => ({ id: f.id, block: f.block, tf: f.tf, arm: f.arm,
                               symbol: f.symbol, z: f.classifier.z })),
}, null, 1));

console.log(`\n${picked.length} windows written to scripts/bakeoff/round2/`);
for (const b of BLOCKS) {
  const c = comp[b.label];
  console.log(`  ${b.label}  high z ${c.high.map(x => x.z).join(', ')}   low z ${c.low.map(x => x.z).join(', ')}`);
}
const shortArm = picked.length < BLOCKS.length * PER_ARM * 2;
if (shortArm) {
  console.log('\nSHORT OF AN ARM. Widen COINS rather than loosening the z thresholds - moving them');
  console.log('is how the two arms stop being distinguishable, which is the whole experiment.');
  process.exitCode = 1;
}
