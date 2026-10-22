/* #1640 step 0: which requests does each page make ON LOAD that the fence answers locally or refuses (app writes, Supabase writes, third-party hosts)?
 * One quick load per page and account at 1280 dark, writes OFF. Decides what the full sweep must let through so a fence answer is not mistaken for a page bug.
 * usage: node probe-writes.mjs [accts csv=A] [pages csv=all] */
import { chromium, open, quiet, sleep, BASE } from './rlib.mjs';
import { PAGES } from './pages.mjs';
const accts = (process.argv[2] || 'A').split(',');
const pages = process.argv[3] ? process.argv[3].split(',') : PAGES;
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  for (const acct of accts) for (const p of pages) {
    const rec = []; const ctx = await open(browser, { acct, w: 1280, rec }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    try { await page.goto(BASE + p, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 15_000); await sleep(1500); } catch (e) { console.log(acct, p, 'ERROR', String(e.message).slice(0, 80)); }
    const sum = {}; for (const n of rec) { const k = `${n.kind} ${n.m} ${n.url.replace(/\?.*$/, '')}`; sum[k] = (sum[k] || 0) + 1; }
    console.log(`${acct} ${p} -> ${page.url().replace(BASE, '')} | ${Object.entries(sum).map(([k, v]) => `${k}${v > 1 ? ' x' + v : ''}`).join(' | ') || '(nothing fenced)'}`);
    await ctx.close();
  }
} finally { await browser.close(); }
