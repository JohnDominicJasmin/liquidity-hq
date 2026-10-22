/* Control for PM's audit: was qa's degraded /dashboard at 1280 (B side) a cold service, or the build?
 * Same harness as shots-layout-pairs.mjs. Per build: one warm-up load, then two measured loads, alternating
 * A, B, A, B so both are equally warm. Records the Market Read verdict, score, cell count, calendar rows,
 * and a screenshot of each measured load.
 * usage: node control-dashboard-1280.mjs <outdir>                                                          */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BUILDS = [
  { tag: 'A-prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' },
  { tag: 'B-qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' },
];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = [];

async function load(browser, b, measure, n) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  const failedApp = [];
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  page.on('response', (res) => { const u = new URL(res.url()); if (u.host === APP && u.pathname.startsWith('/api/') && res.status() >= 400) failedApp.push(`${res.status()} ${u.pathname}`); });
  const t0 = Date.now();
  await page.goto(b.base + '/liq', { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(8000);
  if (measure) {
    const r = await page.evaluate(() => { const t = document.body.innerText; const i = t.indexOf('OPTIONS MARKET PRESSURE'); const seg = i >= 0 ? t.slice(i, i + 900) : ''; return { optionsCard: i >= 0, maxPainShown: /Max pain/i.test(seg), priceLevelRows: (seg.match(/\$\d{2,3}K/g) || []).length }; });
    await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${b.tag}-390-liq.png`, fullPage: true });
    const v = await (await fetch(b.base + '/api/version')).json();
    out.push({ n, build: b.tag, commit: v.commit, at: new Date().toISOString(), loadMs: Date.now() - t0, ...r, failedAppApi: failedApp });
  }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const b of BUILDS) await load(browser, b, false, 0); // warm-up, not measured
  let n = 1;
  for (let round = 0; round < 2; round++) for (const b of BUILDS) await load(browser, b, true, n++);
} finally { await browser.close(); writeFileSync(`${OUT}/control.json`, JSON.stringify(out, null, 1)); for (const o of out) console.log(JSON.stringify(o)); }
