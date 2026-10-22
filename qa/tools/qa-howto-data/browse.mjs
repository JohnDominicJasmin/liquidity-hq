/* QA how-to-test browser checks on qa: #1515 steps 1-3 (dashboard, correlation, arena candles) and #1519 steps 1-3
 * (/alerts subtitle, Connect Telegram locked card, funding still in the two alert descriptions).
 * Synthetic Free session, ALLOWLIST fence copied from qa-verify-1c81138.mjs: app GET/HEAD through, app writes answered
 * locally, the three named Supabase reads answered locally, other Supabase refused, market-data GETs through, all else aborted.
 * usage: node browse.mjs <outdir> */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fence = { appWritesAnswered: 0, sbAnswered: 0, aborted: [] };

async function open(browser, { w, h, signedIn = true, theme = 'dark' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([k, v, t, si]) => { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, theme, signedIn]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      fence.appWritesAnswered++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: [], settings: {} }) });
    }
    if (u.host === SB && req.method() === 'GET' && signedIn) {
      if (/user_onboarding/.test(u.pathname)) { fence.sbAnswered++; return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true }); }
      if (/user_subscriptions/.test(u.pathname)) { fence.sbAnswered++; return row(r, { user_id: UID, role: 'free', trial_ends_at: null }); }
      if (/user_settings/.test(u.pathname)) { fence.sbAnswered++; return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', timezone: TZ, watchlist: [], field_updated_at: {} }); }
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    if (fence.aborted.length < 200) fence.aborted.push(`${req.method()} ${u.host}${u.pathname.slice(0, 60)}`);
    return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await sleep(600); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
function trackKlines(page) {
  const rec = [];
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (u.host === APP && u.pathname === '/api/market/klines') rec.push({ t: Date.now(), status: res.status(), src: res.headers()['x-data-source'] ?? null, cc: res.headers()['cache-control'] ?? null, q: `${u.searchParams.get('source')}:${u.searchParams.get('symbol')}:${u.searchParams.get('interval')}:${u.searchParams.get('limit')}${u.searchParams.get('closed') ? ':closed' : ''}${u.searchParams.get('start') ? ':range' : ''}` });
    else if (MARKET.test(u.host) && !/fonts|gstatic/.test(u.host) && /kline|candle/i.test(u.pathname + u.search)) rec.push({ t: Date.now(), status: res.status(), direct: u.host, q: u.pathname });
  });
  return rec;
}
const summarize = (rec) => {
  const proxy = rec.filter((r) => !r.direct);
  const by = {}; for (const r of proxy) by[r.status] = (by[r.status] ?? 0) + 1;
  return { proxyCalls: proxy.length, byStatus: by, fallback: proxy.filter((r) => r.src === 'bybit-fallback').length, non200: proxy.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.q}`).slice(0, 10), direct: rec.filter((r) => r.direct).length };
};

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json(); log({ served: v.commit, branch: v.branch });
  // warm-up
  { const ctx = await open(browser, { w: 1280, h: 800 }); const p = await ctx.newPage(); await p.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await sleep(2000); await ctx.close(); }

  // #1515 step 1: dashboard
  {
    const ctx = await open(browser, { w: 1280, h: 900 }); const page = await ctx.newPage(); const rec = trackKlines(page);
    await page.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(20_000);
    const ui = await page.evaluate(() => ({ canvases: [...document.querySelectorAll('canvas')].filter((c) => c.width > 50 && c.height > 50).length, errText: (document.body.innerText.match(/(couldn.t load|failed to load|unavailable|rate-limit|refused)[^\n]{0,60}/gi) ?? []).slice(0, 8), scrollW: document.documentElement.scrollWidth }));
    await page.screenshot({ path: `${OUT}/1515-dashboard-1280.png`, fullPage: true });
    log({ step: '1515-1-dashboard', ...summarize(rec), ui });
    await ctx.close();
  }
  // #1515 step 2: correlation
  {
    const ctx = await open(browser, { w: 1280, h: 900 }); const page = await ctx.newPage(); const rec = trackKlines(page);
    await page.goto(BASE + '/correlation', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
    const t0 = Date.now(); let cells = null;
    while (Date.now() - t0 < 40_000) { cells = await page.evaluate(() => { const c = [...document.querySelectorAll('.corr-cell')]; return { total: c.length, numeric: c.filter((e) => /-?\d*\.\d+/.test(e.textContent || '')).length, sample: c.slice(0, 4).map((e) => e.textContent.trim()) }; }); if (cells.total && cells.numeric === cells.total) break; await sleep(1000); }
    const pairs = await page.evaluate(() => [...document.querySelectorAll('.corr-pair-val')].slice(0, 3).map((e) => e.textContent.trim()));
    await page.screenshot({ path: `${OUT}/1515-correlation-1280.png` });
    log({ step: '1515-2-correlation', ...summarize(rec), cells, filledAfterMs: Date.now() - t0, pairs });
    await ctx.close();
  }
  // #1515 step 3: arena, then switch timeframe and coin
  {
    const ctx = await open(browser, { w: 1280, h: 900 }); const page = await ctx.newPage(); const rec = trackKlines(page);
    await page.goto(BASE + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(12_000);
    const chart = () => page.evaluate(() => ({ tfOn: document.querySelector('button.klc-tf-btn.on')?.textContent?.trim() ?? null, canvases: [...document.querySelectorAll('canvas')].filter((c) => c.width > 200 && c.height > 100).length, url: location.search }));
    const s0 = { ...(await chart()), ...summarize(rec) };
    await page.screenshot({ path: `${OUT}/1515-arena-btc-1h-1280.png` });
    const n0 = rec.length;
    await page.evaluate(() => [...document.querySelectorAll('button.klc-tf-btn')].find((b) => b.textContent.trim().toLowerCase() === '4h')?.click());
    await sleep(8000);
    const tfReq = rec.slice(n0);
    const s1 = { ...(await chart()), newKlines: tfReq.map((r) => `${r.status} ${r.src ?? ''} ${r.q ?? r.direct}`).slice(0, 8) };
    await page.screenshot({ path: `${OUT}/1515-arena-btc-4h-1280.png` });
    const n1 = rec.length;
    let coinVia = 'scanner';
    const trig = page.locator('button[aria-expanded]').filter({ hasText: /BTC/ }).first();
    if (await trig.isVisible().catch(() => false)) { await trig.click().catch(() => {}); await sleep(800); }
    const row = page.locator('.scanner-flyout-grid').filter({ hasText: /ETH/ }).first();
    if (await row.isVisible().catch(() => false)) await row.click(); else { coinVia = 'url'; await page.goto(BASE + '/arena?coin=eth&tf=4h', { waitUntil: 'load', timeout: 120_000 }); await settle(page); }
    await sleep(10_000);
    const coinReq = rec.slice(n1);
    const s2 = { ...(await chart()), coinVia, newKlines: coinReq.map((r) => `${r.status} ${r.src ?? ''} ${r.q ?? r.direct}`).slice(0, 8), ethRequests: coinReq.filter((r) => /ETH/.test(r.q ?? '')).length };
    await page.screenshot({ path: `${OUT}/1515-arena-eth-4h-1280.png` });
    log({ step: '1515-3-arena', initial: s0, afterTf4h: s1, afterCoinEth: s2, all: summarize(rec) });
    await ctx.close();
  }
  // #1519 steps 1-3: /alerts as Free
  {
    const ctx = await open(browser, { w: 1280, h: 900 }); const page = await ctx.newPage();
    const labelsSeen = [];
    page.on('response', async (res) => { const u = new URL(res.url()); if (u.host === APP && u.pathname === '/api/labels') { try { const j = await res.json(); const m = j.labels ?? j; labelsSeen.push({ q: u.search, status: res.status(), sub: m?.ALERTS_PAGE_SUBTITLE ?? null, locked: m?.ALERTS_LOCKED_FEATURE_DESC ?? null }); } catch { labelsSeen.push({ q: u.search, status: res.status(), parse: false }); } } });
    await page.goto(BASE + '/alerts', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(8000);
    const r = await page.evaluate(() => {
      const sub = document.querySelector('.mb-subtitle')?.textContent?.trim() ?? null;
      const title = document.querySelector('.mb-title')?.textContent?.trim() ?? null;
      const all = [...document.querySelectorAll('div,p,span')];
      const lockedTitle = all.find((e) => e.children.length === 0 && /^Connect Telegram$/i.test(e.textContent.trim()));
      let lockedDesc = null; let el = lockedTitle; for (let i = 0; i < 5 && el && !lockedDesc; i++) { el = el.parentElement; const d = el && [...el.querySelectorAll('*')].find((x) => x.children.length === 0 && /sent directly to Telegram/i.test(x.textContent)); if (d) lockedDesc = d.textContent.trim(); }
      const body = document.body.innerText;
      return { title, sub, lockedTitleFound: !!lockedTitle, lockedDesc, unlockBtn: !!document.querySelector('button') && /unlock|upgrade/i.test([...document.querySelectorAll('button')].map((b) => b.textContent).join(' | ')), sentimentDesc: (body.match(/F&G \+ BTC funding[^\n]*/) ?? [null])[0], distributionDesc: (body.match(/retail keeps paying funding[^\n]*/) ?? [null])[0], funding: (body.match(/[^\n]{0,50}funding[^\n]{0,30}/gi) ?? []).slice(0, 6) };
    });
    await page.screenshot({ path: `${OUT}/1519-alerts-top-1280.png` });
    const lk = page.locator('text=/sent directly to Telegram/i').first(); if (await lk.count()) await lk.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/1519-alerts-locked-card-1280.png` });
    const sd = page.locator('text=/F&G \\+ BTC funding/').first(); if (await sd.count()) { await sd.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: `${OUT}/1519-alerts-sentiment-desc-1280.png` }); }
    log({ step: '1519-alerts', ...r, labelsSeen });
    await ctx.close();
  }
} finally { await browser.close(); log({ fence: { appWritesAnswered: fence.appWritesAnswered, sbAnswered: fence.sbAnswered, abortedSample: [...new Set(fence.aborted)].slice(0, 25) } }); writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1)); }
