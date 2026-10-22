/* qa build c67a61b: do the 8 rollout pages show their PageHint on the deployed site? Synthetic session, no sign-in,
 * the three reads answered locally, no writes reach the database. Text is matched against the shipped English
 * defaults (migration 20260928a is not applied, so defaults are what should render). */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const D = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const BASE = 'https://liquidity-hq-qa.onrender.com';
const UID = '00000000-0000-4000-8000-00000000fa4e';
const PAGES = [['/news', 'NEWS'], ['/alerts', 'ALERTS'], ['/settings', 'SETTINGS'], ['/dashboard', 'DASHBOARD'], ['/calc', 'CALC'], ['/econ-calendar', 'ECON_CALENDAR'], ['/hours', 'HOURS'], ['/playbook', 'PLAYBOOK']];
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const browser = await chromium.launch();
try {
  for (const [path, key] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(([v]) => { localStorage.setItem('sb-wdtjhrilakoitfcezxpx-auth-token', v); localStorage.setItem('theme', 'dark'); }, [session]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
    await page.route('**/auth/v1/token*', (r) => r.abort('failed'));
    const row = (r, o) => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    await page.route('**/rest/v1/*user_onboarding*', (r) => row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true }));
    await page.route('**/rest/v1/*user_subscriptions*', (r) => row(r, { user_id: UID, role: 'free', trial_ends_at: null }));
    await page.route('**/rest/v1/*user_settings*', (r) => row(r, { user_id: UID, risk_pct: 1, default_coin: 'BTC', default_tf: '1h', watchlist: [], field_updated_at: {} }));
    await page.route('**/api/settings', (r) => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":[],"rejected":[],"settings":{}}' }));
    let status = null;
    const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
    status = res?.status() ?? 'no response';
    await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
    const body = D[`${key}_HINT_BODY`];
    const found = await page.waitForFunction((t) => document.body.innerText.includes(t), body, { timeout: 20_000 }).then(() => true).catch(() => false);
    const text = await page.evaluate(() => document.body.innerText);
    console.log(JSON.stringify({ path, status, landedOn: page.url().replace(BASE, ''), hintBodyShown: found, hintTitleShown: text.includes(D[`${key}_HINT_TITLE`]), h1Count: await page.locator('h1').count(), stuckOnLoading: await page.locator('.obw-root.obw-loading').count(), errors }));
    await ctx.close();
  }
} finally { await browser.close(); }
