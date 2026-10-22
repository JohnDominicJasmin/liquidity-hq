/* Signal coin gate (#1545 / PR #1546): signed out = BTC only, Free = BTC/ETH/SOL, Trial and Pro = every coin. For every plan x coin
 * this reads what a customer sees on /arena (1h): the chart's own signal markers (from the chart instance: each `emaSignal` overlay
 * carries dir long | short | locked), the panel's lock block (`signal-locked`, its copy and its link), whether the verdict and
 * checklist survive, and takes the screenshots the owner approves (chart + panel). Plans are STUBBED through the subscription
 * read, so this tests the client only; the Telegram, alert and backtest routes are not reachable from here.
 * usage: node signal-gate.mjs <qa|prod> <plans> <coins> <themes> <widths> <out.json>
 *   e.g.  node signal-gate.mjs qa signed_out,free,trial,pro btc,eth,sol,xrp,doge dark 1280 gate.json                         */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', plansArg = 'signed_out,free,trial,pro', coinsArg = 'btc,eth,sol,xrp,doge', themesArg = 'dark', widthsArg = '1280', outArg = 'signal-gate.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/signal-gate`; mkdirSync(dir, { recursive: true });
const rows = [];
const READ = () => {
  let markers = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !markers; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !markers; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getOverlays === 'function') { const cnt = { long: 0, short: 0, locked: 0, other: 0 }; for (const ov of c.getOverlays()) { if (ov.name !== 'emaSignal') continue; const dir = ov.extendData && ov.extendData.dir; if (dir === 'long' || dir === 'short' || dir === 'locked') cnt[dir]++; else cnt.other++; } markers = cnt; break; } } }
    }
  } catch { /* leave null */ }
  const lock = document.querySelector('[data-testid="signal-locked"]'); const link = document.querySelector('[data-testid="signal-locked-link"]');
  const panel = [...document.querySelectorAll('div')].find((d) => /EMA RIBBON STRATEGY/i.test(d.textContent || '') && d.querySelectorAll('div').length > 5 && (d.textContent || '').length < 4000);
  const txt = (panel?.textContent || '');
  return { markers, lockBlock: !!lock, lockText: lock ? (lock.textContent || '').trim().slice(0, 120) : null, lockHref: link ? link.getAttribute('href') : null, lockLinkH: link ? Math.round(link.getBoundingClientRect().height) : null,
    pendingSetup: !!document.querySelector('[data-testid="pending-setup"]'), verdictWords: /\b(BUY|SELL|LONG|SHORT|TRENDING LONG|TRENDING SHORT|FREEZE)\b/i.test(txt), checklistRows: (txt.match(/Close vs EMA 50|Ribbon Aligned|Funding Rate|Open Interest|Volume Above MA/gi) || []).length, planChip: document.querySelector('.strat-aux')?.textContent?.trim() ?? null, coin: document.querySelector('.coin-chip.active, [aria-pressed="true"]')?.textContent?.trim()?.slice(0, 12) ?? null };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit, at: new Date().toISOString() });
  for (const plan of plansArg.split(',')) for (const theme of themesArg.split(',')) for (const w of widthsArg.split(',').map(Number)) for (const coin of coinsArg.split(',')) {
    const signedIn = plan !== 'signed_out'; const stubPlan = plan === 'signed_out' ? 'free' : plan;
    const ctx = await open(browser, { b: B, w, theme, signedIn, plan: stubPlan, settings: { default_coin: coin, default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + `/arena?coin=${coin}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
      const r = await page.evaluate(READ);
      const tag = `${bArg}-${plan}-${coin}-${theme}-${w}`;
      await page.screenshot({ path: `${dir}/${tag}.png` });
      const lockEl = page.locator('[data-testid="signal-locked"]').first(); if (await lockEl.count()) await lockEl.screenshot({ path: `${dir}/${tag}-lock.png` }).catch(() => {});
      rows.push({ step: 'case', plan, coin, theme, w, ...r });
    } catch (e) { rows.push({ step: 'ERROR', plan, coin, theme, w, error: String(e.message).slice(0, 160) }); }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
console.log(`rows ${rows.length}`);
