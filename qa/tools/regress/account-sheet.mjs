/* One sheet for ONE account across many pages (rows = pages; columns = 1280 dark, 1280 light, 390 dark, 390 light), for reviewing a column the
 * per-page sheets showed as missing at first. usage: node account-sheet.mjs <acct> <out-name> <pages csv> */
import { chromium, ROOT, slug } from './rlib.mjs';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
const [, , acct = 'A', name = 'A-sheet', pagesArg = ''] = process.argv;
const pages = pagesArg.split(',').filter(Boolean);
const COLS = [['1280', 'dark', 330], ['1280', 'light', 330], ['390', 'dark', 125], ['390', 'light', 125]];
mkdirSync(`${ROOT}/_sweep/sheets`, { recursive: true });
const cell = (s, w, t, px) => { const f = `../../${s}/${acct}-${w}-${t}.jpg`; return existsSync(`${ROOT}/${s}/${acct}-${w}-${t}.jpg`) ? `<td><img src="${f}" style="width:${px}px"></td>` : `<td style="width:${px}px;background:#888;color:#fff;font:11px sans-serif;text-align:center">MISSING</td>`; };
const html = `<!doctype html><meta charset="utf-8"><body style="margin:6px;background:#fff;font:12px sans-serif"><b>${acct} - #1640 sweep, qa</b><table cellpadding="2" style="border-collapse:collapse"><tr><th></th>${COLS.map(([w, t]) => `<th>${w} ${t}</th>`).join('')}</tr>${pages.map((p) => `<tr style="vertical-align:top"><th style="text-align:left;width:80px">${p}</th>${COLS.map(([w, t, px]) => cell(slug(p), w, t, px)).join('')}</tr>`).join('')}</table></body>`;
const file = `${ROOT}/_sweep/sheets/${name}.html`; writeFileSync(file, html);
const browser = await chromium.launch();
try { const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); await page.goto('file:///' + file.replace(/ /g, '%20')); await page.waitForLoadState('load'); await page.screenshot({ path: `${ROOT}/_sweep/sheets/${name}.jpg`, type: 'jpeg', quality: 72, fullPage: true }); console.log('ok', name); }
finally { await browser.close(); }
