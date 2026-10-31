/* ROUND 2 AS 16 BLIND CHARTS (#1818).
 *
 * Same blinding as round 1, and the reasons have not changed: **no z, no arm, no coin, no price
 * axis, no leaking filename.** He is answering "would you draw something here?", and anything of
 * ours on the page turns that into "do you agree with us?".
 *
 * **THE TIMEFRAME IS SHOWN, AND HERE IT IS THE POINT RATHER THAN A CONCESSION.** Round 2 holds the
 * timeframe constant inside each block and varies our z, so the timeframe label cannot predict the
 * arm - every 4-hour chart is one of four high-z and four low-z, and the same at 1 hour. In round 1
 * the timeframe DID predict the group, which is why it had to be re-picked.
 *
 * **THE TWO BLOCKS ARE SHUFFLED TOGETHER, NOT PRESENTED IN ORDER.** Eight 4-hour charts in a row
 * followed by eight 1-hour charts would let him calibrate within a block and answer the second
 * half relative to the first. Interleaved, each chart is judged on its own.
 *
 * Run: node scripts/bakeoff/round2-render.mjs
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

const SRC = new URL('./round2/', import.meta.url);
const OUT = new URL('./round2-charts/', import.meta.url);
const SEED = 20261031003;

const W = 1200, H = 620, PAD = 24;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, seed) {
  const rand = rng(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function svg(candles, label) {
  const lo = Math.min(...candles.map(c => c.low));
  const hi = Math.max(...candles.map(c => c.high));
  const span = hi - lo || 1;
  const x = i => PAD + (i * (W - 2 * PAD)) / (candles.length - 1 || 1);
  const y = p => PAD + (1 - (p - lo) / span) * (H - 2 * PAD);
  const bw = Math.max(2, ((W - 2 * PAD) / candles.length) * 0.62);
  const bars = candles.map((c, i) => {
    const cx = x(i);
    /* Monochrome: green/red is a direction cue, one more thing on the page that is not candles. */
    const fill = c.close >= c.open ? '#e8e8e8' : '#4a4a4a';
    const top = y(Math.max(c.open, c.close));
    const bot = y(Math.min(c.open, c.close));
    return `<line x1="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="#9a9a9a" stroke-width="1"/>`
         + `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}" fill="${fill}" stroke="#9a9a9a" stroke-width="0.5"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
       + `<rect width="${W}" height="${H}" fill="#111317"/>${bars}`
       + `<text x="${PAD}" y="${H - 6}" font-family="system-ui,sans-serif" font-size="13" fill="#6a6a6a">${label}</text>`
       + `</svg>`;
}

const fixtures = readdirSync(SRC).filter(n => n !== 'manifest.json')
  .map(n => JSON.parse(readFileSync(new URL(n, SRC), 'utf8')));
if (fixtures.length !== 16) {
  console.error(`expected 16 windows, found ${fixtures.length} - run round2-pull.mjs first`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const order = shuffled(fixtures, SEED);
const key = [];
order.forEach((fx, i) => {
  const n = String(i + 1).padStart(2, '0');
  writeFileSync(new URL(`chart-${n}.svg`, OUT), svg(fx.candles, `Chart ${i + 1}  ·  ${fx.block} candles`));
  key.push({ chart: `chart-${n}.svg`, fixtureId: fx.id, block: fx.block, arm: fx.arm,
             z: fx.classifier.z, symbol: fx.symbol });
});

writeFileSync(new URL('QUESTIONS.md', OUT), [
  '# Sixteen charts — would you draw something here?',
  '',
  'Same as last time. One word per chart:',
  '',
  '- **structure** — there is a line, channel or level here you would actually draw',
  '- **noise** — nothing here you would draw',
  '- **maybe** — borderline',
  '',
  'Each chart says its timeframe. The coin is not shown, and neither is our own answer.',
  '',
  '**Why sixteen and not twelve.** Last time your answers tracked the timeframe almost exactly —',
  '4-hour 3 of 3, 15-minute 0 of 4 — and our maths scored the same on the charts you called',
  'structure as on the ones you called noise. So we could not tell whether our shape measurement',
  'does any work, or whether the timeframe alone explains everything.',
  '',
  'This set fixes that: **eight 4-hour charts and eight 1-hour charts**, and within each timeframe',
  'half are ones our maths rates highly and half it rates as nothing. If your answers split the',
  'same way ours do inside one timeframe, the shape measurement is real. If they do not, it is not,',
  'and the feature gets simpler.',
  '',
  '15-minute charts are dropped — you said noise to all four, so there is nothing more to learn there.',
  '',
  ...order.map((_, i) => `${i + 1}. chart-${String(i + 1).padStart(2, '0')}.svg  →  `),
  '',
  '---',
  '',
  'Our answers are in `ANSWER-KEY.json`, which should stay unopened until yours are written down.',
].join('\n'));

writeFileSync(new URL('ANSWER-KEY.json', OUT), JSON.stringify({
  note: 'DO NOT SHOW WITH THE CHARTS. Record his answers first.',
  seed: SEED,
  howToRead: 'Score structure=1, maybe=0.5, noise=0. Compare his mean on the high-z arm against '
           + 'the low-z arm WITHIN each block. Across blocks tells you nothing new - round 1 '
           + 'already showed he tracks timeframe.',
  blocks: ['4 hour', '1 hour'],
  key,
}, null, 1));

console.log('wrote 16 charts + QUESTIONS.md + ANSWER-KEY.json to scripts/bakeoff/round2-charts/');
console.log('presented arms :', key.map(k => k.arm === 'high' ? 'H' : 'l').join(' '));
console.log('presented tfs  :', key.map(k => k.block === '4 hour' ? '4h' : '1h').join(' '));
/* The check that matters: within each block both arms must be present, or the block is not an
   experiment. And the blocks must be interleaved rather than presented in order. */
for (const b of ['4 hour', '1 hour']) {
  const arms = new Set(key.filter(k => k.block === b).map(k => k.arm));
  console.log(`  ${b}: ${key.filter(k => k.block === b).length} charts, arms ${[...arms].join('+')}`);
}
