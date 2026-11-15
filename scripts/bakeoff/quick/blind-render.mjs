#!/usr/bin/env node
/* Opens the encrypted blind-pairs file ON THE LOCAL MACHINE and writes the pick sheet (#1631). Usage:
 *
 *   node scripts/bakeoff/quick/blind-render.mjs <blind-pairs.enc.json> <private-key.pem> <out-dir>
 *
 * Writes <out-dir>/pick-sheet.md (the pairs, engine names hidden, A and B randomised PER PAIR with this machine's crypto RNG, every answer rendered through the same layout so formatting
 * does not give an engine away) and <out-dir>/key.json (which engine was A or B in each pair). KEEP key.json OFF GITHUB: it is the only thing that unblinds the sheet. Neither file belongs in
 * the repository. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [encPath, keyPath, outDir] = process.argv.slice(2);
if (!encPath || !keyPath || !outDir) { console.error('usage: blind-render.mjs <enc.json> <private.pem> <out-dir>'); process.exit(2); }
const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
const aesKey = crypto.privateDecrypt({ key: fs.readFileSync(keyPath, 'utf8'), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(enc.k, 'base64'));
const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(enc.iv, 'base64'));
decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
const bundle = JSON.parse(Buffer.concat([decipher.update(Buffer.from(enc.ct, 'base64')), decipher.final()]).toString('utf8'));

const fmtPrice = (p) => (Math.abs(p) >= 1 ? p.toFixed(2) : p.toFixed(4));
function renderAnswer(r) {
  const lines = [];
  lines.push(`**Signal:** ${r.signal}   **Confidence:** ${r.confidence}%`);
  if (r.reasoning) lines.push(`**Why:** ${r.reasoning.trim()}`);
  if (r.levels?.length) lines.push(`**Levels:** ${r.levels.map((l) => `${l.type === 'support' ? 'S' : 'R'} ${fmtPrice(l.price)} (${l.label})`).join(' | ')}`);
  if (r.chartAnalysis) lines.push(`**Chart:** ${r.chartAnalysis.trim()}`);
  if (r.patterns?.length) lines.push(`**Patterns:** ${r.patterns.join('; ')}`);
  if (r.catalysts?.length) lines.push(`**Catalysts:** ${r.catalysts.join('; ')}`);
  if (r.bias) lines.push(`**Lean:** ${r.bias}`);
  if (r.waitFor) lines.push(`**Wait for:** ${r.waitFor.trim()}`);
  if (r.raidSetup) lines.push(`**Liquidity raid:** ${r.raidSetup}${r.raidTarget ? ` toward ${r.raidTarget}` : ''}${r.raidTrigger ? `; trigger: ${r.raidTrigger}` : ''}`);
  return lines.join('\n\n');
}

const key = [];
const parts = [];
parts.push('# Quick-read pick sheet\n');
parts.push(`${bundle.items.length} market situations. Each was given to two AI engines with the SAME numbers; the engines are hidden and their order is random in every pair. For each pair, mark the answer you would rather get as a trader (A, B, or no difference), and say why in a few words if you can. Nothing here is a trade recommendation: these are made-up market numbers.\n`);
for (const it of bundle.items) {
  const aIsGrok = crypto.randomInt(0, 2) === 0;
  const A = aIsGrok ? it.grok : it.haiku;
  const B = aIsGrok ? it.haiku : it.grok;
  key.push({ pair: it.i, A: aIsGrok ? bundle.engines.a : bundle.engines.b, B: aIsGrok ? bundle.engines.b : bundle.engines.a });
  const c = it.ctx;
  parts.push(`\n---\n\n## Pair ${it.i}: ${c.coin}\n`);
  parts.push(`**The numbers both engines were given:** price ${c.price} (${c.change24h} in 24h) | ${c.priceVsMA} | RSI ${c.rsi14}; 1h ${c.rsi1h}, 4h ${c.rsi4h}, daily ${c.rsiDaily} | volume ${c.volRatio} | long/short ${c.longShortRatio} | taker flow ${c.takerRatio} | VWAP ${c.vwap} | ${c.orderWalls} | ${c.liqLevels}\n`);
  parts.push(`### Answer A\n\n${renderAnswer(A.parsed)}\n`);
  parts.push(`### Answer B\n\n${renderAnswer(B.parsed)}\n`);
  parts.push(`**Your pick:** [ ] A   [ ] B   [ ] no difference     **Why (optional):** ________________\n`);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pick-sheet.md'), parts.join('\n'));
fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify({ made: bundle.made, key }, null, 2));
console.log(`wrote ${bundle.items.length} pairs to ${outDir} (pick-sheet.md, key.json)`);
