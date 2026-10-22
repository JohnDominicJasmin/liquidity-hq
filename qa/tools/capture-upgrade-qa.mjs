/* Rendered /upgrade check on the deployed qa site (#861 Phase 1, build c67a61b).
 *
 * NO SIGN-IN, NO CREDENTIALS. The "signed-in" views use a fabricated, unexpired session blob in
 * localStorage (same technique as the earlier captures): the app believes someone is signed in,
 * Supabase itself would reject the token. The three reads the page needs to leave its loading state
 * (onboarding, subscription, settings) are answered by page.route() with hand-written rows, and
 * every write to those tables is answered locally too, so nothing is written to the dev database.
 *
 * NO REQUEST REACHES BOOMFI. pay.boomfi.xyz is intercepted and answered with a local stand-in page,
 * so "Pay with Crypto" can be clicked and the address it navigates to can be read, without loading
 * a live payment page. Nothing is paid and no wallet is involved.
 *
 * Usage: node capture-upgrade-qa.mjs <outDir>
 */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://liquidity-hq-qa.onrender.com';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const REF = 'wdtjhrilakoitfcezxpx'; // qa runs on the dev Supabase project
const FAKE_UID = '00000000-0000-4000-8000-00000000fa4e';
const PLANS = ['monthly', 'fortnightly', 'annual'];
const log = [];
const note = (o) => { log.push(o); console.log(JSON.stringify(o)); };

function fakeSession() {
  const future = Math.floor(Date.now() / 1000) + 3600;
  return JSON.stringify({
    access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token',
    expires_in: 3600, expires_at: future, token_type: 'bearer',
    user: { id: FAKE_UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  });
}
const rowFor = (req, row) => ({ status: 200, contentType: 'application/json', body: JSON.stringify((req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? row : [row]) });

async function context(browser, { signedIn, mobile, theme }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  await ctx.addInitScript(([k, v, t]) => {
    if (v) localStorage.setItem(k, v);
    localStorage.setItem('theme', t);
  }, [`sb-${REF}-auth-token`, signedIn ? fakeSession() : null, theme]);
  const page = await ctx.newPage();
  const boomfi = [];
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  await page.route('**/auth/v1/token*', (r) => r.abort('failed'));
  await page.route(/pay\.boomfi\.xyz/, (r) => {
    boomfi.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in</title><body style="font:16px sans-serif;padding:40px">QA stand-in for the BoomFi page. The real page was not loaded.</body>' });
  });
  if (signedIn) {
    const writes = [];
    const table = (pattern, row) => page.route(pattern, (r) => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill(rowFor(req, row));
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await table('**/rest/v1/*user_onboarding*', { user_id: FAKE_UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
    await table('**/rest/v1/*user_subscriptions*', { user_id: FAKE_UID, role: 'free', trial_ends_at: null });
    await table('**/rest/v1/*user_settings*', { user_id: FAKE_UID, risk_pct: 1, default_coin: 'BTC', default_tf: '1h', watchlist: [], field_updated_at: {} });
    await page.route('**/api/settings', (r) => {
      if (r.request().method() === 'GET') return r.continue();
      writes.push(r.request().method() + ' /api/settings');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: [], settings: {} }) });
    });
    page.__writes = writes;
  }
  return { ctx, page, boomfi, pageErrors };
}

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  const decline = page.getByRole('button', { name: 'Decline' });
  await page.waitForTimeout(800);
  if (await decline.isVisible().catch(() => false)) await decline.click();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('.st-save-toast'), null, { timeout: 12_000 }).catch(() => {});
}
const centre = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="checkout-cta-"]')].map((b) => ({ id: b.getAttribute('data-testid'), text: b.textContent.trim(), disabled: b.disabled })));
const overflow = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
const pageText = (page) => page.evaluate(() => document.body.innerText);

const browser = await chromium.launch();
try {
  /* ── A. signed out, desktop dark ── */
  {
    const { ctx, page, boomfi, pageErrors } = await context(browser, { signedIn: false, mobile: false, theme: 'dark' });
    await page.goto(`${BASE}/upgrade`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('[data-testid="checkout-cta-monthly"]', { timeout: 60_000 });
    await settle(page);
    const text = await pageText(page);
    note({ view: 'signed-out 1440 dark', buttons: await buttons(page), instantAccessShown: /instant access/i.test(text), cancelAnytimeShown: /cancel anytime/i.test(text), secureCheckoutShown: /secure checkout/i.test(text), comingSoon: /launching soon|coming soon/i.test(text), overflow: await overflow(page) });
    await page.locator('[data-testid="checkout-cta-monthly"]').scrollIntoViewIfNeeded();
    await shot(page, '01-signed-out-1440-dark');
    await page.locator('[data-testid="checkout-cta-monthly"]').click();
    await page.waitForURL(/\/login/, { timeout: 30_000 }).catch(() => {});
    note({ view: 'signed-out click monthly', landedOn: page.url().replace(BASE, ''), panelShown: await page.locator('[data-testid="checkout-method-panel"]').count(), boomfiRequests: boomfi.length, pageErrors });
    await ctx.close();
  }

  /* ── B. synthetic signed-in, desktop dark: every plan, the link, and Back ── */
  {
    const { ctx, page, boomfi, pageErrors } = await context(browser, { signedIn: true, mobile: false, theme: 'dark' });
    await page.goto(`${BASE}/upgrade`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('[data-testid="checkout-cta-monthly"]', { timeout: 60_000 });
    await settle(page);
    note({ view: 'signed-in 1440 dark', url: page.url().replace(BASE, ''), buttons: await buttons(page), panelBeforeAnyClick: await page.locator('[data-testid="checkout-method-panel"]').count() });
    await page.locator('[data-testid="checkout-cta-monthly"]').scrollIntoViewIfNeeded();
    await shot(page, '02-signed-in-1440-dark-before-click');
    for (const plan of PLANS) {
      await page.locator(`[data-testid="checkout-cta-${plan}"]`).click();
      const panel = page.locator('[data-testid="checkout-method-panel"]');
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      await centre(panel);
      await page.waitForTimeout(200);
      note({
        view: `panel ${plan}`, stayedOn: page.url().replace(BASE, ''), dataPlan: await panel.getAttribute('data-plan'),
        panelText: (await panel.innerText()).replace(/\s+/g, ' ').trim(),
        buttonsInPanel: await panel.locator('button').count(), cryptoButton: await panel.locator('[data-testid="checkout-method-crypto"]').count(),
        cardButton: await page.locator('[data-testid="checkout-method-card"]').count(),
        weeklyNote: await page.locator('[data-testid="checkout-method-crypto-weekly-note"]').count(),
      });
      await shot(page, `03-panel-${plan}-1440-dark`);
    }
    for (const plan of PLANS) {
      await page.locator(`[data-testid="checkout-cta-${plan}"]`).click();
      await page.locator('[data-testid="checkout-method-crypto"]').click();
      await page.waitForURL(/pay\.boomfi\.xyz/, { timeout: 30_000 });
      const went = page.url();
      const u = new URL(went);
      note({ view: `pay with crypto ${plan}`, host: u.host, path: u.pathname, params: [...u.searchParams.keys()], customerIdentIsSessionUser: u.searchParams.get('customer_ident') === FAKE_UID, emailInUrl: /@|example\.invalid/.test(went) });
      await page.goBack({ waitUntil: 'load', timeout: 60_000 });
      await page.waitForSelector('[data-testid="checkout-cta-monthly"]', { timeout: 60_000 });
      await page.waitForTimeout(800);
      note({ view: `after Back from ${plan}`, url: page.url().replace(BASE, ''), buttons: await buttons(page) });
      if (plan === 'monthly') { await page.locator('[data-testid="checkout-cta-monthly"]').scrollIntoViewIfNeeded(); await shot(page, '04-after-back-1440-dark'); }
    }
    note({ view: 'signed-in session totals', boomfiRequestsAnsweredLocally: boomfi.length, interceptedWrites: page.__writes, pageErrors });
    await ctx.close();
  }

  /* ── C. the panel at phone width and in the light theme (the two-weekly plan: it has the extra note) ── */
  for (const v of [{ mobile: true, theme: 'dark', name: '390-dark' }, { mobile: true, theme: 'light', name: '390-light' }, { mobile: false, theme: 'light', name: '1440-light' }]) {
    const { ctx, page, pageErrors } = await context(browser, { signedIn: true, mobile: v.mobile, theme: v.theme });
    await page.goto(`${BASE}/upgrade`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('[data-testid="checkout-cta-fortnightly"]', { timeout: 60_000 });
    await settle(page);
    await page.locator('[data-testid="checkout-cta-fortnightly"]').scrollIntoViewIfNeeded();
    await shot(page, `05-buttons-${v.name}`);
    await page.locator('[data-testid="checkout-cta-fortnightly"]').click();
    const panel = page.locator('[data-testid="checkout-method-panel"]');
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    await centre(panel);
    await page.waitForTimeout(250);
    const box = await panel.boundingBox();
    const vp = page.viewportSize();
    note({ view: `panel fortnightly ${v.name}`, theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')), overflow: await overflow(page), panelBox: box && { x: Math.round(box.x), w: Math.round(box.width) }, viewportW: vp.width, panelInsideViewport: !!box && box.x >= 0 && box.x + box.width <= vp.width + 1, buttons: await buttons(page), pageErrors });
    await shot(page, `06-panel-fortnightly-${v.name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
}
console.log('done');
