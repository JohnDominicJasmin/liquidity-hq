/* Name the element that makes /settings 417px wide at a 390 viewport (phone emulation) on production.
 * Lists in-flow elements whose right edge is between 391 and 700 (the closed nav drawer sits at 741+ and is excluded),
 * plus the elements whose own scrollWidth exceeds their clientWidth, with an ancestor path. Subscription read answered
 * with a real Free-state row (role free). Same allowlist fence. Run once per subscription state: free | failed.
 * usage: node name-417-element.mjs <free|failed> <outdir>                                                          */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const STATE = process.argv[2] || 'free'; const OUT = process.argv[3] || 'name-417'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://liquidity-hq.com', REF = process.env.REF || 'qdpwhnvmhqgzijuwopso';
const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const FIND = () => {
  const path = (e) => { const p = []; for (let n = e; n && n !== document.body && p.length < 7; n = n.parentElement) p.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return p.join(' < '); };
  const wide = []; const scroll = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (e.closest('#nav-drawer, .nav-drawer, [class*="gchat"], .st-save-toast, [role="dialog"]')) continue;
    const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
    if (b.right > 391 && b.right < 700) wide.push({ right: Math.round(b.right), w: Math.round(b.width), left: Math.round(b.left), path: path(e), text: (e.textContent || '').trim().slice(0, 36), minW: cs.minWidth, width: cs.width, overflowX: cs.overflowX });
    if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' && e.clientWidth > 0) scroll.push({ sw: e.scrollWidth, cw: e.clientWidth, path: path(e) });
  }
  wide.sort((a, b) => a.right - b.right || a.path.length - b.path.length);
  const rows = new Map(); for (const x of wide) rows.set(x.right, (rows.get(x.right) || 0) + 1);
  const deepestFirst = [...wide].sort((a, b) => b.path.split(' < ').length - a.path.split(' < ').length || b.right - a.right).slice(0, 8);
  return { innerW: innerWidth, vvW: Math.round(visualViewport.width), docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, htmlW: Math.round(document.documentElement.getBoundingClientRect().width), count: wide.length, rightEdgeCounts: [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), deepestFirst, scroll: scroll.slice(0, 5) };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json().catch(() => ({}));
  for (const mobile of [true]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([k, s]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, s); }, [`sb-${REF}-auth-token`, session]);
    await ctx.routeWebSocket(/.*/, (ws) => ws.close());
    const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
    await ctx.route('**/*', async (r) => {
      const req = r.request(); const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
      if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
      if (u.host === SB && req.method() === 'GET') {
        if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
        if (/user_subscriptions/.test(u.pathname)) { if (STATE === 'failed') return r.abort('failed'); return row(r, { user_id: UID, role: 'free', trial_ends_at: null, status: 'inactive', billing_provider: null, plan: null, current_period_end: null }); }
        if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} });
      }
      if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
      return r.abort('failed');
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
    for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
    await page.waitForTimeout(4000);
    const sub = await page.evaluate(() => { const t = document.body.innerText; return /Couldn't load your subscription/.test(t) ? 'load-failed-card' : /Subscription/i.test(t) ? 'subscription-section-present' : 'no-subscription-text'; });
    const m = await page.evaluate(FIND);
    await page.screenshot({ path: `${OUT}/settings-390-${STATE}.png`, fullPage: true });
    console.log(JSON.stringify({ build: v.commit, state: STATE, subscriptionCard: sub, ...m }, null, 1));
    await ctx.close();
  }
} finally { await browser.close(); }
