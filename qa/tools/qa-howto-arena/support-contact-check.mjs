/* #1550 / #1549: support contact visible in the footer, /contact, /terms, /privacy. 390 and 1280, dark and light.
 * Reads: the address text, its mailto href, sideways scroll (scrollWidth vs requested width), HTTP status, and a screenshot.
 * usage: node support-contact-check.mjs <qa|prod> <out.json> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'support-contact.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/support-contact`; mkdirSync(dir, { recursive: true });
const PAGES = ['/', '/contact', '/terms', '/privacy'];
const rows = [];
const READ = (w) => {
  const as = [...document.querySelectorAll('a[href^="mailto:"]')];
  const vis = as.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return { mailto: as.map((a) => a.getAttribute('href')), visibleText: vis.map((a) => (a.textContent || '').trim()), addressInBody: /support@liquidity-hq\.com/i.test(document.body.innerText), scrollWidth: document.documentElement.scrollWidth, requested: w, overflow: document.documentElement.scrollWidth > w, h1: document.querySelector('h1')?.textContent?.trim()?.slice(0, 60) ?? null };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit });
  for (const theme of ['dark', 'light']) for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: false, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    for (const path of PAGES) {
      try {
        const resp = await page.goto(B.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(2500);
        if (path === '/') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await sleep(500);
        const r = await page.evaluate(READ, w);
        const tag = `${bArg}-${path === '/' ? 'home' : path.slice(1)}-${theme}-${w}`;
        await page.screenshot({ path: `${dir}/${tag}.png`, fullPage: path !== '/' }).catch(() => {});
        rows.push({ step: 'case', path, theme, w, status: resp?.status(), ...r });
      } catch (e) { rows.push({ step: 'ERROR', path, theme, w, error: String(e.message).slice(0, 160) }); }
    }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows) console.log(r.step === 'case' ? `${r.path} ${r.theme} ${r.w} st=${r.status} body=${r.addressInBody} mailto=${JSON.stringify(r.mailto)} vis=${JSON.stringify(r.visibleText)} sw=${r.scrollWidth} overflow=${r.overflow}` : JSON.stringify(r));
