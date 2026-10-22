/* #1468 on the deployed site: where does "Upgrade" on a locked feature send a Free user?
 * Synthetic Free session (no sign-in), reads answered in the browser, no database writes.
 * Any request to a Lemon Squeezy or BoomFi host is answered locally and recorded - nothing reaches a store.
 * staging (old build, Lemon Squeezy link still set) is the CONTROL: it should still show the bug. */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const HOSTS = process.argv.slice(2);
const browser = await chromium.launch();
try {
  for (const host of HOSTS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([v]) => { localStorage.setItem('sb-wdtjhrilakoitfcezxpx-auth-token', v); localStorage.setItem('theme', 'dark'); }, [session]);
    const page = await ctx.newPage();
    const stores = [];
    await page.route(/lemonsqueezy|boomfi/i, (r) => { stores.push(r.request().url().slice(0, 90)); return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stand-in</title>QA stand-in. The real store page was not loaded.' }); });
    await page.route('**/auth/v1/token*', (r) => r.abort('failed'));
    const row = (r, o) => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    await page.route('**/rest/v1/*user_onboarding*', (r) => row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true }));
    await page.route('**/rest/v1/*user_subscriptions*', (r) => row(r, { user_id: UID, role: 'free', trial_ends_at: null }));
    await page.route('**/rest/v1/*user_settings*', (r) => row(r, { user_id: UID, risk_pct: 1, default_coin: 'BTC', default_tf: '1h', watchlist: [], field_updated_at: {} }));
    await page.route('**/api/settings', (r) => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":[],"rejected":[],"settings":{}}' }));
    const version = await (await ctx.request.get(host + '/api/version')).json();
    await page.goto(host + '/alerts', { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
    const decline = page.getByRole('button', { name: 'Decline' });
    await page.waitForTimeout(1500);
    if (await decline.isVisible().catch(() => false)) await decline.click();
    // The locked card's own button opens the prompt.
    const opener = page.locator('button', { hasText: /upgrade|unlock/i }).first();
    const openerText = await opener.innerText({ timeout: 30_000 }).catch(() => null);
    const out = { host, commit: version.commit, lsCheckoutFlag: version.configured?.checkout, proBuyableFlag: version.configured?.proBuyable, lockedCardButton: openerText };
    if (openerText) {
      await opener.click();
      const dialog = page.locator('[role="dialog"][aria-modal="true"]');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      out.promptLinks = await dialog.locator('a[href]').evaluateAll((as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
      const cta = dialog.locator('a', { hasText: 'Upgrade to Pro' }).first();
      out.ctaHref = await cta.getAttribute('href').catch(() => null);
      await page.screenshot({ path: `./upgrade-qa-c67a61b/08-locked-card-prompt-${new URL(host).host.split('.')[0]}.png` });
      await cta.click();
      await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      out.landedOn = page.url().length > 120 ? page.url().slice(0, 120) + '...' : page.url();
    }
    out.storeRequestsAnsweredLocally = stores;
    console.log(JSON.stringify(out));
    await ctx.close();
  }
} finally { await browser.close(); }
