/* Set 3 for the owner: visible changes that only appear in a STATE. A prod 4936037 | B qa 136c472, one run, same
 * harness as the pairs (synthetic Free session, app GETs through, every app write answered locally, named Supabase
 * reads answered locally, other Supabase refused, market data through, everything else refused). Warm-up first.
 * States are produced by answering the app's own requests, never by editing the page:
 *   1 tour        user_onboarding.tour_seen = false -> /dashboard, every tour step, 1280 and 390   (#1459)
 *   2 toast       /settings at 390, click the 4h chip, the save message                             (#1460)
 *   3 journal     /journal History with the trades read refused, after the retry window             (#1448)
 *   4 research    GET /api/hypotheses answered with one row; its evidence read answered 500        (#1346)
 *   5 conflict    the settings save answered as the server answers a lost write: rejected:[field],
 *                 with the other device's value in `settings` (exactly the route's own response shape) (#1292)
 * usage: node shots-set3-states.mjs <outdir>                                                                  */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const BUILDS = [{ tag: 'A-prod-4936037', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: 'B-qa-136c472', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' }];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const SETTINGS_ROW = { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} };
const log = [];

async function open(browser, b, { width, height, tourSeen = true, conflict = false }) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      if (conflict && u.pathname === '/api/settings') {
        const now = new Date().toISOString();
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: f, settings: { ...SETTINGS_ROW, default_tf: '2h', field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: tourSeen, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, SETTINGS_ROW);
      return r.abort('failed'); // includes the trades read: refused
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const shot = (page, b, name) => page.screenshot({ path: `${OUT}/${name}--${b.tag}.png` });

const browser = await chromium.launch();
try {
  for (const b of BUILDS) { const c = await open(browser, b, { width: 1280, height: 800 }); const p = await c.newPage(); await p.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(5000); await c.close(); }
  for (const b of BUILDS) {
    const v = await (await fetch(b.base + '/api/version')).json();
    log.push({ build: b.tag, commit: v.commit });
    // 1 tour
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      const ctx = await open(browser, b, { width: w, height: h, tourSeen: false }); const page = await ctx.newPage();
      await page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2500);
      let steps = 0;
      for (let i = 1; i <= 8; i++) {
        const dlg = page.locator('[role="dialog"]').filter({ hasText: new RegExp(`${L.SPOTLIGHT_TOUR_NEXT_BTN}|${L.SPOTLIGHT_TOUR_OPEN_ARENA_BTN}`) }).first();
        if (!(await dlg.isVisible().catch(() => false))) break;
        steps = i; await shot(page, b, `1-tour-${w}-step${i}`);
        const next = dlg.getByRole('button', { name: L.SPOTLIGHT_TOUR_NEXT_BTN });
        if (!(await next.isVisible().catch(() => false))) break; // last step: "open Arena" - not clicked
        await next.click(); await page.waitForTimeout(1200);
      }
      log.push({ build: b.tag, state: 'tour', width: w, stepsShown: steps });
      await ctx.close();
    }
    // 2 toast at 390
    { const ctx = await open(browser, b, { width: 390, height: 844 }); const page = await ctx.newPage();
      await page.goto(b.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2000);
      const chip = page.locator('button', { hasText: /^4h$/ }).first(); await chip.scrollIntoViewIfNeeded(); await chip.click();
      const seen = await page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      const geo = await page.evaluate(() => ({ toastBottom: Math.round(document.querySelector('.st-save-toast')?.getBoundingClientRect().bottom ?? -1), toastTop: Math.round(document.querySelector('.st-save-toast')?.getBoundingClientRect().top ?? -1), barTop: Math.round(document.querySelector('.tnav-tabs')?.getBoundingClientRect().top ?? -1) }));
      await shot(page, b, '2-settings-save-toast-390'); log.push({ build: b.tag, state: 'toast', seen, ...geo }); await ctx.close(); }
    // 3 journal history, trades read refused
    { const ctx = await open(browser, b, { width: 1280, height: 800 }); const page = await ctx.newPage();
      await page.goto(b.base + '/journal', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2000);
      await page.locator('[data-testid="journal-tab"]').nth(1).click(); await page.waitForTimeout(20000);
      const t = await page.evaluate(() => document.body.innerText);
      await shot(page, b, '3-journal-history-trades-read-refused-1280');
      log.push({ build: b.tag, state: 'journal', failedMsg: t.includes(L.TRADE_JOURNAL_HISTORY_LOAD_FAILED), emptyState: t.includes(L.TRADE_JOURNAL_HISTORY_EMPTY_TITLE) }); await ctx.close(); }
    // 4 research evidence failure
    { const ctx = await open(browser, b, { width: 1280, height: 800 }); const page = await ctx.newPage();
      const HYP = { id: 'qa-hyp-1', title: 'QA control hypothesis', hypothesis: 'BTC holds 80k through the week', acceptance_criteria: ['Daily close above 80k'], status: 'active', grok_verdict: null, grok_reasoning: null, grok_evidence_assessment: null, grok_confidence: null, grok_next_check: null, grok_last_run: null, target_date: null, created_at: new Date().toISOString() };
      await page.route('**/api/hypotheses', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hypotheses: [HYP] }) }) : r.fallback());
      await page.route('**/api/hypotheses/qa-hyp-1/evidence', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA control: evidence read refused"}' }) : r.fallback());
      await page.goto(b.base + '/research', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(3000);
      const card = page.getByText('QA control hypothesis').first(); const found = await card.isVisible().catch(() => false);
      if (found) { await card.scrollIntoViewIfNeeded(); await card.click(); await page.waitForTimeout(3000); }
      const t = await page.evaluate(() => document.body.innerText);
      await shot(page, b, '4-research-evidence-read-refused-1280');
      log.push({ build: b.tag, state: 'research', hypothesisShown: found, errorMsg: t.includes(L.HYPOTHESIS_TRACKER_EVIDENCE_ERROR ?? '__none__'), emptyMsg: /No evidence logged yet/i.test(t) }); await ctx.close(); }
    // 5 conflict notice
    { const ctx = await open(browser, b, { width: 1280, height: 800, conflict: true }); const page = await ctx.newPage();
      await page.goto(b.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2000);
      const chip = page.locator('button', { hasText: /^4h$/ }).first(); await chip.scrollIntoViewIfNeeded(); await chip.click();
      await page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      const toast = await page.locator('.st-save-toast').first().innerText().catch(() => null);
      await shot(page, b, '5-settings-conflict-1280');
      log.push({ build: b.tag, state: 'conflict', toastText: toast }); await ctx.close(); }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1)); for (const l of log) console.log(JSON.stringify(l)); }
