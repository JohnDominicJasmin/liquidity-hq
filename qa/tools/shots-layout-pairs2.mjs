/* Layout pairs for the page-hint fix: the SAME pages, widths and harness on two builds, so a difference is the
 * build, not the harness. Run once against production (the previous build, 4936037) and once against qa (the fix).
 * Read-only and fenced: synthetic Free session; GET/HEAD to the app let through, every app write answered locally
 * (echoing the fields as accepted); the named Supabase reads answered locally, other Supabase refused; public
 * market-data GETs and sockets let through (they carry nothing about the visitor); everything else refused.
 * Each page is shot twice per width: hint SHOWN (first visit) and hint COLLAPSED (after the X), full page.
 * usage: node shots-layout-pairs.mjs <base> <supabaseRef> <outdir>                                              */
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
const PAGES = (process.env.PAGES || '/dashboard,/news,/alerts,/settings,/calc,/econ-calendar,/hours,/playbook,/scanner,/upgrade,/zz-not-a-page').split(',');
/* Landing pages are what a SIGNED-OUT visitor sees; a signed-in one is sent elsewhere. */
const SIGNED_OUT = new Set((process.env.SIGNED_OUT || '').split(',').filter(Boolean));
const WIDTHS = [[1280, 800], [1440, 900], [1920, 1080], [390, 844]];
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const log = [];

async function open(browser, width, height, signedIn = true) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, si]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, signedIn]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB_HOST, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let fields = []; try { fields = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* not JSON */ }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: fields, rejected: [], settings: {} }) });
    }
    if (u.host === SB_HOST) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      return r.abort('failed');
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

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  log.push({ base: BASE, served: v.commit, branch: v.branch, at: new Date().toISOString() });
  /* Warm-up: one unmeasured load of every page first, so no measured shot is a cold service (PM's audit, 2026-09-30). */
  for (const p of PAGES) { const c = await open(browser, 1280, 800, !SIGNED_OUT.has(p)); const pg = await c.newPage(); await pg.goto(BASE + p, { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await pg.waitForTimeout(6000); await c.close(); }
  for (const [w, h] of WIDTHS) {
    for (const p of PAGES) {
      const ctx = await open(browser, w, h, !SIGNED_OUT.has(p));
      const page = await ctx.newPage();
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 120_000 });
      await settle(page);
      await page.waitForTimeout(3500);
      const name = `${String(w).padStart(4, '0')}-${p === '/' ? 'landing' : p.slice(1)}`;
      await page.screenshot({ path: `${OUT}/${name}-a-shown.png`, fullPage: true });
      const dismiss = page.getByRole('button', { name: L.PAGE_HINT_DISMISS_LABEL }).first();
      const hasHint = await dismiss.isVisible().catch(() => false);
      if (hasHint) {
        await dismiss.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${name}-b-collapsed.png`, fullPage: true });
      }
      /* Where the hint and the main content sit - a number to compare, alongside the picture. */
      const geo = await page.evaluate(() => {
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        const main = document.querySelector('main') ?? document.body;
        const kids = [...main.querySelectorAll(':scope > * > *, :scope > *')].slice(0, 6).map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), ...r(el) }));
        const hint = document.querySelector('[data-page-hint]');
        return { docWidth: document.documentElement.scrollWidth, main: r(main), hint: hint ? { key: hint.getAttribute('data-page-hint'), ...r(hint) } : null, dashMain: r(document.querySelector('.dash-main')), dashRight: r(document.querySelector('.dash-right')), firstBlocks: kids };
      });
      log.push({ page: p, width: w, signedIn: !SIGNED_OUT.has(p), landedOn: new URL(page.url()).pathname, hintOnThisBuild: hasHint, geometry: geo });
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1)); console.log(`done: ${log.length - 1} page-width readings -> ${OUT}`); }
