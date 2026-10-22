/* Arabic /upgrade on prod: what the page says about the Pro price, and what the Arabic checkout button label reads (labels API, read only).
 * With payments off the page renders no plan buttons, so the button label itself is read from the public labels API.
 * usage: node ar-upgrade.mjs <qa|prod> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = `${OUT}/payments-off/${B.tag}`; mkdirSync(dir, { recursive: true });
const lab = await (await fetch(`${B.base}/api/labels?locale=ar`)).json().catch(() => ({})); const L = lab.labels || lab;
console.log('labels API (ar): PRICE_MONTHLY =', JSON.stringify(L.UPGRADE_PRICE_MONTHLY), '| PRICE_ANNUAL =', JSON.stringify(L.UPGRADE_PRICE_ANNUAL), '| CHECKOUT_BUTTON_CTA =', JSON.stringify(L.UPGRADE_CHECKOUT_BUTTON_CTA));
const browser = await chromium.launch();
try {
  for (const [theme, w] of [['dark', 1280], ['light', 390]]) {
    const ctx = await open(browser, { b: B, w, theme, lang: 'ar', signedIn: true, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); const page = await ctx.newPage();
    await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3500);
    const t = await page.evaluate(() => ({ dir: document.documentElement.getAttribute('dir'), lang: document.documentElement.getAttribute('lang'), body: document.body.innerText.replace(/\s+/g, ' ') }));
    const prices = [...new Set(t.body.match(/\d+\s?\$|\$\s?\d+|\d+\s?دولار\w*/g) || [])];
    console.log(`${theme} ${w}: dir=${t.dir} lang=${t.lang} prices on page: ${JSON.stringify(prices)} | has "launching soon" text: ${/قريب|launching soon/i.test(t.body)} | plan buttons: ${await page.locator('[data-testid^="checkout-cta"]').count()}`);
    await page.screenshot({ path: `${dir}/upgrade-ar-${theme}-${w}.png`, fullPage: true }).catch(() => {}); await ctx.close();
  }
} finally { await browser.close(); }
