/* qa, after #1434 went static: do pages still RENDER, and what does the Arena timeframe clamp do (#1263)?
 *
 * No sign-in. Synthetic session in localStorage only; the account reads are answered in the browser.
 * ALLOWLIST, not a name pattern: only the app's own host is let through. The Supabase project host is
 * answered locally (named tables) or refused (everything else, and every non-GET). Every other host is
 * aborted and recorded. WebSockets are closed and recorded. Nothing is written anywhere.
 *
 * usage: node check-1434-1263-qa.mjs <base> [static] [clamp]                                           */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';

const BASE = process.argv[2].replace(/\/$/, '');
const PARTS = process.argv.slice(3);
const APP_HOST = new URL(BASE).host;
const SB_HOST = 'wdtjhrilakoitfcezxpx.supabase.co';
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One isolated browser context with the allowlist installed. `account` null = signed out. */
async function open(browser, account) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const blocked = new Set();
  const sockets = new Set();
  const appWrites = [];
  if (account) await ctx.addInitScript(([v]) => { localStorage.setItem('sb-wdtjhrilakoitfcezxpx-auth-token', v); localStorage.setItem('theme', 'dark'); }, [session]);
  await ctx.routeWebSocket(/.*/, (ws) => { sockets.add(new URL(ws.url()).host); ws.close(); });
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      // The app's own API: no write from a synthetic account is allowed to reach it.
      appWrites.push(`${req.method()} ${u.pathname}`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":[],"rejected":[],"settings":{}}' });
    }
    if (u.host === SB_HOST) {
      if (req.method() !== 'GET') { blocked.add(`${req.method()} ${u.host}${u.pathname}`); return r.abort('failed'); }
      if (account && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (account && /user_subscriptions/.test(u.pathname)) { if (account.planDelayMs) await sleep(account.planDelayMs); return row(r, { user_id: UID, role: account.role, trial_ends_at: null }); }
      if (account && /user_settings/.test(u.pathname)) { if (account.settingsDelayMs) await sleep(account.settingsDelayMs); if (account.noSettingsRow) return (req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? r.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }) }) : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: account.defaultTf ?? null, watchlist: [], field_updated_at: {} }); }
      blocked.add(`GET ${u.host}${u.pathname}`);
      return r.abort('failed');
    }
    blocked.add(u.host);
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
  return { ctx, page, errors, report: () => ({ blockedHosts: [...blocked].sort(), socketsClosed: [...sockets].sort(), appWritesAnsweredLocally: appWrites }) };
}

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) {
    const decline = page.getByRole('button', { name: 'Decline' });
    await page.waitForTimeout(700);
    if (await decline.isVisible().catch(() => false)) await decline.click().catch(() => {});
  }
}

const browser = await chromium.launch();
try {
  const version = await (await fetch(BASE + '/api/version')).json();
  console.log(JSON.stringify({ part: 'served', at: new Date().toISOString(), base: BASE, commit: version.commit, branch: version.branch }));

  if (PARTS.includes('static')) {
    // Signed out: the prerendered public pages, and what an unknown URL shows.
    for (const path of ['/', '/ko', '/zh', '/faq', '/about', '/terms', '/zz-not-a-page', '/ar']) {
      const s = await open(browser, null);
      const res = await s.page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
      await s.page.waitForTimeout(2500);
      const d = await s.page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 70)), textLength: document.body.innerText.length, appError: /Application error|Internal Server Error/i.test(document.body.innerText), homeLinks: [...document.querySelectorAll('a[href="/"], a[href="/dashboard"]')].length }));
      console.log(JSON.stringify({ part: 'static', signedIn: false, path, status: res?.status() ?? 'no response', cacheControl: res?.headers()['cache-control'] ?? null, landedOn: s.page.url().replace(BASE, ''), ...d, pageErrors: s.errors, ...s.report() }));
      await s.ctx.close();
    }
    // Signed in (synthetic Free): the app pages are prerendered shells now - do they still fill in?
    for (const path of ['/dashboard', '/arena', '/alerts', '/settings', '/news', '/upgrade', '/backtest']) {
      const s = await open(browser, { role: 'free', defaultTf: '1h' });
      const res = await s.page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
      await settle(s.page);
      await s.page.waitForTimeout(2500);
      const d = await s.page.evaluate(() => ({ title: document.title, h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 70)), textLength: document.body.innerText.length, appError: /Application error|Internal Server Error/i.test(document.body.innerText), stuckOnLoading: document.querySelectorAll('.obw-root.obw-loading').length, navTabs: document.querySelectorAll('.tnav-tabs a, nav a').length, buttons: document.querySelectorAll('button').length, upgradeButtons: [...document.querySelectorAll('a, button')].map((b) => b.textContent.trim()).filter((t) => /pay with crypto|coming soon|upgrade to pro|get pro/i.test(t)).slice(0, 8) }));
      console.log(JSON.stringify({ part: 'static', signedIn: 'synthetic free', path, status: res?.status() ?? 'no response', landedOn: s.page.url().replace(BASE, ''), ...d, pageErrors: s.errors, ...s.report() }));
      await s.ctx.close();
    }
  }

  if (PARTS.includes('clamp')) {
    /* #1263. The Arena writes its timeframe into the URL (?tf=), so the URL is the reading.
       Each case three times: a race is a claim about ordering, and one sample of it is not a measurement. */
    const CASES = [
      { name: 'A. Pro, saved default 5m, PLAN read slow (2s)', account: { role: 'pro', defaultTf: '5m', planDelayMs: 2000 }, path: '/arena', want: '5m' },
      { name: 'B. Pro, saved default 5m, SETTINGS read slow (2s) - the other ordering', account: { role: 'pro', defaultTf: '5m', settingsDelayMs: 2000 }, path: '/arena', want: '5m' },
      { name: 'C. Pro, settings row with NO default timeframe, plan read slow (2s)', account: { role: 'pro', planDelayMs: 2000 }, path: '/arena', want: 'PR says 15m; lib/settings.ts default is 1h' },
      { name: 'C2. Pro, NO settings row at all, plan read slow (2s)', account: { role: 'pro', noSettingsRow: true, planDelayMs: 2000 }, path: '/arena', want: 'PR says 15m; lib/settings.ts default is 1h' },
      { name: 'C3. Pro, NO settings row at all, nothing slow', account: { role: 'pro', noSettingsRow: true }, path: '/arena', want: 'PR says 15m; lib/settings.ts default is 1h' },
      { name: 'D. Pro, opened on ?tf=1m, plan read slow (2s)', account: { role: 'pro', defaultTf: '1h', planDelayMs: 2000 }, path: '/arena?tf=1m', want: '1m' },
      { name: 'E. CONTROL Free, opened on ?tf=5m, plan read slow (2s)', account: { role: 'free', defaultTf: '1h', planDelayMs: 2000 }, path: '/arena?tf=5m', want: '1h' },
      { name: 'F. CONTROL Free, saved default 5m, nothing slow', account: { role: 'free', defaultTf: '5m' }, path: '/arena', want: '1h' },
    ];
    for (const c of CASES) {
      const runs = [];
      let last;
      for (let i = 0; i < 3; i++) {
        const s = await open(browser, c.account);
        await s.page.goto(BASE + c.path, { waitUntil: 'load', timeout: 120_000 });
        const timeline = [];
        for (const at of [500, 1500, 3000, 6000]) {
          await s.page.waitForTimeout(at - (timeline.length ? [500, 1500, 3000, 6000][timeline.length - 1] : 0));
          timeline.push(`${at}ms=${new URL(s.page.url()).searchParams.get('tf')}`);
        }
        runs.push({ endedOn: new URL(s.page.url()).searchParams.get('tf'), timeline: timeline.join(' '), pageErrors: s.errors.length });
        last = s.report();
        await s.ctx.close();
      }
      console.log(JSON.stringify({ part: 'clamp', case: c.name, opened: c.path, correct: c.want, endedOn: runs.map((r) => r.endedOn), allCorrect: runs.every((r) => r.endedOn === c.want), runs, ...last }));
    }
  }
} finally { await browser.close(); }
