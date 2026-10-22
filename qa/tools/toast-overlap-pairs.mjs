/* #1460 / owner rejection 2026-10-01: the save message must overlap NEITHER the Ask AI button NOR the tab bar.
 * A prod 4936037 | B qa <head>, one run, warm-up first, same fence as the release pairs. Pages: /settings (click the
 * "4h" chip) and /arena (click the first enabled strategy chip) - both save through SettingsProvider, and the toast is
 * global (AppShell). Widths 390, 768, 1280, 1440, 1920. Measures the toast, the Ask AI button and the tab bar the
 * moment the toast is visible; overlap must be 0 px on B.
 * usage: node toast-overlap-pairs.mjs <outdir>                                                                   */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
/* B is the build under test: staging by default (PM 2026-10-01: the fix goes straight into staging, on top of 136c4722). */
const B_BASE = process.env.B_BASE || 'https://liquidity-hq-staging.onrender.com';
const BUILDS = [{ tag: 'A-prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: `B-${new URL(B_BASE).host.split('.')[0]}`, base: B_BASE, ref: 'wdtjhrilakoitfcezxpx' }].filter((b) => !process.env.ONLY || b.tag.startsWith(process.env.ONLY));
const WIDTHS = [[390, 844], [768, 1024], [1280, 800], [1440, 900], [1920, 1080]];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = [];

async function open(browser, b, w, h, state = 'saved', theme = 'dark') {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, t]) => { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session, theme]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } if (u.pathname === '/api/settings' && state === 'error') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA control: save refused"}' }); if (u.pathname === '/api/settings' && state === 'conflict') { const now = new Date().toISOString(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: f, settings: { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '2h', watchlist: [], field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) }); } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
      return r.abort('failed');
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
const MEASURE = () => {
  const box = (el) => { if (!el) return null; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return null; const b = el.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return null; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const toast = box(document.querySelector('.st-save-toast'));
  const fab = box(document.querySelector('[data-testid="grok-launcher"]') || document.querySelector('.gchat-fab') || [...document.querySelectorAll('button')].find((x) => /Ask AI/.test(x.textContent || '') && getComputedStyle(x).position === 'fixed'));
  const bar = box(document.querySelector('.tnav-tabs'));
  const top = box(document.querySelector('header.tnav') || document.querySelector('.tnav'));
  const hint = box(document.querySelector('[data-page-hint]'));
  const title = box([...document.querySelectorAll('h1, h2')].find((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.top >= 0 && b.top < innerHeight && !e.classList.contains('sr-only'); }));
  const ov = (a, c) => { if (!a || !c) return 0; const w = Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)); const h = Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y)); return w * h; };
  return { toast, fab, bar, top, hint, title, overlapTopPx2: ov(toast, top), overlapHintPx2: ov(toast, hint), overlapTitlePx2: ov(toast, title), toastRole: document.querySelector('.st-save-toast')?.getAttribute('role') ?? null, toastText: document.querySelector('.st-save-toast')?.textContent ?? null, overlapFabPx2: ov(toast, fab), overlapBarPx2: ov(toast, bar), toastAreaPx2: toast ? toast.w * toast.h : null, viewportH: innerHeight, viewportW: innerWidth };
};

const browser = await chromium.launch();
try {
  for (const b of BUILDS) { const c = await open(browser, b, 1280, 800); const p = await c.newPage(); await p.goto(b.base + '/settings', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(4000); await c.close(); }
  for (const b of BUILDS) {
    const v = await (await fetch(b.base + '/api/version')).json();
    const RUNS = []; for (const theme of ['dark', 'light']) for (const [w, h] of WIDTHS) { for (const st of ['saved', 'conflict', 'error']) RUNS.push(['/settings', w, h, st, theme]); RUNS.push(['/arena', w, h, 'saved', theme]); }
    for (const [page_, w, h, state, theme] of RUNS) {
      const ctx = await open(browser, b, w, h, state, theme); const page = await ctx.newPage();
      await page.goto(b.base + page_, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(page_ === '/arena' ? 4000 : 2000);
      const trigger = page_ === '/settings' ? page.locator('button', { hasText: /^4h$/ }).first() : page.locator('button.strat-chip:not(.blocked):not(.on)').first();
      const has = await trigger.count() > 0;
      let m = null;
      if (has) {
        await trigger.scrollIntoViewIfNeeded().catch(() => {}); await trigger.click().catch(() => {});
        const seen = await page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: state === 'error' ? 15000 : 8000 }).then(() => true).catch(() => false);
        if (seen && state === 'error') { await page.waitForFunction(() => /save|try/i.test(document.querySelector('.st-save-toast')?.textContent || '') && !/saving/i.test(document.querySelector('.st-save-toast')?.textContent || ''), null, { timeout: 15000 }).catch(() => {}); }
        if (seen) { await page.waitForTimeout(250); m = await page.evaluate(MEASURE); await page.screenshot({ path: `${OUT}/${page_.slice(1)}-${state}-${theme}-${String(w).padStart(4, '0')}--${b.tag}.png` }); }
        /* #1498 race: Saved must be gone by ~2s, Updated by ~4s; Couldn't save must still be up at 6s. Polled, not slept-and-sampled once. */
        if (seen) {
          m.dismiss = await page.evaluate(async () => {
            const t0 = performance.now(); let goneAt = null; let backAt = null;
            while (performance.now() - t0 < 8000) {
              const el = document.querySelector('.st-save-toast');
              if (!el && goneAt === null) goneAt = Math.round(performance.now() - t0);
              if (el && goneAt !== null && backAt === null) backAt = Math.round(performance.now() - t0);
              await new Promise((r) => setTimeout(r, 50));
            }
            const el = document.querySelector('.st-save-toast');
            return { goneAfterMs: goneAt, reappearedAtMs: backAt, presentAt8s: !!el, textAt8s: el?.textContent ?? null };
          });
        }
      }
      out.push({ build: b.tag, commit: v.commit, page: page_, state, theme, width: w, triggerFound: has, ...(m ?? { toast: null }) });
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/overlap.json`, JSON.stringify(out, null, 1)); for (const o of out) console.log(JSON.stringify({ b: o.build, c: o.commit, p: o.page, s: o.state, th: o.theme, w: o.width, role: o.toastRole, ovTop: o.overlapTopPx2, ovHint: o.overlapHintPx2, ovTitle: o.overlapTitlePx2, text: o.toastText, toast: o.toast && `${o.toast.x},${o.toast.y} ${o.toast.w}x${o.toast.h}`, fab: o.fab && `${o.fab.x},${o.fab.y} ${o.fab.w}x${o.fab.h}`, bar: o.bar && `y${o.bar.y}`, ovFab: o.overlapFabPx2, ovBar: o.overlapBarPx2, gone: o.dismiss?.goneAfterMs ?? null, at8s: o.dismiss?.presentAt8s ?? null })); }
