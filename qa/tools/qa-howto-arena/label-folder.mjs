/* Copy the #1578 loading-label screenshots into the owner's folder with clear names and report any image that looks empty.
 * Name: arena-btc-<n>-<state>-<shot>-<desktop|mobile>[-light]-<before|after>.png  (dark = no suffix). Copies only. */
import { readFileSync, copyFileSync, mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { OUT } from './lib.mjs';
const SRC = `${OUT}/loading-label`.split('\\').join('/'); const DEST = 'C:/Users/Dominic/Documents/LiquidityHQ-QA-1578'; mkdirSync(DEST, { recursive: true });
const STATES = [['fast', 1], ['slow', 2], ['offline', 3], ['rapid', 4]]; const SETS = [['before-3f021a5', 'before'], ['after-a4c2cd7', 'after']];
const report = []; let copied = 0;
for (const [state, n] of STATES) for (const [setDir, ba] of SETS) {
  const rows = JSON.parse(readFileSync(`${SRC}/${setDir}/${state}.json`, 'utf8')).filter((r) => r.kind === 'shot' && !r.name.startsWith('0-'));
  for (const r of rows) {
    const from = `${SRC}/${setDir}/${state}-${r.theme}-${r.w}-${r.name}.png`; if (!existsSync(from)) { report.push(`MISSING ${from}`); continue; }
    const to = `${DEST}/arena-btc-${n}-${state}-${r.name}-${r.w === 390 ? 'mobile' : 'desktop'}${r.theme === 'light' ? '-light' : ''}-${ba}.png`;
    copyFileSync(from, to); copied++;
    const offlineEmpty = state === 'offline' && r.name.includes('offline'); // chart legitimately has no candles, the banner shows
    const bad = (!offlineEmpty && r.bars < 100) || statSync(to).size < 5000 || (offlineEmpty && !r.banner);
    if (bad) report.push(`CHECK ${to.split('/').pop()}: bars=${r.bars} banner=${r.banner} kb=${r.kb}`);
  }
}
console.log(`copied ${copied}`); console.log(report.length ? report.join('\n') : 'no image flagged empty');
