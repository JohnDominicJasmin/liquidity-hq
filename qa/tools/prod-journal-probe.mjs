/* Step 8 probe on production: /journal with the trades read refused. Does History (after clicking it, if it is a tab)
 * show the load-failed message + retry? Control: same page with trades answered [] (empty) must NOT show it.
 * Same allowlist fence. usage: node prod-journal-probe.mjs <outdir>                                               */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BASE = 'https://liquidity-hq.com', REF = 'qdpwhnvmhqgzijuwopso', SB = `${REF}.supabase.co`, APP = 'liquidity-hq.com';
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const browser = await chromium.launch();
try {
  for (const mode of ['blocked', 'empty-control']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); }, [`sb-${REF}-auth-token`, session]);
    await ctx.routeWebSocket(/.*/, (ws) => ws.close());
    const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
    const seen = [];
    await ctx.route('**/*', async (r) => {
      const req = r.request(); const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
      if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"accepted":[],"rejected":[],"settings":{}}' }); }
      if (u.host === SB && req.method() === 'GET') {
        if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
        if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
        if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, watchlist: [], field_updated_at: {} });
        if (/trades/.test(u.pathname)) { seen.push(u.pathname + u.search.slice(0, 80)); if (mode === 'empty-control') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); }
      }
      return r.abort('failed');
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/journal', { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(5000);
    const tabs = await page.locator('button, [role="tab"]').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()).filter((t) => /history|log|open|stats|journal/i.test(t)).slice(0, 12));
    const hist = page.locator('button, [role="tab"]', { hasText: /^history/i }).first();
    let clicked = false; if (await hist.count()) { await hist.click().catch(() => {}); clicked = true; await page.waitForTimeout(3000); }
    const text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: `${OUT}/journal-${mode}.png`, fullPage: true });
    console.log(JSON.stringify({ mode, tradesReads: seen, tabs, historyClicked: clicked, failedMessage: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_FAILED), retry: text.includes(L.TRADE_JOURNAL_HISTORY_LOAD_RETRY), failedLabel: L.TRADE_JOURNAL_HISTORY_LOAD_FAILED, noTradesText: /no trades|nothing logged|no closed trades/i.test(text), snippet: text.slice(0, 0) }));
    await ctx.close();
  }
} finally { await browser.close(); }
