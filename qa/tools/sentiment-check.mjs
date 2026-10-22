// Extract getBtcSentiment (and its matchers) from app/news/page.tsx at two SHAs
// and run both on a fixed headline list. Read-only: uses `git show`.
import { execFileSync } from 'node:child_process';

const repo = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const shas = process.argv.slice(2);
const headlines = [
  'Celsius files for bankruptcy',
  'FTX bankruptcy court rules',
  'Bank run hits exchange',
  'SEC warns on crypto',
  'Warner Bros launches NFT',
  'Bank of America raises target',
  'Bitcoin rewards program',
  'War in region escalates',
  'Bans on crypto ads lifted',
  'Death cross forms',
];

function load(sha) {
  const src = execFileSync('git', ['-C', repo, 'show', `${sha}:app/news/page.tsx`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const startMarker = src.indexOf('/* ── BTC sentiment from headline keywords ── */');
  if (startMarker < 0) throw new Error(`${sha}: start marker not found`);
  const fnStart = src.indexOf('function getBtcSentiment', startMarker);
  if (fnStart < 0) throw new Error(`${sha}: getBtcSentiment not found`);
  // end of function: first "\n}\n" after fnStart
  const fnEnd = src.indexOf('\n}\n', fnStart) + 3;
  let chunk = src.slice(startMarker, fnEnd);
  // strip TS-only syntax used in this block
  chunk = chunk
    .replace(/^type BtcSentiment[^\n]*\n/m, '')
    .replace(/\(kws: readonly string\[\]\)/g, '(kws)')
    .replace(/\(s: string\)/g, '(s)')
    .replace(/\(headline: string\): BtcSentiment/g, '(headline)')
    .replace(/: BtcSentiment/g, '');
  // positive control: the extracted chunk must define the function and at least one matcher
  if (!/function getBtcSentiment/.test(chunk)) throw new Error('extraction lost the function');
  const fn = new Function(`${chunk}\nreturn getBtcSentiment;`)();
  return fn;
}

const fns = shas.map((s) => [s, load(s)]);
// positive control: a headline that must be bearish on both
for (const [s, f] of fns) {
  if (f('Bitcoin crashes 10%') !== 'bearish') throw new Error(`${s}: control failed`);
  if (f('Bitcoin rally continues') !== 'bullish') throw new Error(`${s}: bullish control failed`);
}
console.log(['headline', ...shas].join(' | '));
for (const h of headlines) console.log([h, ...fns.map(([, f]) => f(h))].join(' | '));
