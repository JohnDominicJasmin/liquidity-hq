/* PM's 5-minute visual check of the 6b5a786 production deploy: viewport + full-page at 1280 and 390 for /dashboard,
 * / (signed out), /upgrade, /settings (one save, toast showing) and /arena. READ-ONLY, same allowlist fence as
 * check-release-prod.mjs: synthetic Free session, app GET/HEAD only, writes answered locally, named Supabase reads
 * answered locally, everything else refused, sockets closed. Warm-up first.
 * usage: node prod-shots-6b5a786.mjs <outdir>                                                                    */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BASE = 'https://liquidity-hq.com', REF = 'qdpwhnvmhqgzijuwopso';
const SB_HOST = `${REF}.supabase.co`, APP_HOST = new URL(BASE).host;
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;

async function open(browser, signedIn, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, si]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, signedIn]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB_HOST && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, watchlist: [], field_updated_at: {} });
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const log = [];
const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  log.push({ served: v.commit, branch: v.branch, at: new Date().toISOString() });
  { const c = await open(browser, true, 1280, 800); const p = await c.newPage(); await p.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(4000); await c.close(); }
  const PAGES = [['/dashboard', true], ['/', false], ['/upgrade', true], ['/settings', true], ['/arena', true]];
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    for (const [path, signedIn] of PAGES) {
      const ctx = await open(browser, signedIn, w, h); const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 90)));
      const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
      await settle(page); await page.waitForTimeout(path === '/dashboard' || path === '/arena' ? 6000 : 3000);
      const name = (path === '/' ? 'landing' : path.slice(1)) + `-${w}`;
      let toast = null;
      if (path === '/settings') {
        const chip = page.locator('button', { hasText: /^4h$/ }).first();
        if (await chip.isVisible().catch(() => false)) {
          await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {});
          await page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
          await page.waitForFunction(() => !/saving/i.test(document.querySelector('.st-save-toast')?.textContent || 'x'), null, { timeout: 8000 }).catch(() => {});
          toast = await page.evaluate(() => document.querySelector('.st-save-toast')?.textContent ?? null);
          await page.screenshot({ path: `${OUT}/${name}-toast-viewport.png` });
          await page.waitForTimeout(3000);
        }
      }
      const grid = path === '/dashboard' ? await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('main *')].filter((e) => getComputedStyle(e).display === 'grid').slice(0, 3).map((e) => ({ cls: String(e.className).slice(0, 60), cols: getComputedStyle(e).gridTemplateColumns, w: Math.round(e.getBoundingClientRect().width) }));
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, grids: boxes };
      }) : null;
      await page.screenshot({ path: `${OUT}/${name}-viewport.png` });
      await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
      log.push({ path, w, status: res?.status() ?? null, toast, grid, errors });
      console.log(JSON.stringify(log[log.length - 1]));
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1)); }
