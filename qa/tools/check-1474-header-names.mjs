/* #1474: the phone-width header name (.tnav-mbrand) on every page route, and hydration errors on unknown URLs,
 * including unknown URLs UNDER a named route. Run before and after the fix on the same host.
 *
 * No sign-in. Signed-in pages use a synthetic session in localStorage; account reads answered in the browser.
 * ALLOWLIST: only the app's own host is let through (GET/HEAD only; any write to it is answered locally).
 * Supabase project: named tables answered locally, all else refused. Every other host refused. WebSockets closed.
 *
 * usage: node check-1474-header-names.mjs <base>                                                            */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';

const BASE = process.argv[2].replace(/\/$/, '');
const APP_HOST = new URL(BASE).host;
const SB_HOST = 'wdtjhrilakoitfcezxpx.supabase.co';
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });

const SIGNED_OUT = ['/', '/ko', '/zh', '/login', '/forgot-password', '/reset-password', '/auth/callback', '/about', '/faq', '/terms', '/privacy', '/refund', '/disclaimer', '/learn', '/offline'];
const SIGNED_IN = ['/dashboard', '/arena', '/scanner', '/funding', '/journal', '/briefing', '/markets', '/liq', '/correlation', '/research', '/calc', '/econ-calendar', '/alerts', '/hours', '/playbook', '/news', '/settings', '/upgrade', '/admin', '/learn', '/offline'];
const UNKNOWN = ['/zz-not-a-page', '/ar', '/arena/zz-not-a-page', '/faq/old-page', '/settings/x', '/dashboard/zz', '/ops/zz-not-a-page'];

async function open(browser, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const blocked = new Set();
  const appWrites = [];
  if (signedIn) await ctx.addInitScript(([v]) => { localStorage.setItem('sb-wdtjhrilakoitfcezxpx-auth-token', v); localStorage.setItem('theme', 'dark'); }, [session]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      appWrites.push(`${req.method()} ${u.pathname}`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":[],"rejected":[],"settings":{}}' });
    }
    if (u.host === SB_HOST && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
    }
    blocked.add(u.host === SB_HOST ? `${req.method()} ${u.host}${u.pathname}` : u.host);
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 60)));
  return { ctx, page, errors, blocked, appWrites };
}

const browser = await chromium.launch();
const allBlocked = new Set();
const allWrites = new Set();
try {
  const version = await (await fetch(BASE + '/api/version')).json();
  console.log(JSON.stringify({ part: 'served', at: new Date().toISOString(), base: BASE, commit: version.commit, branch: version.branch }));
  const passes = [['signed out', false, SIGNED_OUT], ['synthetic free', true, SIGNED_IN], ['signed out', false, UNKNOWN]];
  for (const [who, signedIn, paths] of passes) {
    for (const p of paths) {
      const s = await open(browser, signedIn);
      const res = await s.page.goto(BASE + p, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
      const html = res ? await res.text().catch(() => '') : '';
      const serverName = (html.match(/class="tnav-mbrand"[^>]*>([^<]*)</) || [])[1] ?? null;
      await s.page.waitForTimeout(3000);
      const shownName = await s.page.evaluate(() => { const el = document.querySelector('.tnav-mbrand'); return el ? el.textContent : null; });
      console.log(JSON.stringify({ who, path: p, status: res?.status() ?? null, landedOn: s.page.url().replace(BASE, ''), serverName, shownName, hydrationErrors: s.errors.filter((e) => /#418|#423|#425|Hydration|hydrat/i.test(e)).length, otherErrors: s.errors.filter((e) => !/#418|#423|#425|Hydration|hydrat/i.test(e)) }));
      s.blocked.forEach((b) => allBlocked.add(b));
      s.appWrites.forEach((w) => allWrites.add(w));
      await s.ctx.close();
    }
  }
  console.log(JSON.stringify({ part: 'fence', blockedRequests: [...allBlocked].sort(), appWritesAnsweredLocally: [...allWrites].sort() }));
} finally { await browser.close(); }
