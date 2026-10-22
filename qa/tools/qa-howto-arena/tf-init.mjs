/* #1572 WRONG TIMEFRAME (init race): open Arena on 1h, click 4h as soon as the toolbar exists, at different delays, optionally on a throttled
 * network so the chart object (created after a dynamic import) is not there yet. After 25 s compare, per trial: selected (URL + highlighted button),
 * candle spacing (= the timeframe the candles really are) and the EMA panel's timeframe. Also records whether the chart object existed at click time
 * (chartAtClick=false means the race window was really exercised).
 *   mode "click": click 4h after <delay> ms.   mode "saved": settings default_tf=4h, open /arena with NO params (the #1263 seed path).
 * usage: node tf-init.mjs <qa|prod> <out.json> <delaysCsv e.g. 0,50,150,400,900> <throttle 0|1> [mode=click|saved]                           */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'tf-init.json', delaysArg = '0,50,150,400,900', throttleArg = '0', mode = 'click'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const MS = { '1h': 3600e3, '4h': 14400e3 }; const rows = [];
const READ = () => {
  let chart = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !chart; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !chart; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getDataList === 'function') { chart = c; break; } } }
    }
  } catch { /* leave null */ }
  const dl = chart ? chart.getDataList() : null; const n = dl ? dl.length : 0; const last = n ? dl[n - 1] : null; const prev = n > 1 ? dl[n - 2] : null;
  const m = document.body.innerText.match(/·\s*(\d+[mhd])\s+chart/i);
  return { chartRead: !!chart, urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, bars: n, barMs: last && prev ? last.timestamp - prev.timestamp : null, indicatorTf: m ? m[1].toLowerCase() : null, dot: document.querySelector('.klc-ws-dot')?.classList.contains('live') ? 'live' : 'not-live' };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit, mode, throttle: throttleArg });
  const delays = mode === 'saved' ? [0] : delaysArg.split(',').map(Number);
  for (const delay of delays) {
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: mode === 'saved' ? '4h' : '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      if (throttleArg === '1') { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: 300 * 1024, uploadThroughput: 120 * 1024 }); }
      const want = mode === 'saved' ? '4h' : '4h'; const t0 = Date.now();
      await page.goto(B.base + (mode === 'saved' ? '/arena' : '/arena?coin=btc&tf=1h'), { waitUntil: 'commit', timeout: 120_000 });
      let atClick = null;
      if (mode === 'click') {
        const b4 = page.locator('.klc-tf-btn', { hasText: /^4h$/ }).first(); await b4.waitFor({ state: 'visible', timeout: 90_000 }); await sleep(delay);
        atClick = await page.evaluate(READ).catch(() => null); await b4.click({ timeout: 10_000 }).catch(() => {});
      }
      await sleep(25_000); await settle(page);
      const r = await page.evaluate(READ); const ok = r.urlTf === want && r.activeBtn === want && r.barMs === MS[want] && r.indicatorTf === want;
      rows.push({ kind: 'trial', mode, throttle: throttleArg, delay, chartAtClick: atClick ? atClick.chartRead : null, msToClick: Date.now() - t0, ...r, want, consistent: ok });
    } catch (e) { rows.push({ kind: 'ERROR', delay, error: String(e.message).slice(0, 160) }); }
    await ctx.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1));
  }
} finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows.filter((x) => x.kind === 'trial')) console.log(`delay=${r.delay}ms throttle=${r.throttle} chartExistedAtClick=${r.chartAtClick} url=${r.urlTf} btn=${r.activeBtn} spacing=${r.barMs} ind=${r.indicatorTf} bars=${r.bars} consistent=${r.consistent}`);
console.log('errors', rows.filter((x) => x.kind === 'ERROR').length);
