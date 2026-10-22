/* Control for the #1640 light photos: a FRESH load that starts in light (localStorage theme=light before any script runs), signed out, 1280,
 * for pages whose in-page light switch looked dark. Prints the html data-theme, the body background, and saves a photo. usage: node light-control.mjs <paths csv> */
import { chromium, open, quiet, sleep, BASE, ROOT, slug } from './rlib.mjs';
import { mkdirSync } from 'node:fs';
const paths = (process.argv[2] || '/learn').split(',');
const browser = await chromium.launch();
try {
  for (const p of paths) {
    const ctx = await open(browser, { acct: 'anon', w: 1280, theme: 'light' }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    await page.goto(BASE + p, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1000);
    const st = await page.evaluate(() => { const bg = (el) => getComputedStyle(el).backgroundColor; const main = document.querySelector('main') || document.body; return { dataTheme: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('theme'), bodyBg: bg(document.body), mainBg: bg(main), firstBlockBg: bg(main.firstElementChild || main) }; });
    const dir = `${ROOT}/${slug(p)}`; mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/control-anon-1280-light-freshload.jpg`, type: 'jpeg', quality: 70 });
    console.log(p, JSON.stringify(st));
    await ctx.close();
  }
} finally { await browser.close(); }
