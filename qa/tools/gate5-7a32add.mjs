/* 5-minute gate on qa 7a32add: dashboard grid + early frame (1280, 390), toast at 390, /alerts text has no "funding",
 * Arena: a Free account with the plan read refused (plan unknown) on ?tf=5m, /api/grok stubbed 403 PRO_REQUIRED, run a
 * read -> banner shows the Pro copy + Upgrade, never "PRO_REQUIRED". Same allowlist fence as the other harness scripts. */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BASE = 'https://liquidity-hq-qa.onrender.com', REF = 'wdtjhrilakoitfcezxpx', APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = []; const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
async function open(browser, w, h, { planUnknown = false, grok403 = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  const seen = { grok: 0 };
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (grok403 && u.pathname.startsWith('/api/grok') && req.method() !== 'GET') { seen.grok++; return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"PRO_REQUIRED","message":"stubbed by QA"}' }); }
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB && req.method() === 'GET') {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) { if (planUnknown) return r.abort('failed'); return row(r, { user_id: UID, role: 'free', trial_ends_at: null }); }
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} });
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return { ctx, seen };
}
const settle = async (page) => { await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {}); for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); } };
const browser = await chromium.launch();
try {
  log({ served: (await (await fetch(BASE + '/api/version')).json()).commit });
  // dashboard
  for (const [w, h] of process.env.ARENA_ONLY ? [] : [[1280, 800], [390, 844]]) {
    const { ctx } = await open(browser, w, h); const page = await ctx.newPage();
    await page.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(1000);
    const early = await page.evaluate(() => /reading the market/i.test(document.body.innerText)); const earlyScore = await page.evaluate(() => /\b\d{1,3}\s*\/100/.test(document.body.innerText));
    await page.screenshot({ path: `${OUT}/dashboard-${w}-early.png` });
    await settle(page); await page.waitForTimeout(6000);
    const g = await page.evaluate(() => ({ cols: document.querySelector('.dashboard-grid') && getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }));
    await page.screenshot({ path: `${OUT}/dashboard-${w}.png` });
    log({ step: 'dashboard', w, earlyReading: early, earlyScoreShown: earlyScore, ...g });
    await ctx.close();
  }
  // toast at 390
  if (!process.env.ARENA_ONLY) { const { ctx } = await open(browser, 390, 844); const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2000);
    await page.locator('button', { hasText: /^4h$/ }).first().click().catch(() => {});
    await page.waitForFunction(() => /saved/i.test(document.querySelector('.st-save-toast')?.textContent || ''), null, { timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const box = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || Number(cs.opacity) === 0) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }; const ov = (a, c) => (a && c ? Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y)) : 0); const t = box(document.querySelector('.st-save-toast')); return { text: document.querySelector('.st-save-toast')?.textContent, bg: document.querySelector('.st-save-toast') && getComputedStyle(document.querySelector('.st-save-toast')).backgroundColor, ovFab: ov(t, box(document.querySelector('[data-testid="grok-launcher"]') || document.querySelector('.gchat-fab'))), ovBar: ov(t, box(document.querySelector('.tnav-tabs'))), ovTop: ov(t, box(document.querySelector('header.tnav') || document.querySelector('.tnav'))) }; });
    await page.screenshot({ path: `${OUT}/toast-390.png` });
    const gone = await page.evaluate(async () => { const t0 = performance.now(); while (performance.now() - t0 < 5000) { if (!document.querySelector('.st-save-toast')) return Math.round(performance.now() - t0); await new Promise((r) => setTimeout(r, 50)); } return null; });
    log({ step: 'toast390', ...g, goneAfterMs: gone }); await ctx.close(); }
  // alerts
  for (const w of process.env.ARENA_ONLY ? [] : [1280]) { const { ctx } = await open(browser, w, 800); const page = await ctx.newPage();
    await page.goto(BASE + '/alerts', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText); const hits = (text.match(/[^\n]*funding[^\n]*/gi) || []).slice(0, 5);
    await page.screenshot({ path: `${OUT}/alerts-${w}.png`, fullPage: true });
    log({ step: 'alerts', w, fundingMentions: hits.length, hits }); await ctx.close(); }
  // arena fast tf banner
  { const { ctx, seen } = await open(browser, 1280, 800, { planUnknown: true, grok403: true }); const page = await ctx.newPage();
    await page.goto(BASE + '/arena?tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(6000);
    const btn = page.locator('button', { hasText: /^quick research$/i }).first();
    const hasBtn = await btn.isVisible().catch(() => false); if (hasBtn) { await btn.click().catch(() => {}); }
    await page.waitForFunction(() => !!document.querySelector('.arena-err'), null, { timeout: 20_000 }).catch(() => {});
    const err = await page.evaluate(() => { const e = document.querySelector('.arena-err'); return e ? { text: e.textContent, link: e.querySelector('a')?.getAttribute('href') ?? null } : null; });
    const raw = await page.evaluate(() => /PRO_REQUIRED/.test(document.body.innerText));
    await page.screenshot({ path: `${OUT}/arena-5m-pro-required.png` });
    log({ step: 'arenaFastTf', runButton: hasBtn, grokCallsStubbed: seen.grok, banner: err, rawCodeVisible: raw }); await ctx.close(); }
} finally { await browser.close(); writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1)); }
