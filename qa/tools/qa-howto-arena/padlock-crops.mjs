/* Chart crops for the owner's padlock approval: the chart area (all canvases) plus the signal panel's lock block, for the same
 * plan/coin/theme on production (A, no gate) and qa (B). usage: node padlock-crops.mjs <qa|prod>                              */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = `${OUT}/signal-gate/crops`; mkdirSync(dir, { recursive: true });
const CASES = [['signed_out', 'eth'], ['free', 'xrp']];
const browser = await chromium.launch();
try {
  for (const [plan, coin] of CASES) for (const theme of ['dark', 'light']) {
    if (process.env.ONLY && process.env.ONLY !== `${plan}:${coin}:${theme}`) continue;
    const ctx = await open(browser, { b: B, w: 1280, theme, signedIn: plan !== 'signed_out', plan: plan === 'signed_out' ? 'free' : plan, settings: { default_coin: coin, default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    await page.goto(B.base + `/arena?coin=${coin}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
    const box = await page.evaluate(() => { const cs = [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().width > 300); if (!cs.length) return null; let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0; for (const c of cs) { const r = c.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top + scrollY); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom + scrollY); } return { x: Math.max(0, x1), y: Math.max(0, y1), width: x2 - Math.max(0, x1), height: Math.min(y2 - y1, 900) }; });
    const tag = `${B.tag}-${plan}-${coin}-${theme}`;
    if (box) await page.screenshot({ path: `${dir}/${tag}-chart.png`, fullPage: true, clip: box });
    const lock = page.locator('[data-testid="signal-locked"]').first(); if (await lock.count()) { await lock.scrollIntoViewIfNeeded().catch(() => {}); await lock.screenshot({ path: `${dir}/${tag}-lock.png` }).catch(() => {}); }
    console.log(JSON.stringify({ tag, box: !!box, lock: await lock.count() }));
    await ctx.close();
  }
} finally { await browser.close(); }
