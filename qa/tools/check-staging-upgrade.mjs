import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
try {
  for (const host of ['https://liquidity-hq-staging.onrender.com', 'https://liquidity-hq-qa.onrender.com']) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
    await page.goto(host + '/upgrade', { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => /\$0/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ planButtons: [...document.querySelectorAll('[data-testid^="checkout-cta-"]')].map((b) => b.getAttribute('data-testid')), soon: /launching soon|coming soon/i.test(document.body.innerText), freeCard: /\$0/.test(document.body.innerText) }));
    if (host.includes('staging')) await page.screenshot({ path: './upgrade-qa-c67a61b/07-staging-signed-out-coming-soon.png' });
    console.log(JSON.stringify({ host, ...r, errors }));
  }
} finally { await browser.close(); }
