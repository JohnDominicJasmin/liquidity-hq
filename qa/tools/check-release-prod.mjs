/* Release #1487 (v2026.10.01) on PRODUCTION: How to test steps 4, 5, 7, 8, 11, and the 404 page console.
 * READ-ONLY. No sign-in: a synthetic session in localStorage, the account reads answered in the browser.
 * ALLOWLIST: only the app's own host is let through, and only GET/HEAD to it; every write to it is answered
 * locally. The production Supabase host is answered locally for the named tables and refused for everything
 * else (every non-GET refused). Every other host refused. WebSockets closed. Nothing is written anywhere.
 * Steps 9 and 10 are not here: 9 needs a hypothesis with evidence, 10 needs two real sessions.
 * usage: node check-release-prod.mjs https://liquidity-hq.com qdpwhnvmhqgzijuwopso                         */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2].replace(/\/$/, '');
const REF = process.argv[3];
const SB_HOST = `${REF}.supabase.co`;
const APP_HOST = new URL(BASE).host;
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const fence = { blocked: new Set(), writes: new Set() };

async function open(browser, { signedIn, width = 1280, height = 900, blockTrades = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  if (signedIn) await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('theme', 'dark'); }, [`sb-${REF}-auth-token`, session]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      fence.writes.add(`${req.method()} ${u.pathname}`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":["default_tf"],"rejected":[],"settings":{}}' });
    }
    if (u.host === SB_HOST && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      if (/trades/.test(u.pathname) && !blockTrades) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    fence.blocked.add(u.host === SB_HOST ? `${req.method()} ${u.pathname}` : u.host);
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 90)));
  return { ctx, page, errors };
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const out = (o) => console.log(JSON.stringify(o));

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  out({ part: 'served', at: new Date().toISOString(), commit: v.commit, branch: v.branch, proBuyable: v.configured?.proBuyable });

  // 404 page console (#1474): status, hydration errors, header name at phone width.
  for (const p of ['/zz-not-a-page', '/ar', '/arena/zz-not-a-page', '/faq/old-page']) {
    const s = await open(browser, { signedIn: false, width: 390, height: 844 });
    const res = await s.page.goto(BASE + p, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
    await s.page.waitForTimeout(3000);
    out({ step: '404', path: p, status: res?.status() ?? null, hydrationErrors: s.errors.filter((e) => /#418|#423|#425|ydrat/.test(e)).length, otherErrors: s.errors.filter((e) => !/#418|#423|#425|ydrat/.test(e)), headerName: await s.page.evaluate(() => document.querySelector('.tnav-mbrand')?.textContent ?? null), shows404: await s.page.evaluate(() => /Liquidity not found|404/.test(document.body.innerText)) });
    await s.ctx.close();
  }

  // Steps 4 and 5: the upgrade prompt's link, signed in (free) and signed out. Read the href; never click through.
  for (const signedIn of [true, false]) {
    const s = await open(browser, { signedIn });
    await s.page.goto(BASE + '/arena', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(2500);
    const fast = s.page.locator('button', { hasText: /^5m$/ }).first();
    const hasFast = await fast.isVisible().catch(() => false);
    let href = null;
    if (hasFast) {
      await fast.click().catch(() => {});
      const dialog = s.page.locator('[role="dialog"][aria-modal="true"]');
      await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      href = await dialog.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))).catch(() => null);
    }
    out({ step: signedIn ? '4 signed-in free' : '5 signed out', page: '/arena, click 5m', fastTfButton: hasFast, promptLinks: href, pageErrors: s.errors });
    await s.ctx.close();
  }
  // Step 6 companion: /upgrade on production shows the coming-soon block, no plan button.
  {
    const s = await open(browser, { signedIn: true });
    await s.page.goto(BASE + '/upgrade', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(2000);
    out({ step: '6 companion', ctaButtons: await s.page.locator('[data-testid^="checkout-cta"]').count(), comingSoon: await s.page.evaluate((t) => document.body.innerText.includes(t), L.UPGRADE_COMING_SOON_TITLE), pageErrors: s.errors });
    await s.ctx.close();
  }

  // Step 7: page hints - first visit shows, dismiss collapses to the "?" chip, reload stays collapsed.
  for (const p of ['/news', '/alerts', '/settings', '/dashboard', '/calc', '/econ-calendar', '/hours', '/playbook', '/scanner']) {
    const s = await open(browser, { signedIn: true });
    await s.page.goto(BASE + p, { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    const dismiss = s.page.getByRole('button', { name: L.PAGE_HINT_DISMISS_LABEL });
    const shown = await dismiss.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    let chipAfterDismiss = false, chipAfterReload = false, hintAfterReload = null;
    if (shown) {
      await dismiss.first().click();
      chipAfterDismiss = await s.page.getByRole('button', { name: L.PAGE_HINT_REPLAY_LABEL }).first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
      await s.page.reload({ waitUntil: 'load' });
      await settle(s.page);
      chipAfterReload = await s.page.getByRole('button', { name: L.PAGE_HINT_REPLAY_LABEL }).first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
      hintAfterReload = await dismiss.first().isVisible().catch(() => false);
    }
    out({ step: '7 hints', path: p, shownFirstVisit: shown, chipAfterDismiss, chipAfterReload, fullHintAfterReload: hintAfterReload, pageErrors: s.errors });
    await s.ctx.close();
  }

  // Step 8: the journal with its trades read failing shows a retry, never "no trades".
  {
    const s = await open(browser, { signedIn: true, blockTrades: true });
    await s.page.goto(BASE + '/journal', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(4000);
    const text = await s.page.evaluate(() => document.body.innerText);
    out({ step: '8 journal, trades read fails', failedMessage: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_FAILED), retry: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_RETRY), pageErrors: s.errors });
    await s.ctx.close();
  }

  // Step 11: at phone width, the settings save message sits above the bottom tab bar.
  {
    const s = await open(browser, { signedIn: true, width: 390, height: 844 });
    await s.page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(2000);
    const chip = s.page.locator('button', { hasText: /^4h$/ }).first();
    const hasChip = await chip.isVisible().catch(() => false);
    if (hasChip) { await chip.scrollIntoViewIfNeeded(); await chip.click().catch(() => {}); }
    const toast = s.page.locator('.st-save-toast').first();
    const seen = await toast.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    const geo = seen ? await s.page.evaluate(() => {
      const t = document.querySelector('.st-save-toast')?.getBoundingClientRect();
      const bar = document.querySelector('.tnav-tabs')?.getBoundingClientRect();
      return { toastBottom: t && Math.round(t.bottom), barTop: bar && Math.round(bar.top), barVisible: !!bar && bar.height > 0 };
    }) : null;
    out({ step: '11 mobile save toast', chipClicked: hasChip, toastShown: seen, geometry: geo, clearOfBar: geo ? (!geo.barVisible || geo.toastBottom <= geo.barTop) : null, pageErrors: s.errors });
    await s.ctx.close();
  }
  out({ part: 'fence', blocked: [...fence.blocked].sort(), writesAnsweredLocally: [...fence.writes].sort() });
} finally { await browser.close(); }
