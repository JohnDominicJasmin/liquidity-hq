/* #1558: /upgrade as a Free viewer: reveal the plans, open each checkout panel (monthly, annual, every 2 weeks) and measure its height, sideways scroll
 * and the order of the "same email" note, the pay button and the checkout line. Equal height across plans is the claim. dark+light x 1280+390.
 * usage: node panel-heights.mjs <qa|prod> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = `${OUT}/panel-heights`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit);
  for (const theme of ['dark', 'light']) for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: true, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); const page = await ctx.newPage();
    await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3000);
    const reveal = page.locator('[data-testid="upgrade-reveal-plans"]'); if (await reveal.count()) { await reveal.click().catch(() => {}); await sleep(1200); }
    const out = [];
    for (const id of ['monthly', 'annual', 'fortnightly']) {
      await page.locator(`[data-testid="checkout-cta-${id}"]`).click({ timeout: 5000 }).catch(() => {}); await sleep(900);
      const m = await page.evaluate(() => { const p = document.querySelector('[data-testid="checkout-method-panel"]'); if (!p) return null; const t = (p.innerText || '').replace(/\s+/g, ' '); const iNote = t.search(/same email/i), iBtn = t.search(/pay with crypto/i), iLine = t.search(/network fees|never see or store/i); return { h: Math.round(p.getBoundingClientRect().height), sw: document.documentElement.scrollWidth, order: iNote >= 0 && iBtn > iNote && iLine > iBtn }; });
      out.push(`${id}: ${m ? `h=${m.h}px sw=${m.sw} order=${m.order}` : 'NO PANEL'}`);
      if (id === 'fortnightly') await page.screenshot({ path: `${dir}/${B.tag}-upgrade-panel-${theme}-${w}.png`, fullPage: true }).catch(() => {});
    }
    const hs = out.map((s) => Number((s.match(/h=(\d+)/) || [])[1])); console.log(`${theme} ${w}: ${out.join(' | ')} | equal heights=${hs.length === 3 && hs.every((h) => h === hs[0])}`); await ctx.close();
  }
} finally { await browser.close(); }
