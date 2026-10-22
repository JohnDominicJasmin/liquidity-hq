/* Control for the 390 dashboard pair: B (qa 92c144a) showed BTC.D/ALT "-", an empty BTC Long/Short bar, no
 * Perps vs Spot card and Global Macro as a Pro gate, where A (prod 4936037) had data and "Unauthorized".
 * Re-shoot /dashboard ALONE, warm (one unmeasured load first), on both builds, 390 and 1280, twice each, with a
 * longer settle (15s), and read the rail cards' text. Same fence/session as shots-layout-pairs2.mjs.
 * usage: node control-dash-390-rail.mjs <outdir>                                                               */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BUILDS = [{ tag: 'A-prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: 'B-qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' }];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = [];
async function run(browser, b, w, h, measure, i) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  const appStatus = [];
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
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
  page.on('response', (r) => { const u = new URL(r.url()); if (u.host === APP && u.pathname.startsWith('/api/')) appStatus.push(`${u.pathname}:${r.status()}`); });
  await page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(15000);
  if (measure) {
    const m = await page.evaluate(() => {
      const body = document.body.innerText;
      const grab = (re) => { const i = body.search(re); return i < 0 ? null : body.slice(i, i + 140).replace(/\s+/g, ' '); };
      return { btcd: grab(/BTC\.D/), longShort: grab(/BTC LONG \/ SHORT/i), perps: grab(/PERPS VS SPOT/i), macro: grab(/GLOBAL MACRO CONTEXT/i), oi1h: grab(/OPEN INTEREST 1H/i), sw: document.documentElement.scrollWidth };
    });
    const name = `${b.tag}-dashboard-${w}-run${i}.png`;
    await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
    out.push({ build: b.tag, width: w, run: i, shot: name, ...m, api: [...new Set(appStatus)].filter((s) => !/:200$/.test(s)) });
    console.log(JSON.stringify(out.at(-1)));
  }
  await ctx.close();
}
const browser = await chromium.launch();
try {
  for (const b of BUILDS) await run(browser, b, 390, 844, false, 0);
  for (const i of [1, 2]) for (const w of [390, 1280]) for (const b of BUILDS) await run(browser, b, w, w < 500 ? 844 : 800, true, i);
} finally { await browser.close(); writeFileSync(`${OUT}/control.json`, JSON.stringify(out, null, 1)); }
