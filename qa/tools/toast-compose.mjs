/* Compose the toast pairs: one HTML sheet per page+state+theme, rows = widths, columns = A | B, each cell captioned with
 * the measured overlap (FAB / tab bar / top bar / hint) and the dismiss time. Rendered to PNG with Playwright by
 * navigating to the file (relative <img> paths load; setContent would not).
 * usage: node toast-compose.mjs <pairsDir>                                                                       */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const DIR = process.argv[2];
const rows = JSON.parse(readFileSync(`${DIR}/overlap.json`, 'utf8'));
const builds = [...new Set(rows.map((r) => r.build))];
const key = (r) => `${r.page.slice(1)}-${r.state}-${r.theme}`;
const groups = [...new Set(rows.map(key))];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const cap = (r) => {
  if (!r || !r.toast) return '<b>no toast captured</b>';
  const d = r.dismiss || {};
  const dis = r.state === 'error' ? (d.presentAt8s ? 'still up at 8s (correct: waits for action)' : `GONE after ${d.goneAfterMs}ms (wrong)`) : (d.goneAfterMs != null ? `dismissed after ${d.goneAfterMs}ms` : `<b>still up at 8s: ${esc(d.textAt8s)}</b>`);
  return `"${esc(r.toastText)}" role=${r.toastRole} · toast ${r.toast.x},${r.toast.y} ${r.toast.w}×${r.toast.h}<br>overlap px² FAB <b>${r.overlapFabPx2}</b> · tab bar <b>${r.overlapBarPx2}</b> · top bar <b>${r.overlapTopPx2}</b> · hint ${r.overlapHintPx2} · title ${r.overlapTitlePx2}<br>${dis}`;
};
mkdirSync(`${DIR}/sheets`, { recursive: true });
const sheets = [];
for (const g of groups) {
  const widths = [...new Set(rows.filter((r) => key(r) === g).map((r) => r.width))].sort((a, b) => a - b);
  let html = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;background:#fff;color:#111;margin:12px}table{border-collapse:collapse}td{vertical-align:top;padding:6px;border:1px solid #ccc}img{max-width:560px;display:block}h1{font-size:16px}</style><h1>${esc(g)} — ${builds.map((b) => esc(b) + ' ' + esc(rows.find((r) => r.build === b)?.commit)).join(' | ')}</h1><table><tr><th>width</th>${builds.map((b) => `<th>${esc(b)}</th>`).join('')}</tr>`;
  for (const w of widths) {
    html += `<tr><td>${w}</td>`;
    for (const b of builds) {
      const r = rows.find((x) => key(x) === g && x.width === w && x.build === b);
      const png = `${g}-${String(w).padStart(4, '0')}--${b}.png`;
      html += `<td>${existsSync(`${DIR}/${png}`) ? `<img src="../${png}">` : '(no screenshot)'}<div>${cap(r)}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  writeFileSync(`${DIR}/sheets/${g}.html`, html);
  sheets.push(g);
}
writeFileSync(`${DIR}/sheets/index.html`, `<!doctype html><meta charset="utf-8"><h1>Toast pairs</h1><ul>${sheets.map((g) => `<li><a href="${g}.html">${g}</a> (<a href="${g}.png">png</a>)</li>`).join('')}</ul>`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  for (const g of sheets) { await page.goto(pathToFileURL(`${DIR}/sheets/${g}.html`).href); await page.waitForLoadState('load'); await page.screenshot({ path: `${DIR}/sheets/${g}.png`, fullPage: true }); }
} finally { await browser.close(); }
console.log(`${sheets.length} sheets in ${DIR}/sheets`);
