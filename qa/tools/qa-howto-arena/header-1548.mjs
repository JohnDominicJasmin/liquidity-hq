/* #1548: Strategy panel header, count chip and cap note for signed_out | free | trial | pro, on qa, 1280, dark.
 * Reads text straight from the DOM; also a pre-hydration sample of the header on reload (must never read FREE for signed out).
 * usage: node header-1548.mjs <qa|prod> <plans> <out.json> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', plansArg = 'signed_out,free,pro,trial', outArg = 'header-1548.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/header-1548`; mkdirSync(dir, { recursive: true });
const rows = [];
const READ = () => ({
  panelHead: (document.querySelector('.strat-panel')?.textContent || '').trim().slice(0, 90),
  badge: document.querySelector('.strat-panel .strat-plan, .strat-panel [class*="badge"], .strat-aux')?.textContent?.trim() ?? null,
  count: document.querySelector('.strat-count')?.textContent?.trim() ?? null,
  note: [...document.querySelectorAll('.strat-panel *')].filter((e) => e.children.length === 0 && /limit reached/i.test(e.textContent || '')).map((e) => e.textContent.trim()),
  upgradeHref: [...document.querySelectorAll('.strat-panel a')].map((a) => a.getAttribute('href')),
});
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit });
  for (const plan of plansArg.split(',')) {
    const signedIn = plan !== 'signed_out'; const stubPlan = plan === 'signed_out' ? 'free' : plan;
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn, plan: stubPlan, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForSelector('.strat-panel .strat-chip', { timeout: 60_000 }).catch(() => {}); await sleep(4000);
      const before = await page.evaluate(READ);
      const chips = page.locator('.strat-panel .strat-chip'); const n = await chips.count();
      let picked = null;
      for (let i = 0; i < n && !picked; i++) { const c = chips.nth(i); const cls = (await c.getAttribute('class')) || ''; if (/always|notyet|blocked|on\b/.test(cls)) continue; picked = i; await c.click({ timeout: 5000 }).catch(() => {}); }
      await sleep(1200);
      const after = await page.evaluate(READ);
      await page.locator('.strat-panel').first().screenshot({ path: `${dir}/${bArg}-${plan}-panel.png` }).catch(() => {});
      rows.push({ step: 'case', plan, before, picked, after });
    } catch (e) { rows.push({ step: 'ERROR', plan, error: String(e.message).slice(0, 160) }); }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
console.log(JSON.stringify(rows, null, 1));
