/* /upgrade A|B pairs from ONE harness (same fence, same viewport/theme matrix), one build per run.
 * usage: BASE=http://localhost:3201 TAG=A node upgrade-pairs.mjs <outdir>
 * States: signedOut, free (synthetic Free session). Themes: dark, light. Widths: 390, 1280, 1440, 1920.
 * Views per context: closed (page as loaded); revealed (B only: click upgrade-reveal-plans); panel-fortnightly and panel-monthly
 * (click that plan's checkout-cta-* button, then capture checkout-method-panel). The fence aborts every host but the app,
 * so a plan click can never leave the app; app writes are answered locally. Measures sideways scroll and equal plan-button
 * widths, and records testids present. Memory-careful: one context at a time.                                          */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] || 'upgrade-pairs'; mkdirSync(OUT, { recursive: true });
const BASE = (process.env.BASE || 'http://localhost:3201').replace(/\/$/, ''); const TAG = process.env.TAG || 'X';
const REF = process.env.REF || 'wdtjhrilakoitfcezxpx'; const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const WIDTHS = [[390, 844], [1280, 800], [1440, 900], [1920, 1080]];
const out = []; const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
async function open(browser, w, h, theme, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, s, t, si]) => { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, s); }, [`sb-${REF}-auth-token`, session, theme, signedIn]);
  await ctx.routeWebSocket(/.*/, (ws) => { if (new URL(ws.url()).host === APP) ws.connectToServer(); else ws.close(); });
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
    return r.abort('failed');
  });
  return ctx;
}
const settle = async (page) => { await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {}); for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); } };
const MEASURE = () => {
  const ids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => /^(checkout-|upgrade-)/.test(t));
  const btns = ['fortnightly', 'monthly', 'annual'].map((p) => { const e = document.querySelector(`[data-testid="checkout-cta-${p}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { p, w: Math.round(b.width), h: Math.round(b.height), visible: b.width > 0 && b.height > 0 }; }).filter(Boolean);
  const widths = btns.filter((b) => b.visible).map((b) => b.w);
  return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, ids: [...new Set(ids)], buttons: btns, equalWidth: widths.length >= 2 ? Math.max(...widths) - Math.min(...widths) <= 1 : null, text: /Cancel anytime/i.test(document.body.innerText) ? 'HAS "Cancel anytime"' : 'no "Cancel anytime"', coming: /launching soon|coming soon/i.test(document.body.innerText) };
};
const browser = await chromium.launch();
try {
  { const c = await open(browser, 1280, 800, 'dark', true); const p = await c.newPage(); await p.goto(BASE + '/upgrade', { waitUntil: 'load', timeout: 300_000 }).catch(() => {}); await p.waitForTimeout(5000); await c.close(); }
  for (const state of ['signedOut', 'free']) for (const theme of ['dark', 'light']) for (const [w, h] of WIDTHS) {
    const ctx = await open(browser, w, h, theme, state === 'free'); const page = await ctx.newPage();
    const base = `${state}-${theme}-${w}`;
    try {
      await page.goto(BASE + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForFunction(() => /Pro/.test(document.body.innerText) && /Free|launching|coming soon/i.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${base}-closed--${TAG}.png`, fullPage: true });
      log({ tag: TAG, state, theme, w, view: 'closed', ...(await page.evaluate(MEASURE)) });
      const reveal = page.locator('[data-testid="upgrade-reveal-plans"]').first();
      if (await reveal.count()) { await reveal.click().catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${base}-revealed--${TAG}.png`, fullPage: true }); log({ tag: TAG, state, theme, w, view: 'revealed', ...(await page.evaluate(MEASURE)) }); }
      if (state === 'free') for (const plan of ['fortnightly', 'monthly']) {
        const b = page.locator(`[data-testid="checkout-cta-${plan}"]`).first();
        if (!(await b.count()) || !(await b.isVisible().catch(() => false))) { log({ tag: TAG, state, theme, w, view: `panel-${plan}`, note: 'plan button not visible' }); continue; }
        await b.scrollIntoViewIfNeeded().catch(() => {}); await b.click().catch(() => {}); await page.waitForTimeout(700);
        const panel = page.locator('[data-testid="checkout-method-panel"]').first(); const has = await panel.count();
        if (has) await panel.scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: `${OUT}/${base}-panel-${plan}--${TAG}.png`, fullPage: true });
        log({ tag: TAG, state, theme, w, view: `panel-${plan}`, panelPresent: !!has, weakNote: await page.locator('[data-testid="checkout-method-crypto-weekly-note"]').count(), ...(await page.evaluate(MEASURE)) });
      }
    } catch (e) { log({ tag: TAG, state, theme, w, error: String(e.message).slice(0, 160) }); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/results-${TAG}.json`, JSON.stringify(out, null, 1)); }
