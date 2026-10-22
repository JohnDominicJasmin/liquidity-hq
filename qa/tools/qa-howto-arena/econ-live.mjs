/* #1625 / #1628 / #1637 on qa: the live /econ-calendar page and the dashboard widget as a stubbed Pro viewer (said so), with the feed normal, then failing
 * (abort, 500, 429 as the route sends it, 200 source 'none'). Text only + a photo each, plus every /api/econ-calendar response the page saw (status, ms).
 * usage: node econ-live.mjs [out-dir] [modes csv=normal,abort,http500,http429,none] [paths csv=/econ-calendar,/dashboard]   env WAIT=ms after settle */
import { chromium, open, settle, sleep, QA, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const dir = process.argv[2] || `${OUT}/econ-live`; mkdirSync(dir, { recursive: true });
const modes = (process.argv[3] || 'normal,abort,http500,http429,none').split(',');
const paths = (process.argv[4] || '/econ-calendar,/dashboard').split(',');
const WAIT = Number(process.env.WAIT || 9000);
const browser = await chromium.launch();
const S = { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} };
const STUB = {
  http500: { status: 500, body: '{"error":"qa-stub"}' },
  http429: { status: 429, body: '{"error":"Rate limit exceeded"}' },
  none: { status: 200, body: '{"events":[],"source":"none"}' },
};
try {
  console.log('build', (await (await fetch(QA.base + '/api/version')).json()).commit, new Date().toISOString(), 'wait', WAIT);
  for (const mode of modes) for (const path of paths) {
    const ctx = await open(browser, { b: QA, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', settings: S });
    if (mode === 'abort') await ctx.route('**/api/econ-calendar', (r) => r.abort('failed'));
    if (STUB[mode]) await ctx.route('**/api/econ-calendar', (r) => r.fulfill({ status: STUB[mode].status, contentType: 'application/json', body: STUB[mode].body }));
    const page = await ctx.newPage(); const seen = []; const t0 = Date.now();
    page.on('response', (r) => { if (/\/api\/econ-calendar(\?|$)/.test(r.url())) seen.push(`${r.status()} @${Date.now() - t0}ms`); });
    page.on('requestfailed', (r) => { if (/\/api\/econ-calendar(\?|$)/.test(r.url())) seen.push(`failed ${r.failure()?.errorText} @${Date.now() - t0}ms`); });
    await page.goto(QA.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(WAIT);
    const lines = (await page.evaluate(() => document.body.innerText)).split('\n').map((s) => s.trim()).filter((s) => /econ|calendar|upcoming|unavailable|no upcoming|CPI|FOMC|NFP|GDP|PCE|PPI|retail|~|estimat|couldn|failed|load/i.test(s)).slice(0, 12);
    console.log(`\n=== ${mode} ${path} | feed responses: ${seen.join(', ') || '(none seen)'}\n  ` + lines.join('\n  '));
    await page.screenshot({ path: `${dir}/${mode}-${path.replace(/\W/g, '')}.png` });
    await ctx.close();
  }
} finally { await browser.close(); }
