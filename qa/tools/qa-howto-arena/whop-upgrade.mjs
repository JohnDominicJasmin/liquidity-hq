/* PR #1587 / #1567 Phase 2: /upgrade with the Whop links SET. Per viewer (signed out, Free), theme and width: the page, the plan buttons after the reveal,
 * and for each plan the "Complete your purchase" panel. "Pay with Whop" IS pressed for each plan, but the fence aborts every non-app request, so whop.com is
 * never contacted: the aborted URL is recorded to show which plan button leads to which Whop link. Nothing is paid, nothing is loaded from Whop.
 * Free viewer = synthetic session (fake token, Free plan row answered locally). usage: node whop-upgrade.mjs <qa|prod> [out-dir]            */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = process.argv[3] || `${OUT}/whop-upgrade/${B.tag}`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, 'proBuyable', v.configured?.proBuyable, 'whop', v.configured?.whopCheckout, v.configured?.whopCheckoutAnnual, v.configured?.whopCheckoutFortnightly);
  for (const [viewer, theme, w] of [['signed-out', 'dark', 1280], ['signed-out', 'dark', 390], ['free', 'dark', 1280], ['free', 'light', 1280], ['free', 'dark', 390], ['free', 'light', 390]]) {
    const tag = `${viewer}-${w === 390 ? 'mobile' : 'desktop'}${theme === 'light' ? '-light' : ''}`;
    for (const plan of viewer === 'signed-out' ? [null] : ['monthly', 'annual', 'fortnightly']) {
      const ctx = await open(browser, { b: B, w, theme, signedIn: viewer !== 'signed-out', plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
      const page = await ctx.newPage(); const aborted = [];
      page.on('requestfailed', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) aborted.push(r.url()); });
      try {
        await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3500);
        if (plan === null) {
          const info = await page.evaluate(() => ({ path: location.pathname, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600), btns: [...document.querySelectorAll('main button, main a')].map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 8), scroll: [document.documentElement.scrollWidth, innerWidth] }));
          console.log(`${tag}: path=${info.path} buttons=${JSON.stringify(info.btns)} scrollW/innerW=${info.scroll.join('/')}`);
          await page.screenshot({ path: `${dir}/whop-${tag}-1-page.png`, fullPage: true }); await ctx.close(); continue;
        }
        if (plan === 'monthly') await page.screenshot({ path: `${dir}/whop-${tag}-1-page.png`, fullPage: true });
        const reveal = page.getByTestId('upgrade-reveal-plans'); if (await reveal.count()) { await reveal.click(); await sleep(900); }
        const counts = { monthly: await page.getByTestId('checkout-cta-monthly').count(), annual: await page.getByTestId('checkout-cta-annual').count(), fortnightly: await page.getByTestId('checkout-cta-fortnightly').count() };
        if (plan === 'monthly') await page.screenshot({ path: `${dir}/whop-${tag}-2-plans.png`, fullPage: true });
        if (!counts.monthly) { console.log(`${tag}: NO plan buttons (links unset in this build)`); await ctx.close(); continue; }
        await page.getByTestId(`checkout-cta-${plan}`).click({ timeout: 8000 }).catch((e) => console.log('click fail', plan, String(e.message).slice(0, 80))); await sleep(1200);
        const panel = page.getByTestId('checkout-method-panel');
        const txt = await panel.innerText().catch(() => '(no panel)');
        await panel.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await sleep(500);
        const sc = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        await page.screenshot({ path: `${dir}/whop-${tag}-3-panel-${plan}.png`, fullPage: false });
        const pay = page.getByTestId('checkout-method-whop'); const hasPay = await pay.count();
        if (hasPay) { await pay.click({ timeout: 5000 }).catch(() => {}); await sleep(1500); }
        console.log(`${tag} ${plan}: buttons=${JSON.stringify(counts)} panel="${txt.replace(/\s+/g, ' ').slice(0, 200)}" scrollW/innerW=${sc.join('/')} | Pay-with-Whop buttons=${hasPay} | aborted nav=${JSON.stringify(aborted.map((u) => u.replace(/\?.*$/, '')))}`);
      } catch (e) { console.log(tag, plan, 'ERROR', String(e.message).slice(0, 120)); }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
