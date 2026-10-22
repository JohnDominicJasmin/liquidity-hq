/* #1572 (c) self-heal, tested from outside: force "selected 1h, candles not 1h" by answering the chart's history request (/api/market/klines) with the
 * NEXT SMALLER interval's candles, keep doing that for the first 14 s after load, then stop and let the real data through. If the chart notices the
 * spacing is wrong (check runs every 10 s) it reloads and the candles become 1h by themselves; if it does not, they stay wrong.
 * Every 3 s: candle spacing, URL, highlighted button, EMA-panel timeframe, and every /api/market/klines request seen (interval, rewritten or not).
 * usage: node tf-heal.mjs <qa|prod> <out.json>                                                                                              */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'tf-heal.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const rows = []; const reqs = []; let rewrite = true; const T0 = Date.now();
const SWAP = { '60': '30', '1h': '30m' };
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
  return { bars: n, spacingMin: last && prev ? (last.timestamp - prev.timestamp) / 60000 : null, urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, indicatorTf: m ? m[1].toLowerCase() : null };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  // registered after open(), so it runs before the harness's plain pass-through for app GETs
  await ctx.route('**/api/market/klines*', async (route) => {
    const u = new URL(route.request().url()); const iv = u.searchParams.get('interval'); const sw = rewrite && SWAP[iv];
    reqs.push({ s: Math.round((Date.now() - T0) / 1000), interval: iv, source: u.searchParams.get('source'), served: sw || iv, rewritten: !!sw });
    if (!sw) return route.continue();
    u.searchParams.set('interval', sw); const resp = await route.fetch({ url: u.toString() }); return route.fulfill({ response: resp });
  });
  const page = await ctx.newPage();
  await page.goto(B.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  const tLoad = Date.now();
  for (let s = 3; s <= 60; s += 3) {
    await sleep(3000); if (rewrite && Date.now() - tLoad > 14000) { rewrite = false; rows.push({ kind: 'rewrite-off', s: Math.round((Date.now() - tLoad) / 1000) }); }
    rows.push({ kind: 'snap', s: Math.round((Date.now() - tLoad) / 1000), ...(await page.evaluate(READ)) }); writeFileSync(`${dir}/${outArg}`, JSON.stringify({ rows, reqs }, null, 1));
  }
  await ctx.close();
} catch (e) { rows.push({ kind: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify({ rows, reqs }, null, 1)); }
for (const r of rows) console.log(r.kind === 'snap' ? `+${String(r.s).padStart(2)}s spacing=${r.spacingMin}min bars=${r.bars} url=${r.urlTf} btn=${r.activeBtn} ind=${r.indicatorTf}` : JSON.stringify(r));
console.log('klines requests:', JSON.stringify(reqs));
