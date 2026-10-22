/* Release PR #1676 "How to test" on PRODUCTION, the parts QA can check without a real account (PM, 2026-10-22: option a).
 * Step 3: signed out, 8 pages at 1280 and 390: status, error-boundary text, sideways scroll (document scrollWidth vs the requested width).
 * Step 4, stub half: a synthetic Pro session (lib.mjs: fake token, plan row answered locally, nothing reaches prod Supabase), the 3 Arena Ask buttons:
 *   the click makes 0 POSTs to /api/grok*, the chat opens prefilled; Send makes exactly one POST /api/grok-chat, ANSWERED LOCALLY (lib.mjs answers every
 *   app write), so no AI call is made. The paid AI GETs (macro-context, dry-powder, onchain) are answered locally too, so no AI spend on a GET.
 * The real answer, the Quick read (step 5) and the alerts list (step 6) are PM's, signed in. usage: node prod-1676.mjs [3|4|all] */
import { chromium, open, settle, sleep, PROD, OUT, jlog } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const which = process.argv[2] || 'all';
const DIR = `${OUT}/prod-1676`; mkdirSync(DIR, { recursive: true });
const log = jlog('prod-1676.json');
const PAID_GET = /^\/api\/(macro-context|dry-powder|onchain)(\/|$)/;
const appStub = async (r, req, u) => {
  if ((req.method() === 'GET' || req.method() === 'HEAD') && PAID_GET.test(u.pathname)) {
    await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'qa-fence: paid AI GET not called', qaLocal: true }) }); return true;
  }
  return false;
};
const BOUNDARY = /Something went wrong|Application error|client-side exception|This page could not be found|Internal Server Error|Unhandled Runtime Error/i;
const browser = await chromium.launch();
try {
  log.say({ build: (await (await fetch(PROD.base + '/api/version')).json()).commit, at: new Date().toISOString() });
  if (which === '3' || which === 'all') {
    for (const w of [1280, 390]) for (const p of ['/dashboard', '/arena', '/briefing', '/news', '/liq', '/funding', '/learn', '/upgrade']) {
      const ctx = await open(browser, { b: PROD, w, signedIn: false, appStub }); const page = await ctx.newPage();
      const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
      const res = await page.goto(PROD.base + p, { waitUntil: 'load', timeout: 90_000 }).catch((e) => ({ status: () => `ERR ${String(e).slice(0, 80)}` }));
      await sleep(8000); await settle(page);
      const m = await page.evaluate((W) => {
        const t = document.body?.innerText ?? ''; const de = document.documentElement;
        return { url: location.pathname, sw: Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0), over: Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0) > W, textLen: t.length, text: t };
      }, w);
      const boundary = BOUNDARY.exec(m.text)?.[0] ?? null;
      await page.screenshot({ path: `${DIR}/s3-${p.replace(/\W+/g, '') || 'root'}-${w}.jpg`, type: 'jpeg', quality: 65 });
      const pass = res.status() === 200 && !boundary && !m.over && perr.length === 0;
      log.say({ step: 3, page: p, w, status: res.status(), finalUrl: m.url, boundary, scrollWidth: m.sw, pageErrors: perr, textLen: m.textLen, verdict: pass ? 'PASS' : 'CHECK' });
      await ctx.close();
    }
  }
  if (which === '4' || which === 'all') {
    const BUTTONS = [
      { label: 'arena page "Ask LiquidityAI"', find: (pg) => pg.locator('button').filter({ hasText: /^Ask LiquidityAI$/ }).first() },
      { label: 'chart panel "ASK AI"', find: (pg) => pg.locator('button').filter({ hasText: /^ASK AI$/ }).first() },
      { label: 'EMA signal "Explain signal"', find: (pg) => pg.locator('button').filter({ hasText: /^Explain signal$/ }).first() },
    ];
    for (const b of BUTTONS) {
      const rec = []; const ctx = await open(browser, { b: PROD, w: 1280, plan: 'pro', rec, appStub, liveWs: true }); const page = await ctx.newPage();
      await page.goto(PROD.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 90_000 }); await sleep(10_000); await settle(page);
      const posts = (from) => rec.slice(from).filter((n) => n.m === 'POST' && /^\/api\/grok/.test(n.p)).map((n) => `POST ${n.p.replace(/\?.*$/, '')} [${n.br}]`);
      const btn = b.find(page); const found = (await btn.count()) > 0;
      let onClick = [], onSend = [], prefilled = '', panelOpen = false;
      if (found) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        const c0 = rec.length; await btn.click({ timeout: 8000 }); await sleep(6000); onClick = posts(c0);
        prefilled = (await page.locator('textarea[aria-label="Ask LiquidityAI"]').inputValue().catch(() => '')).slice(0, 100);
        panelOpen = await page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]'); return !!p && p.getBoundingClientRect().width > 0; });
        const s0 = rec.length; await page.locator('button[aria-label="Send"]').first().click({ timeout: 8000 }).catch(() => {}); await sleep(4000); onSend = posts(s0);
        await page.screenshot({ path: `${DIR}/s4-${b.label.replace(/[^a-z0-9]+/gi, '-')}.jpg`, type: 'jpeg', quality: 65 });
      }
      const pass = found && onClick.length === 0 && panelOpen && prefilled.length > 0 && onSend.length === 1 && onSend[0].startsWith('POST /api/grok-chat');
      log.say({ step: 4, button: b.label, found, panelOpen, prefilled, postsOnClick: onClick, postsOnSend: onSend, verdict: found ? (pass ? 'PASS' : 'FAIL') : 'NOT PRESENT' });
      await ctx.close();
    }
  }
} finally { await browser.close(); log.save(); }
