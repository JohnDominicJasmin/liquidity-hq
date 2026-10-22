/* Compressed gate for the #1528 fix: /settings at 390 (phone emulation AND plain) and 1280 must have scrollWidth equal to
 * the requested viewport width and the Risk Per Trade "%" suffix fully visible; dashboard grid at 1280 and no sideways
 * scroll at 390; landing at 390 no sideways scroll and the headline in two balanced lines. Same allowlist fence.
 * usage: BASE=https://liquidity-hq-qa.onrender.com REF=wdtjhrilakoitfcezxpx node gate-settings-fix.mjs <outdir>        */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] || 'gate-settings-fix'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://liquidity-hq-qa.onrender.com', REF = process.env.REF || 'wdtjhrilakoitfcezxpx';
const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = []; const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
async function open(browser, w, h, mobile, signedIn = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, s, si]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, s); }, [`sb-${REF}-auth-token`, session, signedIn]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
    if (u.host === SB && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} });
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
const settle = async (page) => { await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {}); for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); } };
const browser = await chromium.launch();
try {
  log({ served: (await (await fetch(BASE + '/api/version')).json()).commit });
  // settings: requested width W; layout width may differ in phone emulation, so compare scrollWidth to W (not innerWidth)
  for (const [w, h, mobile] of [[390, 844, true], [390, 844, false], [1280, 800, false]]) {
    const ctx = await open(browser, w, h, mobile); const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(3500);
    const m = await page.evaluate((W) => {
      const suf = [...document.querySelectorAll('.st-suffix')].map((e) => { const b = e.getBoundingClientRect(); return { text: (e.textContent || '').trim(), right: Math.round(b.right), visible: b.right <= W && b.left >= 0 }; });
      const risk = [...document.querySelectorAll('.st-field')].find((f) => /risk per trade/i.test(f.textContent || ''));
      const ri = risk && risk.querySelector('input'); const rb = ri && ri.getBoundingClientRect();
      return { W, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, vvW: Math.round(visualViewport.width), suffixes: suf, riskInputW: rb && Math.round(rb.width), hasRiskField: !!risk };
    }, w);
    await page.screenshot({ path: `${OUT}/settings-${w}-${mobile ? 'mobile' : 'plain'}.png`, fullPage: false });
    log({ step: 'settings', w, mobile, pass: m.scrollW === w && m.hasRiskField && m.suffixes.length > 0 && m.suffixes.every((s) => s.visible), ...m });
    await ctx.close();
  }
  // dashboard
  for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
    const ctx = await open(browser, w, h, mobile); const page = await ctx.newPage();
    await page.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(6000);
    const g = await page.evaluate((W) => ({ cols: document.querySelector('.dashboard-grid') && getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns, scrollW: document.documentElement.scrollWidth, W }), w);
    await page.screenshot({ path: `${OUT}/dashboard-${w}.png` });
    log({ step: 'dashboard', w, pass: g.scrollW === w && (w < 500 || /^\d+px \d+px$/.test(g.cols || '')), ...g });
    await ctx.close();
  }
  // landing at 390
  { const ctx = await open(browser, 390, 844, true, false); const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(3000);
    const l = await page.evaluate(() => { const h1 = document.querySelector('.lp-hero-h1') || document.querySelector('h1'); const sp = h1 && h1.querySelector('span'); let lines = null; if (sp && sp.firstChild) { const t = sp.firstChild; const r = document.createRange(); let cur = ''; let last = null; lines = []; for (let i = 0; i < t.textContent.length; i++) { r.setStart(t, i); r.setEnd(t, i + 1); const rc = r.getClientRects()[0]; const top = rc ? Math.round(rc.top) : last; if (last !== null && top !== null && Math.abs(top - last) > 4) { lines.push(cur.trim()); cur = ''; } cur += t.textContent[i]; if (top !== null) last = top; } lines.push(cur.trim()); } return { scrollW: document.documentElement.scrollWidth, accentLines: lines }; });
    await page.screenshot({ path: `${OUT}/landing-390.png` });
    log({ step: 'landing390', pass: l.scrollW === 390 && Array.isArray(l.accentLines) && l.accentLines.length === 2, ...l });
    await ctx.close(); }
} finally { await browser.close(); writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1)); }
