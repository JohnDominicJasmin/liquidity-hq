/* #1574 re-capture: why was the Arena 5M "after" screenshot empty? Cold-load /arena?coin=btc&tf=5m several times (fresh browser context each time, dark
 * 1280, Pro stub), and for EVERY trial log: each /api/market/klines request (status, ms after navigation), the number of candles the chart holds
 * at +10 s and +25 s, whether the multi-timeframe table has values, and a screenshot named by trial. A trial is GOOD when the chart holds more than
 * 100 bars; the first GOOD one is the one to copy as the "after" capture.
 * usage: node arena-cold.mjs <qa|prod> <out.json> [trials=4]                                                                                 */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'arena-cold.json', trialsArg = '4'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/perf-wording/${B.tag}-recapture`; mkdirSync(dir, { recursive: true });
const rows = [];
const READ = () => {
  let chart = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !chart; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !chart; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getDataList === 'function') { chart = c; break; } } }
    }
  } catch { /* leave null */ }
  const t = document.body.innerText; const rsi = (t.match(/RSI\(14\)[\s\S]{0,600}/) || [''])[0];
  return { chartRead: !!chart, bars: chart ? chart.getDataList().length : null, banner: /couldn't load price history/i.test(t), mtfDashes: (rsi.match(/\s-\s/g) || []).length };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit });
  for (let i = 1; i <= Number(trialsArg); i++) {
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage(); const reqs = []; const t0 = Date.now();
    page.on('response', (r) => { const u = r.url(); if (/\/api\/market\/klines/.test(u)) reqs.push({ ms: Date.now() - t0, status: r.status(), q: u.split('?')[1]?.slice(0, 70) }); });
    page.on('requestfailed', (r) => { if (/\/api\//.test(r.url())) reqs.push({ ms: Date.now() - t0, failed: r.failure()?.errorText, q: r.url().slice(-80) }); });
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=5m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await sleep(10_000); const a = await page.evaluate(READ); await sleep(15_000); const b = await page.evaluate(READ);
      await page.screenshot({ path: `${dir}/arena-5m-desktop-trial${i}.png`, fullPage: true }).catch(() => {});
      rows.push({ kind: 'trial', i, at10s: a, at25s: b, good: (b.bars ?? 0) > 100, klines: reqs });
    } catch (e) { rows.push({ kind: 'ERROR', i, error: String(e.message).slice(0, 160) }); }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows.filter((x) => x.kind === 'trial')) console.log(`trial ${r.i} good=${r.good} bars@10s=${r.at10s.bars} bars@25s=${r.at25s.bars} banner=${r.at25s.banner} mtfDashes=${r.at25s.mtfDashes} klines=${r.klines.length} statuses=${[...new Set(r.klines.map((k) => k.status ?? k.failed))].join(',')}`);
