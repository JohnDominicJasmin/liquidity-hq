/* Release gate on qa 1c81138: toast states (saved/conflict/error) at 390 + 1280 dark, saved at 1280 light; #1502 headline
 * lines on / /ko /zh at 1280 + 390; dashboard grid at 1280 + 390. Same allowlist fence as toast-overlap-pairs.mjs.
 * usage: node qa-verify-1c81138.mjs <outdir>                                                                       */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BASE = 'https://liquidity-hq-qa.onrender.com', REF = 'wdtjhrilakoitfcezxpx';
const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
const UID = '00000000-0000-4000-8000-00000000fa4e';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = []; const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function open(browser, { w, h, signedIn = true, state = 'saved', theme = 'dark' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, t, si]) => { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, theme, signedIn]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  const st = { state };
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      if (u.pathname === '/api/settings' && st.state === 'error') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA control"}' });
      if (u.pathname === '/api/settings' && st.state === 'conflict') { const now = new Date().toISOString(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: f, settings: { user_id: UID, default_tf: '2h', timezone: TZ, watchlist: [], field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (/user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} });
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return { ctx, st };
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(600); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const GEO = () => {
  const box = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom), h: Math.round(b.height) } : null; };
  const ov = (a, c) => (a && c ? Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y)) : 0);
  const el = document.querySelector('.st-save-toast'); const t = box(el);
  const fab = box(document.querySelector('[data-testid="grok-launcher"]') || document.querySelector('.gchat-fab'));
  const bar = box(document.querySelector('.tnav-tabs')); const top = box(document.querySelector('header.tnav') || document.querySelector('.tnav'));
  const btns = el ? [...el.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) })) : [];
  return { text: el?.textContent, cls: el?.className, role: el?.getAttribute('role'), live: el?.getAttribute('aria-live'), bg: el && getComputedStyle(el).backgroundColor, ovFab: ov(t, fab), ovBar: ov(t, bar), ovTop: ov(t, top), centred: t ? Math.round((t.x + t.r) / 2 - innerWidth / 2) : null, btns };
};
const POLL = async (ms) => { const t0 = performance.now(); let gone = null; while (performance.now() - t0 < ms) { if (!document.querySelector('.st-save-toast') && gone === null) gone = Math.round(performance.now() - t0); await new Promise((r) => setTimeout(r, 50)); } return { goneAfterMs: gone, presentAtEnd: !!document.querySelector('.st-save-toast') }; };

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json(); log({ served: v.commit, branch: v.branch });
  { const { ctx } = await open(browser, { w: 1280, h: 800 }); const p = await ctx.newPage(); await p.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(3000); await ctx.close(); }
  // 1. toast
  const RUNS = [];
  for (const w of [390, 1280]) for (const s of ['saved', 'conflict', 'error']) RUNS.push({ w, s, theme: 'dark' });
  RUNS.push({ w: 1280, s: 'saved', theme: 'light' }, { w: 390, s: 'error', theme: 'light' });
  for (const R of RUNS) {
    const h = R.w < 500 ? 844 : 800;
    const { ctx, st } = await open(browser, { w: R.w, h, state: R.s, theme: R.theme }); const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2500);
    const chip = page.locator('button', { hasText: /^4h$/ }).first();
    if (!(await chip.isVisible().catch(() => false))) { log({ step: 'toast', ...R, error: 'no 4h chip' }); await ctx.close(); continue; }
    await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {});
    const want = R.s === 'error' ? 'alert' : 'status';
    await page.waitForFunction((rl) => { const e = document.querySelector('.st-save-toast'); return e && e.getAttribute('role') === rl && !/saving/i.test(e.textContent || ''); }, want, { timeout: R.s === 'error' ? 20_000 : 8_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const g = await page.evaluate(GEO);
    await page.screenshot({ path: `${OUT}/toast-${R.s}-${R.theme}-${R.w}.png` });
    const d = await page.evaluate(POLL, R.s === 'error' ? 10_000 : 6_000);
    let retry = null;
    if (R.s === 'error' && R.theme === 'dark') {
      st.state = 'saved';
      const tryBtn = page.locator('.st-save-toast button', { hasText: /try again/i }).first();
      if (await tryBtn.isVisible().catch(() => false)) {
        await tryBtn.click();
        const ok = await page.waitForFunction(() => /saved/i.test(document.querySelector('.st-save-toast')?.textContent || ''), null, { timeout: 15_000 }).then(() => true).catch(() => false);
        const d2 = ok ? await page.evaluate(POLL, 5000) : null;
        retry = { savedAfterRetry: ok, then: d2 };
      }
    }
    let closeWorks = null;
    if (R.s === 'error' && R.theme === 'light') { const x = page.locator('.st-save-toast-close').first(); if (await x.isVisible().catch(() => false)) { await x.click(); await page.waitForTimeout(300); closeWorks = !(await page.locator('.st-save-toast').count()); } }
    const pass = g.ovFab === 0 && g.ovBar === 0 && g.ovTop === 0 && g.role === want && (R.s === 'error' ? d.presentAtEnd : !d.presentAtEnd) && (!retry || (retry.savedAfterRetry && retry.then && !retry.then.presentAtEnd)) && (closeWorks !== false) && (R.s !== 'error' || R.w > 500 || g.btns.every((b) => b.h >= 44));
    log({ step: 'toast', ...R, pass, geo: g, dismiss: d, retry, closeWorks });
    await ctx.close();
  }
  // 2. headline
  for (const path of ['/', '/ko', '/zh']) for (const [w, h] of [[1280, 800], [390, 844]]) {
    const { ctx } = await open(browser, { w, h, signedIn: false }); const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(2500);
    const lines = await page.evaluate(() => {
      const h1 = document.querySelector('.lp-hero-h1') || document.querySelector('h1'); if (!h1) return null;
      const res = []; for (const node of [...h1.childNodes]) {
        const el = node.nodeType === 1 ? node : null; const textNode = el ? el.firstChild : node; if (!textNode || !textNode.textContent.trim()) continue;
        const range = document.createRange(); const txt = textNode.textContent; let cur = ''; let lastTop = null; const ls = [];
        for (let i = 0; i < txt.length; i++) { range.setStart(textNode, i); range.setEnd(textNode, i + 1); const r = range.getClientRects()[0]; const top = r ? Math.round(r.top) : lastTop; if (lastTop !== null && top !== null && Math.abs(top - lastTop) > 4) { ls.push(cur.trim()); cur = ''; } cur += txt[i]; if (top !== null) lastTop = top; }
        ls.push(cur.trim()); res.push({ part: el ? 'accent' : 'line1', lines: ls });
      } return { cls: h1.className, parts: res };
    });
    await page.screenshot({ path: `${OUT}/headline${path === '/' ? '-en' : path.replace('/', '-')}-${w}.png` });
    log({ step: 'headline', path, w, lines });
    await ctx.close();
  }
  // 3. dashboard grid
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const { ctx } = await open(browser, { w, h }); const page = await ctx.newPage();
    await page.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(6000);
    const g = await page.evaluate(() => ({ cols: document.querySelector('.dashboard-grid') && getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }));
    await page.screenshot({ path: `${OUT}/dashboard-${w}.png` });
    log({ step: 'dashboard', w, ...g });
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1)); }
