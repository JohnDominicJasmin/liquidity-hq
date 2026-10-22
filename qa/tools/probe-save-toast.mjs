/* Control for the "Couldn't save - try again" toast seen on load in both builds' pairs: which request fails?
 * Same fence and synthetic session as shots-layout-pairs2.mjs; logs every non-GET request and every refused one,
 * and when the toast appears. One page, 1280. usage: node probe-save-toast.mjs <base> <ref> <path>             */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const [BASE0, REF, P] = process.argv.slice(2);
const BASE = BASE0.replace(/\/$/, ''); const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const t0 = Date.now(); const ev = (s) => console.log(`${String(Date.now() - t0).padStart(6)}ms ${s}`);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } ev(`APP WRITE answered locally: ${req.method()} ${u.pathname} fields=${f.join(',')}`); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      ev(`SUPABASE REFUSED: ${req.method()} ${u.pathname}${u.search.slice(0, 80)}`); return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    ev(`OTHER REFUSED: ${req.method()} ${u.host}${u.pathname}`); return r.abort('failed');
  });
  const page = await ctx.newPage();
  page.on('response', async (r) => { const u = new URL(r.url()); if (u.host === APP && r.request().method() !== 'GET' ) ev(`resp ${r.status()} ${r.request().method()} ${u.pathname}`); if (u.host === APP && r.status() >= 400) ev(`APP ${r.status()} ${u.pathname}`); });
  await page.goto(BASE + P, { waitUntil: 'load', timeout: 120_000 });
  ev('load');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); const t = await page.locator('.st-save-toast').first().textContent({ timeout: 100 }).catch(() => null); if (t && t !== globalThis.__lt) { ev(`TOAST: ${t}`); } globalThis.__lt = t; }
  await page.waitForTimeout(1000);
} finally { await browser.close(); }
