/* Does /settings scroll sideways at 390? Measures scrollWidth vs innerWidth and names the widest offenders, before and
 * after one save, on each build given. Same allowlist fence. usage: node overflow-settings-390.mjs <outdir>          */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BUILDS = [
  { tag: 'prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' },
  { tag: 'qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' },
  { tag: 'staging', base: 'https://liquidity-hq-staging.onrender.com', ref: 'wdtjhrilakoitfcezxpx' },
];
const UID = '00000000-0000-4000-8000-00000000fa4e', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const MEASURE = () => {
  const iw = innerWidth; const off = [];
  for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > iw + 1 && getComputedStyle(e).position !== 'fixed') off.push({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 50), right: Math.round(b.right), w: Math.round(b.width), text: (e.textContent || '').trim().slice(0, 30) }); }
  off.sort((a, b) => b.right - a.right);
  return { innerW: iw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, vvW: Math.round(visualViewport.width), vvScale: visualViewport.scale, offenders: off.length, widest: off.slice(0, 6) };
};
const browser = await chromium.launch();
try {
  for (const b of BUILDS) {
    const v = await (await fetch(b.base + '/api/version')).json().catch(() => ({}));
    for (const mobile of [true, false]) {
      const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.addInitScript(([k, s]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, s); }, [`sb-${b.ref}-auth-token`, session]);
      await ctx.routeWebSocket(/.*/, (ws) => ws.close());
      const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
      await ctx.route('**/*', async (r) => {
        const req = r.request(); const u = new URL(req.url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
        if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
        if (u.host === SB && req.method() === 'GET') {
          if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
          if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
          if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} });
        }
        if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
        return r.abort('failed');
      });
      const page = await ctx.newPage();
      await page.goto(b.base + '/settings', { waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
      for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
      await page.waitForTimeout(3000);
      const before = await page.evaluate(MEASURE);
      await page.screenshot({ path: `${OUT}/settings-390-${b.tag}-${mobile ? 'mobile' : 'plain'}-top.png` });
      const chip = page.locator('button', { hasText: /^4h$/ }).first();
      if (await chip.isVisible().catch(() => false)) { await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {}); await page.waitForTimeout(700); }
      const after = await page.evaluate(MEASURE);
      await page.screenshot({ path: `${OUT}/settings-390-${b.tag}-${mobile ? 'mobile' : 'plain'}-aftersave.png` });
      console.log(JSON.stringify({ build: b.tag, commit: v.commit, mobile, before, after: { scrollW: after.scrollW, vvW: after.vvW, vvScale: after.vvScale, offenders: after.offenders, widest: after.widest.slice(0, 3) } }));
      await ctx.close();
    }
  }
} finally { await browser.close(); }
