// Loads getBtcSentiment from the PR head's app/news/page.tsx (source text, types stripped by regex)
// and compares it with the dev version, on headlines chosen to probe the boundary.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repo = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
function load(ref) {
  const src = execFileSync('git', ['show', `${ref}:app/news/page.tsx`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  const start = src.indexOf('type BtcSentiment');
  const endMarker = "return 'neutral';\n}";
  const end = src.indexOf(endMarker, start) + endMarker.length;
  let block = src.slice(start, end);
  block = block.replace(/type BtcSentiment[^\n]*\n/, '');
  block = block.replace(/\(s: string\)/g, '(s)');
  block = block.replace(/\(kws: readonly string\[\]\)/g, '(kws)');
  block = block.replace(/\(headline: string\): BtcSentiment/g, '(headline)');
  return new Function(`${block}\nreturn getBtcSentiment;`)();
}
const oldFn = load('origin/dev');
const newFn = load('qa-review-1501');
const cases = [
  'Bank of Japan holds rates steady', 'Fed moves toward a rate decision', 'New reward program launches',
  'Bitcoin banned in Nepal', 'Ban on mining expands', 'War escalates, markets fall',
  'Celsius files for bankruptcy', 'FTX bankruptcy court approves plan', 'Bank run hits exchange',
  'SEC warns investors about memecoins', 'Ethereum death cross forms', 'Bitcoin hits new ATH',
  'Bitcoin sets new ATHs', 'Software update ships', 'Senator voices disapproval of ETF',
  'Exchange bans US users', 'Nation banning crypto mining', 'Anti-war protests spread',
  'Trade war fears grow', 'Pumpkin spice token', 'Bitcoin price path to 100k', 'Athens hosts crypto summit',
];
for (const h of cases) {
  const o = oldFn(h), n = newFn(h);
  console.log(`${o === n ? '   ' : 'CHG'} old=${o.padEnd(8)} new=${n.padEnd(8)} ${h}`);
}
