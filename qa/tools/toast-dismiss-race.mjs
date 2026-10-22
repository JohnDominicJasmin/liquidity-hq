/* Does "Saved" / "Updated from another device" auto-dismiss on c1f129b1? Subagent a15b9842 traced a race on the old
 * toast: SettingsProvider resets saveStatus to idle at 2000ms, the toast's own hide timer also runs; if idle lands
 * first, the effect cleanup cancels the toast timer. c1f129b1's idle branch keeps 'saved'/'conflict'.
 * Polls the toast every 100ms for 9s after it first shows and records when (if) it goes.
 * usage: BASE=http://localhost:3100 REF=wdtjhrilakoitfcezxpx RUNS=6 node toast-dismiss-race.mjs <outdir>        */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3100';
const REF = process.env.REF || 'wdtjhrilakoitfcezxpx';
const N = Number(process.env.RUNS || 6);
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function open(browser, state, w, h, sendTz) {
  const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      if (u.pathname === '/api/settings' && state === 'conflict') { const now = new Date().toISOString(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: f, settings: { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '2h', timezone: TZ, watchlist: [], field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {}, ...(sendTz ? {} : { timezone: TZ }) });
      return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}

const browser = await chromium.launch();
const out = [];
try {
  { const c = await open(browser, 'saved', 1280, 800, false); const p = await c.newPage(); for (const pth of ['/settings', '/dashboard']) { await p.goto(BASE + pth, { waitUntil: 'load', timeout: 300_000 }).catch(() => {}); await p.waitForTimeout(6000); } await c.close(); }
  const PLAN = [];
  for (let i = 0; i < N; i++) for (const state of ['saved', 'conflict']) { PLAN.push({ page: '/settings', state, w: 1280, h: 800, i }); PLAN.push({ page: '/settings', state, w: 390, h: 844, i }); }
  for (let i = 0; i < N; i++) PLAN.push({ page: '/dashboard', state: 'saved', w: 1280, h: 800, i, tz: true });
  for (const run of PLAN) {
    const ctx = await open(browser, run.state, run.w, run.h, !!run.tz); const page = await ctx.newPage();
    await page.goto(BASE + run.page, { waitUntil: 'load', timeout: 300_000 });
    await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(run.tz ? 500 : 2500);
    if (!run.tz) { const btn = page.locator('button', { hasText: /^4h$/ }).first(); if (await btn.count()) { await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click().catch(() => {}); } }
    const trace = await page.evaluate(async () => {
      const t0 = performance.now(); const seq = []; let last = null;
      while (performance.now() - t0 < 15000) {
        const el = document.querySelector('.st-save-toast');
        const cur = el ? `${el.className}|${el.getAttribute('role')}|${el.textContent}` : null;
        if (cur !== last) { seq.push({ ms: Math.round(performance.now() - t0), toast: cur }); last = cur; }
        await new Promise((r) => setTimeout(r, 50));
      }
      return seq;
    });
    const shownAt = trace.find((s) => s.toast && !/saving/i.test(s.toast));
    const goneAfter = shownAt ? trace.find((s) => s.ms > shownAt.ms && s.toast === null) : null;
    const res = { ...run, finalToast: trace[trace.length - 1]?.toast ?? null, shownMs: shownAt?.ms ?? null, dismissedAfterMs: goneAfter && shownAt ? goneAfter.ms - shownAt.ms : null, trace };
    out.push(res);
    if (res.finalToast) await page.screenshot({ path: `${OUT}/stuck-${run.page.slice(1)}-${run.state}-${run.w}-${run.i}.png` });
    console.log(JSON.stringify({ p: run.page, s: run.state, w: run.w, i: run.i, shown: res.shownMs, dismissedAfter: res.dismissedAfterMs, stuck: res.finalToast }));
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/dismiss-race.json`, JSON.stringify(out, null, 1)); }
