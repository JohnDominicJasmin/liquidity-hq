/* #1572 / PR #1577: a hung or slow history request for the NEW timeframe. BTC, Pro stub, load 15m, settle, click 5m.
 *   hung : the first two history requests for the 5m interval are held for 40 s (never answered meanwhile); later ones pass. Expected with the fix:
 *          each attempt gives up after ~12 s, the chart retries / falls over, and 5m candles land well before 80 s; without it the 15m candles stay
 *          under the 5m label for as long as the request hangs.
 *   slow : the first 5m history request is delayed 9 s (inside the 12 s budget) then passes. Expected: it lands, no restart (no extra request storm).
 * Every /api/market/klines request is logged (seconds after the click, interval, held or not); the chart is polled every 2 s for up to 80 s:
 * candle spacing in minutes, bars, URL timeframe, highlighted button, EMA-panel timeframe.
 * usage: node tf-hung.mjs <qa|prod> <hung|slow> <out.json>                                                                                     */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', mode = 'hung', outArg = `tf-hung-${mode}.json`] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const rows = []; const reqs = []; let tClick = null; let held = 0;
const IS5 = (iv) => iv === '5' || iv === '5m';
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
  return { bars: n, spacingMin: last && prev ? (last.timestamp - prev.timestamp) / 60000 : null, urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, indicatorTf: m ? m[1].toLowerCase() : null, banner: /couldn't load price history/i.test(document.body.innerText) };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit, mode });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  await ctx.route('**/api/market/klines*', async (route) => {
    const u = new URL(route.request().url()); const iv = u.searchParams.get('interval'); const big = Number(u.searchParams.get('limit') || 0) >= 500;
    const rel = tClick ? Math.round((Date.now() - tClick) / 100) / 10 : null;
    if (tClick && IS5(iv) && big && ((mode === 'hung' && held < 2) || (mode === 'slow' && held < 1))) {
      held++; reqs.push({ s: rel, iv, source: u.searchParams.get('source'), action: mode === 'hung' ? 'HELD 40 s' : 'DELAYED 9 s' });
      await sleep(mode === 'hung' ? 40_000 : 9_000); try { return await route.continue(); } catch { return; }
    }
    reqs.push({ s: rel, iv, source: u.searchParams.get('source'), action: 'pass', big });
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.goto(B.base + '/arena?coin=btc&tf=15m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000);
  rows.push({ kind: 'before', ...(await page.evaluate(READ)) });
  tClick = Date.now(); await page.locator('.klc-tf-btn', { hasText: /^5m$/ }).first().click({ timeout: 5000 }).catch(() => {});
  let landed = null;
  for (let s = 2; s <= 80; s += 2) {
    await sleep(2000); const r = await page.evaluate(READ); rows.push({ kind: 'snap', s, ...r }); if (landed === null && r.spacingMin === 5 && r.bars > 100) landed = s;
    if (landed !== null && s >= landed + 6) break; writeFileSync(`${dir}/${outArg}`, JSON.stringify({ rows, reqs }, null, 1));
  }
  rows.push({ kind: 'result', mode, secondsUntil5mCandles: landed, heldOrDelayed: held, historyRequestsAfterClick: reqs.filter((q) => q.big !== false).length });
  await ctx.close();
} catch (e) { rows.push({ kind: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify({ rows, reqs }, null, 1)); }
for (const r of rows) console.log(r.kind === 'snap' ? `+${String(r.s).padStart(2)}s spacing=${r.spacingMin}min bars=${r.bars} url=${r.urlTf} btn=${r.activeBtn} ind=${r.indicatorTf} banner=${r.banner}` : JSON.stringify(r));
console.log('klines after click:', JSON.stringify(reqs.filter((q) => q.s !== null)));
