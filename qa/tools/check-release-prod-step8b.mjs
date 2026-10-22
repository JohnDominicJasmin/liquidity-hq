/* Release #1487 (v2026.10.01) on PRODUCTION: How to test steps 4, 5, 7, 8, 11, and the 404 page console.
 * READ-ONLY. No sign-in: a synthetic session in localStorage, the account reads answered in the browser.
 * ALLOWLIST: only the app's own host is let through, and only GET/HEAD to it; every write to it is answered
 * locally. The production Supabase host is answered locally for the named tables and refused for everything
 * else (every non-GET refused). Every other host refused. WebSockets closed. Nothing is written anywhere.
 * Steps 9 and 10 are not here: 9 needs a hypothesis with evidence, 10 needs two real sessions.
 * usage: node check-release-prod.mjs https://liquidity-hq.com qdpwhnvmhqgzijuwopso                         */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2].replace(/\/$/, '');
const REF = process.argv[3];
const SB_HOST = `${REF}.supabase.co`;
const APP_HOST = new URL(BASE).host;
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const fence = { blocked: new Set(), writes: new Set() };

async function open(browser, { signedIn, width = 1280, height = 900, blockTrades = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  if (signedIn) await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('theme', 'dark'); }, [`sb-${REF}-auth-token`, session]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP_HOST) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      fence.writes.add(`${req.method()} ${u.pathname}`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":["default_tf"],"rejected":[],"settings":{}}' });
    }
    if (u.host === SB_HOST && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      if (/trades/.test(u.pathname) && !blockTrades) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    fence.blocked.add(u.host === SB_HOST ? `${req.method()} ${u.pathname}` : u.host);
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 90)));
  return { ctx, page, errors };
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const out = (o) => console.log(JSON.stringify(o));

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  out({ part: 'served', at: new Date().toISOString(), commit: v.commit, branch: v.branch, proBuyable: v.configured?.proBuyable });

  // Step 8: the journal with its trades read failing shows a retry, never "no trades".
  {
    const s = await open(browser, { signedIn: true, blockTrades: true });
    await s.page.goto(BASE + '/journal', { waitUntil: 'load', timeout: 120_000 });
    await settle(s.page);
    await s.page.waitForTimeout(3000);
    await s.page.locator('[data-testid="journal-tab"]').nth(1).click();
    const samples=[];for(const w of [2000,5000,10000]){await s.page.waitForTimeout(w);samples.push(await s.page.evaluate(()=>{const tabs=document.querySelector('[data-testid=journal-tab].on');const main=document.querySelector('main')||document.body;return (tabs?tabs.textContent:'')+' | '+main.innerText.replace(/s+/g,' ').slice(0,260)}));}
    console.log(JSON.stringify(samples));
    const text = await s.page.evaluate(() => document.body.innerText);
    out({ step: '8 journal History tab, trades read fails', emptyStateShown: text.includes(L.TRADE_JOURNAL_HISTORY_EMPTY_TITLE), failedMessage: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_FAILED), retry: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_RETRY), pageErrors: s.errors });
    await s.ctx.close();
  }

  out({ part: 'fence', blocked: [...fence.blocked].sort(), writesAnsweredLocally: [...fence.writes].sort() });
} finally { await browser.close(); }
