/* Owner screenshots for release v2026.10.01 on PRODUCTION (condition 5): page hint shown and collapsed, the
 * settings save toast at 390 px, the 404 page at 390 and 1440. Read-only and fenced exactly like
 * check-release-prod.mjs: synthetic session, only GET/HEAD to the app, writes answered locally, Supabase named
 * reads answered locally, every other host refused, sockets closed.
 * usage: node shots-release-prod.mjs https://liquidity-hq.com qdpwhnvmhqgzijuwopso <outdir>                  */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const [BASE0, REF, OUT] = process.argv.slice(2);
const BASE = BASE0.replace(/\/$/, '');
const SB_HOST = `${REF}.supabase.co`;
const APP_HOST = new URL(BASE).host;
mkdirSync(OUT, { recursive: true });
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const log = [];

async function open(browser, { signedIn, width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, si]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, !!signedIn]);
  // Market-data sockets carry nothing about the visitor; let them through so the page looks as it does to a real one. Close Supabase realtime.
  await ctx.routeWebSocket((u) => new URL(u).host === SB_HOST, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let fields = []; try { fields = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch {} return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: fields, rejected: [], settings: {} }) }); }
    if (u.host === SB_HOST && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
    }
    if (u.host !== SB_HOST && !u.host.endsWith('liquidity-hq.com') && req.resourceType() !== 'document' && req.method() === 'GET' && /binance|bybit|okx|coinbase|deribit|coingecko|fonts./.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  return { ctx, page };
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  log.push({ served: v.commit, branch: v.branch, at: new Date().toISOString() });
  // 1-2. A page hint, shown then collapsed (/dashboard), desktop and phone.
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const s = await open(browser, { signedIn: true, width: w, height: h });
    await s.page.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    const dismiss = s.page.getByRole('button', { name: L.PAGE_HINT_DISMISS_LABEL }).first();
    await dismiss.waitFor({ state: 'visible', timeout: 15_000 });
    await s.page.waitForTimeout(1500);
    await s.page.screenshot({ path: `${OUT}/01-hint-shown-dashboard-${tag}.png` });
    await dismiss.click();
    await s.page.getByRole('button', { name: L.PAGE_HINT_REPLAY_LABEL }).first().waitFor({ state: 'visible', timeout: 5_000 });
    await s.page.waitForTimeout(800);
    await s.page.screenshot({ path: `${OUT}/02-hint-collapsed-dashboard-${tag}.png` });
    log.push({ shot: `hint dashboard ${tag}`, ok: true });
    await s.ctx.close();
  }
  // 3. The settings save toast at 390.
  {
    const s = await open(browser, { signedIn: true, width: 390, height: 844 });
    await s.page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(1500);
    const chip = s.page.locator('button', { hasText: /^4h$/ }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await s.page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: 8_000 });
    await s.page.waitForTimeout(300);
    const geo = await s.page.evaluate(() => ({ toastBottom: Math.round(document.querySelector('.st-save-toast')?.getBoundingClientRect().bottom ?? -1), barTop: Math.round(document.querySelector('.tnav-tabs')?.getBoundingClientRect().top ?? -1) }));
    await s.page.screenshot({ path: `${OUT}/03-settings-save-toast-390.png` });
    log.push({ shot: 'toast 390 (read before the screenshot)', geometry: geo });
    log.push({ shot: 'toast 390', geometry: await s.page.evaluate(() => ({ toastBottom: Math.round(document.querySelector('.st-save-toast')?.getBoundingClientRect().bottom ?? -1), barTop: Math.round(document.querySelector('.tnav-tabs')?.getBoundingClientRect().top ?? -1) })) });
    await s.ctx.close();
  }
  // 4-5. The 404 page, signed out, at 390 and 1440.
  for (const [w, h, tag] of [[390, 844, '390'], [1440, 900, '1440']]) {
    const s = await open(browser, { signedIn: false, width: w, height: h });
    const res = await s.page.goto(BASE + '/zz-not-a-page', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(1500);
    await s.page.screenshot({ path: `${OUT}/04-404-page-${tag}.png` });
    log.push({ shot: `404 ${tag}`, status: res?.status() });
    await s.ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1)); console.log(JSON.stringify(log)); }
