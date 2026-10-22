/* Builds side-by-side pair images (A | B) and an index.html from two runs of shots-layout-pairs.mjs, plus a
 * geometry table from their log.json files. Local files only; nothing is fetched.
 * usage: node compose-pairs.mjs <dirA> <labelA> <dirB> <labelB> <outDir>                                    */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';


const [dirA, labelA, dirB, labelB, OUT] = process.argv.slice(2);
mkdirSync(path.join(OUT, 'pairs'), { recursive: true });
const shots = (d) => new Set(readdirSync(d).filter((f) => f.endsWith('.png')));
const A = shots(dirA), B = shots(dirB);
const names = [...new Set([...A, ...B])].sort();
const logA = JSON.parse(readFileSync(path.join(dirA, 'log.json'), 'utf8'));
const logB = JSON.parse(readFileSync(path.join(dirB, 'log.json'), 'utf8'));
const key = (r) => `${r.width}${r.page}`;
const geoA = new Map(logA.slice(1).map((r) => [key(r), r]));
const geoB = new Map(logB.slice(1).map((r) => [key(r), r]));
const box = (b) => (b ? `x${b.x} w${b.w}` : '-');

const rows = [];
for (const r of logB.slice(1)) {
  const a = geoA.get(key(r));
  rows.push({ page: r.page, width: r.width, hintA: a?.hintOnThisBuild ?? null, hintB: r.hintOnThisBuild, mainA: box(a?.geometry?.dashMain), mainB: box(r.geometry?.dashMain), rightA: box(a?.geometry?.dashRight), rightB: box(r.geometry?.dashRight), hintBoxB: r.geometry?.hint ? `x${r.geometry.hint.x} y${r.geometry.hint.y} w${r.geometry.hint.w}` : '-', docWA: a?.geometry?.docWidth, docWB: r.geometry?.docWidth });
}
writeFileSync(path.join(OUT, 'geometry.json'), JSON.stringify({ A: logA[0], B: logB[0], rows }, null, 1));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  for (const n of names) {
    /* data: URIs, not file:// - a page opened with setContent is about:blank and may not load local files. */
    const src = (d, set) => (set.has(n) ? `data:image/png;base64,${readFileSync(path.join(d, n)).toString('base64')}` : null);
    const a = src(dirA, A), b = src(dirB, B);
    const cell = (label, s) => `<div class="c"><div class="h">${label}</div>${s ? `<img src="${s}">` : '<div class="none">no shot on this build<br>(no hint to collapse)</div>'}</div>`;
    await page.setContent(`<!doctype html><html><head><style>body{margin:0;background:#1b1b1b;font:14px system-ui;color:#eee}.w{display:flex;gap:12px;padding:12px;align-items:flex-start}.c{flex:1;min-width:0}.h{padding:6px 8px;background:#333;margin-bottom:6px;font-weight:600}.c img{width:100%;display:block;border:1px solid #444}.t{padding:8px 12px 0;font-weight:700}.none{padding:40px;color:#999;border:1px dashed #555;text-align:center}</style></head><body><div class="t">${n}</div><div class="w">${cell(labelA, a)}${cell(labelB, b)}</div></body></html>`, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.screenshot({ path: path.join(OUT, 'pairs', n), fullPage: true });
  }
} finally { await browser.close(); }

const table = rows.map((r) => `<tr><td>${r.page}</td><td>${r.width}</td><td>${r.hintA}</td><td>${r.hintB}</td><td>${r.mainA}</td><td>${r.mainB}</td><td>${r.rightA}</td><td>${r.rightB}</td><td>${r.hintBoxB}</td><td>${r.docWA}/${r.docWB}</td></tr>`).join('');
const imgs = names.map((n) => `<h3>${n}</h3><img src="pairs/${n}" style="max-width:100%">`).join('');
writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Layout pairs</title><body style="background:#111;color:#eee;font:14px system-ui;padding:16px"><h1>Layout pairs: ${labelA} | ${labelB}</h1><p>A: ${JSON.stringify(logA[0])}<br>B: ${JSON.stringify(logB[0])}</p><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>page</th><th>width</th><th>hint A</th><th>hint B</th><th>dash-main A</th><th>dash-main B</th><th>rail A</th><th>rail B</th><th>hint box B</th><th>doc width A/B</th></tr>${table}</table>${imgs}</body>`);
console.log(`pairs: ${names.length}, geometry rows: ${rows.length} -> ${OUT}`);
