/* Release-candidate overflow + load check: /settings and /upgrade at 390 and 1280, dark and light, signed-in Free and Pro (plan stubbed).
 * Reads scrollWidth against the requested width on every page (not innerWidth), HTTP status, and a screenshot.
 * usage: QA_BASE=<url> QA_TAG=<tag> node overflow-rc.mjs qa <out.json> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'overflow-rc.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/overflow-rc`; mkdirSync(dir, { recursive: true });
const rows = [];
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit });
  for (const plan of ['free', 'pro']) for (const theme of ['dark', 'light']) for (const w of [390, 1280]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: true, plan, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    for (const path of ['/settings', '/upgrade']) {
      try {
        const resp = await page.goto(B.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3000);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map((e) => `${e.tagName}.${(e.className || '').toString().slice(0, 40)}`) }));
        await page.screenshot({ path: `${dir}/${B.tag}-${plan}-${path.slice(1)}-${theme}-${w}.png`, fullPage: true }).catch(() => {});
        rows.push({ step: 'case', plan, theme, w, path, status: resp?.status(), scrollWidth: m.sw, bodyScroll: m.bw, overflow: m.sw > w, wide: m.wide });
      } catch (e) { rows.push({ step: 'ERROR', plan, theme, w, path, error: String(e.message).slice(0, 160) }); }
    }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows) console.log(r.step === 'case' ? `${r.plan} ${r.theme} ${r.w} ${r.path} st=${r.status} sw=${r.scrollWidth} overflow=${r.overflow} ${r.overflow ? JSON.stringify(r.wide) : ''}` : JSON.stringify(r));
