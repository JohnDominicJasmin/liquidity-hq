/* One contact sheet per page folder of the #1640 sweep, so every photo is actually looked at: rows = signed out, Free, trial, Pro; columns = 1280 dark,
 * 1280 light, 390 dark, 390 light (viewport photos). Writes <page>/_sheet.html and <page>/_sheet.jpg. A missing photo shows as a grey box labelled MISSING.
 * usage: node contact-sheet.mjs [pages csv=all]                                                                                                            */
import { chromium, ROOT, slug } from './rlib.mjs';
import { PAGES } from './pages.mjs';
import { writeFileSync, existsSync } from 'node:fs';
const pages = process.argv[2] ? process.argv[2].split(',') : PAGES;
const ACCTS = [['anon', 'signed out'], ['B', 'Free (B)'], ['T', 'trial (T)'], ['A', 'Pro (A)']];
const COLS = [['1280', 'dark', 400], ['1280', 'light', 400], ['390', 'dark', 150], ['390', 'light', 150]];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  for (const p of pages) {
    const s = slug(p); const dir = `${ROOT}/${s}`; if (!existsSync(dir)) { console.log('no folder', s); continue; }
    const cell = (a, w, t, px) => { const f = `${a}-${w}-${t}.jpg`; return existsSync(`${dir}/${f}`) ? `<td><img src="${f}" style="width:${px}px"></td>` : `<td><div style="width:${px}px;height:120px;background:#888;color:#fff;font:12px sans-serif;display:flex;align-items:center;justify-content:center">MISSING</div></td>`; };
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:8px;background:#fff;font:13px sans-serif"><h3 style="margin:4px 0">${p} — #1640 sweep, qa</h3><table style="border-collapse:collapse" cellpadding="3"><tr><th></th>${COLS.map(([w, t]) => `<th>${w} ${t}</th>`).join('')}</tr>${ACCTS.map(([a, n]) => `<tr style="vertical-align:top"><th style="text-align:left;width:70px">${n}</th>${COLS.map(([w, t, px]) => cell(a, w, t, px)).join('')}</tr>`).join('')}</table></body>`;
    writeFileSync(`${dir}/_sheet.html`, html);
    await page.goto('file:///' + `${dir}/_sheet.html`.replace(/ /g, '%20'));
    await page.waitForLoadState('load');
    await page.screenshot({ path: `${dir}/_sheet.jpg`, type: 'jpeg', quality: 75, fullPage: true });
    console.log('sheet', s);
  }
} finally { await browser.close(); }
