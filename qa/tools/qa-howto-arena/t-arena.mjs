/* #1524 How to test 1-4 and #1511 UI steps 9-10 on qa. POST /api/grok is STUBBED in the fence:
 *  'gate' = #1511's exact 403 body for tf 1m/5m/15m, a 200 fixture read otherwise; 'ok' = 200 fixture always.
 *  usage: node t-arena.mjs [A,B,C,D] */
import { chromium, open, settle, sleep, jlog, OUT, version } from './lib.mjs';
const JOBS = (process.argv[2] ?? 'A,B,C,D').split(',');
const L = jlog(`arena${process.env.SFX ?? ""}.json`);
const GATE_BODY = { error: 'PRO_REQUIRED', message: 'Fast timeframes (1m, 5m, 15m) are a Pro feature.' };
const fixture = (tf) => ({ result: { signal: 'LEAN BEARISH', confidence: 71, levels: [], patterns: ['QA fixture'], catalysts: [], chartAnalysis: 'QA fixture chart analysis', reasoning: 'QA fixture reasoning (stubbed /api/grok 200)', waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now(), tf, session: 'London' }, usage: null });
const grokStub = (mode, posts) => async (r, req, u) => {
  if (u.pathname !== '/api/grok' || req.method() !== 'POST') return false;
  let tf = null; try { tf = JSON.parse(req.postData() || '{}').tf; } catch { /* */ }
  posts.push({ t: Date.now(), tf });
  if (mode === 'gate' && ['1m', '5m', '15m'].includes(tf)) await r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(GATE_BODY) });
  else await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(tf)) });
  return true;
};
const STATE = () => ({
  tfOn: document.querySelector('button.klc-tf-btn.on')?.textContent?.trim() ?? null,
  err: document.querySelector('.arena-err')?.innerText ?? null,
  errLinks: [...document.querySelectorAll('.arena-err a')].map((a) => ({ href: a.getAttribute('href'), text: a.innerText })),
  card: !!document.querySelector('.arena-signal-card'),
  rawCode: document.body.innerText.includes('PRO_REQUIRED'),
  quickDisabled: document.querySelector('button.arena-quick-btn')?.disabled ?? null,
  upgradeModal: !!document.querySelector('.upgrade-modal-term-wrap'),
});
async function quick(page) {
  await page.waitForFunction(() => { const b = document.querySelector('button.arena-quick-btn'); return b && !b.disabled; }, null, { timeout: 30_000 });
  const q = page.locator('button.arena-quick-btn').first(); await q.scrollIntoViewIfNeeded().catch(() => {}); await q.click();
}
async function waitFor(page, fn, ms) { return page.waitForFunction(fn, null, { timeout: ms }).then(() => true).catch(() => false); }
async function shotErr(page, name) { const e = page.locator('.arena-err').first(); if (await e.count()) await e.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: `${OUT}/${name}${process.env.SFX ?? ""}.png` }); }

const browser = await chromium.launch();
try {
  L.say({ served: await version() });
  if (JOBS.includes('A')) for (const [w, theme] of [[1280, 'dark'], [390, 'dark'], [1280, 'light']]) {
    /* A: free account whose plan read FAILS ('unknown', #1119) - the clamp holds 5m, the server would 403. */
    const posts = []; const rec = [];
    const ctx = await open(browser, { w, theme, plan: 'fail', rec, appStub: grokStub('gate', posts) }); const page = await ctx.newPage();
    await page.goto('https://liquidity-hq-qa.onrender.com/arena?tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(9000);
    const before = await page.evaluate(STATE);
    await quick(page);
    const gotErr = await waitFor(page, () => !!document.querySelector('.arena-err'), 40_000); await sleep(500);
    const banner = await page.evaluate(STATE);
    await shotErr(page, `1524-A-unknown-5m-banner-${theme}-${w}`);
    let after1h = null, clearedOnStart = null, linkNav = null;
    if (w === 1280 && theme === 'dark') {
      await page.evaluate(() => [...document.querySelectorAll('button.klc-tf-btn')].find((b) => b.textContent.trim().toLowerCase() === '1h')?.click());
      await sleep(800);
      await quick(page);
      const t0 = Date.now(); const tl = []; let last = null;
      while (Date.now() - t0 < 30_000) { const s = await page.evaluate(STATE); const k = JSON.stringify([s.err, s.card, s.tfOn]); if (k !== last) { tl.push({ t: Date.now() - t0, err: s.err, card: s.card, tf: s.tfOn }); last = k; } if (s.card && !s.err) break; await sleep(100); }
      clearedOnStart = tl;
      after1h = await page.evaluate(STATE);
      const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: `${OUT}/1524-A-after-1h-quick-dark-1280${process.env.SFX ?? ""}.png` });
    }
    if (w === 390) {
      // the link itself: click it, where does it land? (/upgrade is an app GET, passed through)
      const a = page.locator('.arena-err a').first();
      if (await a.count()) { await a.click().catch(() => {}); await page.waitForURL(/\/upgrade/, { timeout: 20_000 }).catch(() => {}); linkNav = page.url().replace('https://liquidity-hq-qa.onrender.com', ''); await sleep(1500); await page.screenshot({ path: `${OUT}/1524-A-upgrade-link-landed-390${process.env.SFX ?? ""}.png` }); }
    }
    L.say({ job: 'A-free-unknown-5m', w, theme, before, gotErr, banner, linkNav, grokPosts: posts.map((p) => p.tf), timelineAfter1hQuick: clearedOnStart, after1h, planReads: rec.filter((x) => /plan:/.test(x.br)).length });
    await ctx.close();
  }
  if (JOBS.includes('B')) {
    /* B: free account, plan read HELD 12s - QUICK pressed while the plan is still loading. */
    const posts = []; const rec = [];
    const ctx = await open(browser, { plan: 'free', usDelay: 12_000, rec, appStub: grokStub('gate', posts) }); const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto('https://liquidity-hq-qa.onrender.com/arena?tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
    const before = await page.evaluate(STATE);
    await quick(page); const clickedAt = Date.now() - t0;
    const gotErr = await waitFor(page, () => !!document.querySelector('.arena-err'), 30_000); const errAt = Date.now() - t0; await sleep(300);
    const banner = await page.evaluate(STATE);
    await shotErr(page, '1524-B-planloading-5m-banner-dark-1280');
    await sleep(Math.max(0, 16_000 - (Date.now() - t0)));
    const afterPlan = await page.evaluate(STATE);
    const planAt = rec.find((x) => /plan:/.test(x.br));
    L.say({ job: 'B-free-planheld-5m', before, clickedAtMs: clickedAt, gotErr, errAtMs: errAt, planReadIssuedAtMs: planAt ? planAt.t - t0 : null, planHeldMs: 12000, banner, afterPlanArrived: afterPlan, grokPosts: posts.map((p) => ({ tf: p.tf, atMs: p.t - t0 })) });
    await ctx.close();
  }
  if (JOBS.includes('C')) {
    /* C: Pro on 5m - stubbed 200 (what a real Pro token gets), no banner. */
    const posts = [];
    const ctx = await open(browser, { plan: 'pro', appStub: grokStub('ok', posts) }); const page = await ctx.newPage();
    await page.goto('https://liquidity-hq-qa.onrender.com/arena?tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(6000);
    const before = await page.evaluate(STATE);
    await quick(page);
    const gotCard = await waitFor(page, () => !!document.querySelector('.arena-signal-card'), 40_000); await sleep(800);
    const s = await page.evaluate(STATE);
    const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/1524-C-pro-5m-read-dark-1280${process.env.SFX ?? ""}.png` });
    L.say({ job: 'C-pro-5m', before, gotCard, after: s, grokPosts: posts.map((p) => p.tf) });
    await ctx.close();
  }
  if (JOBS.includes('D')) {
    /* D (#1511 step 10): confirmed free account opened on ?tf=5m - clamp to 1h, QUICK sends tf 1h. */
    const posts = [];
    const ctx = await open(browser, { plan: 'free', appStub: grokStub('gate', posts) }); const page = await ctx.newPage();
    await page.goto('https://liquidity-hq-qa.onrender.com/arena?tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(6000);
    const before = await page.evaluate(STATE);
    // a free click on 5m must still be blocked by the existing modal, not reach the server
    await page.evaluate(() => [...document.querySelectorAll('button.klc-tf-btn')].find((b) => b.textContent.trim().toLowerCase() === '5m')?.click()); await sleep(800);
    const after5mClick = await page.evaluate(STATE);
    await page.screenshot({ path: `${OUT}/1511-D-free-5m-click-modal-dark-1280${process.env.SFX ?? ""}.png` });
    await page.keyboard.press('Escape').catch(() => {}); await sleep(500);
    await quick(page);
    const gotCard = await waitFor(page, () => !!document.querySelector('.arena-signal-card'), 40_000); await sleep(800);
    const s = await page.evaluate(STATE);
    const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/1511-D-free-clamped-1h-quick-dark-1280${process.env.SFX ?? ""}.png` });
    L.say({ job: 'D-free-confirmed', before, after5mClick, gotCard, after: s, grokPosts: posts.map((p) => p.tf) });
    await ctx.close();
  }
} catch (e) { L.say({ crash: String(e).slice(0, 400) }); } finally { await browser.close(); L.save(); }
