/* #1574: no win-rate / wins-losses / R-record / profit-factor / signal-accuracy / backtest wording anywhere it should be hidden.
 * For every page and viewport: the text a visitor can read (innerText plus title / aria-label / data-tip attributes, plus the Anti-Chop tooltip
 * opened by hover) is searched for the wording; every hit is kept WITH its surrounding words. Also: sideways scroll vs the requested width,
 * a screenshot, the redirects of /backtest and /live-tracking, and the upgrade modal opened as Free by clicking a Pro-only timeframe.
 * Run it on prod (the "before", flag effectively on) and on qa (the "after", flag unset) and compare.
 * usage: node perf-wording.mjs <qa|prod> <out.json> [pages=core|all]                                                                    */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'perf-wording.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/perf-wording/${B.tag}`; mkdirSync(dir, { recursive: true });
const WORDS = '(win[ -]?rate|\\bwins?\\b|\\blosses\\b|\\bloss(?:es)?\\b|-?\\d+(?:\\.\\d+)?R\\b|profit factor|signal accuracy|\\baccuracy\\b|back-?test\\w*|track record|alert outcome\\w*|win\\/loss|recent record)';
const PAGES = [['arena-1m', '/arena?coin=btc&tf=1m'], ['arena-5m', '/arena?coin=btc&tf=5m'], ['arena-15m', '/arena?coin=btc&tf=15m'], ['arena-1h', '/arena?coin=btc&tf=1h'], ['dashboard', '/dashboard'], ['scanner', '/scanner'], ['alerts', '/alerts'], ['about', '/about'], ['upgrade', '/upgrade'], ['learn', '/learn'], ['faq', '/faq'], ['landing', '/']];
const SHOT = new Set(['arena-1m', 'arena-5m', 'arena-15m', 'arena-1h', 'dashboard', 'scanner', 'alerts', 'about', 'upgrade']);
/* GROUP=<comma list of page names, plus optional "redirect" and "modal">, so one run covers one small group (the machine's memory reaper kills long runs). */
const GROUP = (process.env.GROUP || '').split(',').filter(Boolean); const want = (n) => GROUP.length === 0 || GROUP.includes(n);
const rows = [];
const READ = (src) => {
  const re = new RegExp(src, 'gi'); const attrs = [...document.querySelectorAll('[title],[aria-label],[data-tip],[data-tooltip]')].flatMap((e) => ['title', 'aria-label', 'data-tip', 'data-tooltip'].map((a) => e.getAttribute(a)).filter(Boolean));
  const corpus = [document.body.innerText, ...attrs].join(' \n ').replace(/\s+/g, ' '); const hits = []; let m;
  while ((m = re.exec(corpus))) hits.push({ w: m[0], ctx: corpus.slice(Math.max(0, m.index - 45), m.index + m[0].length + 45) });
  return { hits, sw: document.documentElement.scrollWidth, len: corpus.length };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ step: 'build', commit: v.commit, base: B.base });
  // redirects
  if (want('redirect')) for (const p of ['/backtest', '/live-tracking']) { const r = await fetch(B.base + p, { redirect: 'manual' }).catch(() => null); rows.push({ step: 'redirect', path: p, status: r?.status ?? null, location: r?.headers.get('location') ?? null }); }
  for (const theme of ['dark', 'light']) for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: true, plan: process.env.PLAN || 'pro', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      if (!want(name)) continue; if (theme === 'light' && !SHOT.has(name)) continue; if (w === 390 && !SHOT.has(name)) continue;
      try {
        const resp = await page.goto(B.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(name.startsWith('arena') ? 6000 : 3500);
        let tip = null;
        if (name === 'arena-5m') { const t = page.getByText(/anti-?chop/i).first(); if (await t.count()) { const icon = t.locator('xpath=ancestor::*[self::div or self::label or self::span][1]').locator('button, [role="button"], svg, [class*="info"], [class*="tip"]').first(); await icon.hover({ timeout: 3000 }).catch(() => {}); await sleep(700); tip = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="tip"]')].map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 400)); } }
        if (SHOT.has(name)) await page.screenshot({ path: `${dir}/${name}-${theme}-${w}.png`, fullPage: true }).catch(() => {});
        const r = await page.evaluate(READ, WORDS);
        rows.push({ step: 'page', name, theme, w, finalPath: new URL(page.url()).pathname + new URL(page.url()).search, status: resp?.status(), scrollWidth: r.sw, overflow: r.sw > w, hits: r.hits, tooltip: tip });
      } catch (e) { rows.push({ step: 'ERROR', name, theme, w, error: String(e.message).slice(0, 160) }); }
      writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
    }
    await ctx.close();
  }
  // upgrade modal as Free: click a Pro-only timeframe on the Arena
  if (want('modal')) for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme: 'dark', signedIn: true, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(5000);
      await page.locator('.klc-tf-btn', { hasText: /^1m$/ }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(1500);
      const modal = await page.evaluate((src) => { const d = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="gate"], [class*="overlay"]')].find((e) => /part of Pro|PRO FEATURE/i.test(e.innerText || '')); const t = (d?.innerText || '').replace(/\s+/g, ' '); const hits = []; let m; const re = new RegExp(src, 'gi'); while ((m = re.exec(t))) hits.push(m[0]); return { found: !!d, text: t.slice(0, 500), hits }; }, WORDS);
      await page.screenshot({ path: `${dir}/upgrade-modal-dark-${w}.png` }).catch(() => {});
      rows.push({ step: 'modal', w, ...modal });
    } catch (e) { rows.push({ step: 'ERROR', name: 'modal', w, error: String(e.message).slice(0, 160) }); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
console.log(`rows ${rows.length}, errors ${rows.filter((r) => r.step === 'ERROR').length}`);
