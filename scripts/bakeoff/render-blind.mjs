/* TWELVE WINDOWS AS CHARTS, BLIND, FOR THE ONLY TRADER WE HAVE (#1818).
 *
 * Our geometry sorts these windows into "structure", "ordinary" and "noise" and **nobody has
 * checked that against a human's eye.** The statistic is internally consistent and behaves
 * sensibly; agreement with a trader is the one ground truth that matters commercially and it has
 * never been measured. This renders the windows so it can be.
 *
 * **IT RUNS BEFORE THE A/B/C DECISION, NOT AFTER IT.** Option A makes our geometry the filter on
 * every AI proposal, so whether the filter matches his eye is the largest single input to the
 * choice he is being asked to make. Validating afterwards would be asking him to pick A on an
 * unvalidated filter. PM moved it; it had been filed as a post-build nicety.
 *
 * ── WHAT IS DELIBERATELY NOT ON THESE CHARTS, AND WHY EACH ONE WOULD RUIN IT ─────────────────
 *
 * **No group letter, no z, no touch count, no null mean.** He is answering "would you draw
 * something here?" - anything of ours on the page turns that into "do you agree with us?", which
 * is a different and useless question. Same blinding as stripping vendor identity before scoring.
 *
 * **No file name that leaks the answer.** `chart-07.svg`, in an order shuffled from a seed. The
 * fixture ids start with `A-`, `B-` and `C-`, so using them would print the verdict in the
 * filename.
 *
 * **No price axis and no dates.** Not squeamishness: a y-axis reading 82,000 identifies BTC, and
 * he may read a major differently from an altcoin. The question is scale-free, so the scale goes.
 *
 * **THE TIMEFRAME IS SHOWN, AND IT WAS NOT IN VERSION 1.** The owner's objection to the first set
 * was that his answer depends on the timeframe - a shape worth drawing on a daily is not worth
 * drawing on a 15m - and he had already said so in the proposal. Hiding it made the question
 * unanswerable. **It leaks nothing now only because the fixtures were re-picked:** every timeframe
 * appears in at least two groups, so "this is a 1h chart" no longer predicts the verdict. In
 * version 1, group A was entirely 4-hour and showing it would have handed over the answer.
 * The coin is still hidden, because the coin is the thing that biases.
 *
 * **No answer key beside the charts.** It is written to a separate file for PM to hold. A page
 * where his answer and ours appear together invites the reading that he saw ours first.
 *
 * SVG rather than PNG, so there is no image dependency and he can open the folder in a browser.
 *
 * Run: node scripts/bakeoff/render-blind.mjs
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

const FIX = new URL('./fixtures/', import.meta.url);
const OUT = new URL('./blind-charts/', import.meta.url);
/* NEW SEED for the balanced set. The old order keyed to the old fixtures, and a stale page used
   against new charts is worse than no page - PM is deleting their copy of the v1 viewer. */
const SEED = 20261031002;

const W = 1200, H = 620, PAD = 24;

/** Seeded shuffle, so the order is reproducible - a key that no longer matches the charts is
 *  worse than no key, and "which chart was number 7" has to stay answerable. */
function shuffled(arr, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    const up = c.close >= c.open;
    /* Monochrome on purpose. Green/red is a read of direction, and a colour cue is one more thing
       on the page that is not the candles. */
    const fill = up ? '#e8e8e8' : '#4a4a4a';
    const top = y(Math.max(c.open, c.close));
    const bot = y(Math.min(c.open, c.close));
    const bh = Math.max(1, bot - top);
    return `<line x1="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="#9a9a9a" stroke-width="1"/>`
         + `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}" stroke="#9a9a9a" stroke-width="0.5"/>`;
  }).join('');

  /* The only text is the neutral label. No axis, no ticks, no numbers - see the header. */
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
       + `<rect width="${W}" height="${H}" fill="#111317"/>`
       + bars
       + `<text x="${PAD}" y="${H - 6}" font-family="system-ui,sans-serif" font-size="13" fill="#6a6a6a">${label}</text>`
       + `</svg>`;
}

const fixtures = readdirSync(FIX).filter(n => n !== 'manifest.json')
  .map(n => JSON.parse(readFileSync(new URL(n, FIX), 'utf8')));
if (fixtures.length !== 12) {
  console.error(`expected 12 fixtures, found ${fixtures.length} - run pull-fixtures.mjs first`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const order = shuffled(fixtures, SEED);
const key = [];
order.forEach((fx, i) => {
  const n = String(i + 1).padStart(2, '0');
  const tf = fx.interval === 'D' ? '1 day' : fx.interval === '240' ? '4 hour'
    : fx.interval === '60' ? '1 hour' : `${fx.interval} minute`;
  writeFileSync(new URL(`chart-${n}.svg`, OUT), svg(fx.candles, `Chart ${i + 1}  ·  ${tf} candles`));
  key.push({
    chart: `chart-${n}.svg`,
    fixtureId: fx.id,
    ourVerdict: fx.group === 'A' ? 'structure' : fx.group === 'B' ? 'noise' : 'ordinary',
    group: fx.group,
    z: fx.classifier.z,
    symbol: fx.symbol,
    interval: fx.interval,
  });
});

/* The question sheet he actually fills in. One line per chart, nothing of ours on it. */
writeFileSync(new URL('QUESTIONS.md', OUT), [
  '# Twelve charts — would you draw something here?',
  '',
  'Open each `chart-NN.svg` in a browser. For each one, answer in one word:',
  '',
  '- **structure** — there is a line, channel or level here you would actually draw',
  '- **noise** — nothing here you would draw',
  '- **maybe** — borderline',
  '',
  'Each chart says its timeframe, because a shape worth drawing on a daily is not worth drawing on',
  'a 15m - your point, and the first version of this wrongly hid it. The coin is still not shown.',
  '',
  'Nothing else is needed. The coin, the timeframe and our own answer are deliberately not shown,',
  'because seeing them would make this a question about agreeing with us rather than about the chart.',
  '',
  ...order.map((_, i) => `${i + 1}. chart-${String(i + 1).padStart(2, '0')}.svg  →  `),
  '',
  '---',
  '',
  'Our answers are in `ANSWER-KEY.json`, which should stay unopened until yours are written down.',
].join('\n'));

writeFileSync(new URL('ANSWER-KEY.json', OUT), JSON.stringify({
  note: 'DO NOT SHOW WITH THE CHARTS. Record his answers first; a page where both appear together '
      + 'invites the reading that he saw ours first.',
  seed: SEED,
  ourCounts: { structure: key.filter(k => k.group === 'A').length,
               ordinary: key.filter(k => k.group === 'C').length,
               noise: key.filter(k => k.group === 'B').length },
  key,
}, null, 1));

console.log(`wrote 12 charts + QUESTIONS.md + ANSWER-KEY.json to scripts/bakeoff/blind-charts/`);
console.log('order is seeded, so the key stays valid on a re-render');
const leak = key.filter(k => k.chart.includes(k.group) || /[ABC]-/.test(k.chart));
console.log(`filenames leaking a group letter: ${leak.length} (must be 0)`);
