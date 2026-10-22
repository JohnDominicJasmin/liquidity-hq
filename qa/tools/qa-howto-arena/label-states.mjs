/* PR #1578 owner screenshots: the "Loading <TF>..." label on the Arena chart, one STATE per run, browser closed after the run.
 * States (BTC, Pro stub, load 15m, then switch):
 *   fast     : the new timeframe's history request is delayed 700 ms; shot 'visible' 200 ms after the click, shot 'landed' 3 s later
 *   slow     : delayed 6 s; shot 'visible' at +3 s (over the old candles), shot 'landed' at +10 s
 *   offline  : go offline, click 5m; shots at +3 s and +11 s offline, then back online, shot +10 s after reconnect
 *   rapid    : click 1m, 5m, 15m, 1h with 100 ms between clicks while history requests are delayed 3 s; shot 'visible' at +1 s, 'landed' at +10 s
 * Each shot is the chart area (toolbar to the bottom of the last pane) and is recorded with what the page said at that moment: the label element's text
 * (data-testid chart-loading-label), the "Couldn't load price history" banner, the selected timeframe, the candle count and spacing.
 * Combinations per run: dark and light x 1280 and 390. A shot is flagged EMPTY when the chart holds fewer than 100 bars or the file is under 15 KB.
 * usage: node label-states.mjs <qa|prod> <tag> <fast|slow|offline|rapid>                                                                        */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
const [, , bArg = 'qa', tag = 'after', state = 'fast'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/loading-label/${tag}`; mkdirSync(dir, { recursive: true });
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
  const dl = chart ? chart.getDataList() : null; const n = dl ? dl.length : 0; const last = n ? dl[n - 1] : null; const prev = n > 1 ? dl[n - 2] : null;
  const lab = document.querySelector('[data-testid="chart-loading-label"]');
  const box = (() => { const cs = [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().width > 250); const tb = document.querySelector('.klc-tf-btn'); if (!cs.length || !tb) return null; let y2 = 0; for (const c of cs) y2 = Math.max(y2, c.getBoundingClientRect().bottom + scrollY); const y1 = tb.getBoundingClientRect().top + scrollY - 10; return { y1: Math.max(0, y1), y2 }; })();
  return { label: lab ? (lab.innerText || '').trim() : null, banner: /couldn't load price history/i.test(document.body.innerText), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, bars: n, spacingMin: last && prev ? (last.timestamp - prev.timestamp) / 60000 : null, box };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit, tag, state });
  for (const theme of ['dark', 'light']) for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    let armed = false; let delayMs = 0;
    await ctx.route('**/api/market/klines*', async (route) => {
      const big = Number(new URL(route.request().url()).searchParams.get('limit') || 0) >= 500;
      if (armed && big && delayMs > 0) { await sleep(delayMs); try { return await route.continue(); } catch { return; } }
      return route.continue();
    });
    const page = await ctx.newPage(); const base = `${state}-${theme}-${w}`;
    const shot = async (name) => {
      const r = await page.evaluate(READ); const file = `${dir}/${base}-${name}.png`;
      if (r.box) await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: r.box.y1, width: w, height: Math.min(r.box.y2 - r.box.y1 + 6, w < 500 ? 900 : 700) } }).catch(() => {}); else await page.screenshot({ path: file }).catch(() => {});
      let kb = 0; try { kb = Math.round(statSync(file).size / 1024); } catch { /* none */ }
      rows.push({ kind: 'shot', theme, w, state, name, ...r, box: undefined, kb, empty: r.bars < 100 || kb < 15 }); writeFileSync(`${dir}/${state}.json`, JSON.stringify(rows, null, 1));
    };
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=15m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
      const click = (tf) => page.locator('.klc-tf-btn', { hasText: new RegExp(`^${tf}$`) }).first().click({ timeout: 5000 }).catch(() => {});
      await shot('0-before-switch');
      if (state === 'fast') { delayMs = 700; armed = true; await click('5m'); await sleep(200); await shot('1-visible'); await sleep(3000); await shot('2-landed'); }
      else if (state === 'slow') { delayMs = 6000; armed = true; await click('5m'); await sleep(3000); await shot('1-visible'); await sleep(7000); await shot('2-landed'); }
      else if (state === 'offline') { await ctx.setOffline(true); await click('5m'); await sleep(3000); await shot('1-offline-3s'); await sleep(8000); await shot('2-offline-11s'); await ctx.setOffline(false); await sleep(10000); await shot('3-online-10s'); }
      else if (state === 'rapid') { delayMs = 3000; armed = true; for (const tf of ['1m', '5m', '15m', '1h']) { await click(tf); await sleep(100); } await sleep(900); await shot('1-visible-last-1h'); await sleep(9000); await shot('2-landed'); }
    } catch (e) { rows.push({ kind: 'ERROR', theme, w, error: String(e.message).slice(0, 160) }); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${dir}/${state}.json`, JSON.stringify(rows, null, 1)); }
for (const r of rows.filter((x) => x.kind === 'shot')) console.log(`${r.theme} ${r.w} ${r.name.padEnd(20)} label=${JSON.stringify(r.label)} banner=${r.banner} btn=${r.activeBtn} bars=${r.bars} spacing=${r.spacingMin} kb=${r.kb}${r.empty ? ' EMPTY' : ''}`);
console.log('errors', rows.filter((x) => x.kind === 'ERROR').length);
