/* Is the EMA ribbon drawn on the Arena chart? Load /arena as <plan>, then every 3 s for up to 60 s read from the chart instance: bars, ribbon overlays
 * (emaRibbonLine), S/R and GEX overlays; stops 9 s after the ribbon first appears. Run it twice (first = cold load, second = warm).
 * usage: node ribbon-probe.mjs <qa|prod> <free|pro> [runs=2] */
import { chromium, open, settle, sleep, QA, PROD } from './lib.mjs';
const [, , bArg = 'qa', plan = 'free', runsArg = '2'] = process.argv; const B = bArg === 'prod' ? PROD : QA;
const READ = () => {
  let chart = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !chart; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !chart; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getOverlays === 'function' && typeof c.getDataList === 'function') { chart = c; break; } } }
    }
  } catch { /* leave null */ }
  if (!chart) return { chartRead: false };
  const ov = {}; for (const x of chart.getOverlays()) ov[x.name] = (ov[x.name] || 0) + 1;
  return { chartRead: true, bars: chart.getDataList().length, ribbon: ov.emaRibbonLine || 0, sr: ov.srLevelLine || 0, gex: ov.gexLevelLine || 0, signals: ov.emaSignal || 0 };
};
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, 'plan', plan);
  for (let run = 1; run <= Number(runsArg); run++) {
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan, liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); const page = await ctx.newPage(); const t0 = Date.now(); let first = null;
    await page.goto(B.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
    const line = [];
    for (let s = 3; s <= 60; s += 3) { await sleep(3000); const r = await page.evaluate(READ); line.push(`${Math.round((Date.now() - t0) / 1000)}s:${r.chartRead ? `bars${r.bars}/rib${r.ribbon}/sr${r.sr}/gex${r.gex}` : 'nochart'}`); if (r.chartRead && r.ribbon > 0 && first === null) first = Math.round((Date.now() - t0) / 1000); if (first !== null && Math.round((Date.now() - t0) / 1000) >= first + 9) break; }
    console.log(`run ${run}: ribbon first drawn at ${first === null ? 'NEVER within 60 s' : first + ' s'} | ${line.join(' ')}`); await ctx.close();
  }
} finally { await browser.close(); }
