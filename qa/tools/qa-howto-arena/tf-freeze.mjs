/* #1572: does the Arena chart freeze while the indicator keeps updating, or show a timeframe that is not the selected one?
 * Pro synthetic session (plan stubbed; client only), BTC, live Bybit/Binance market sockets passed through (lib.mjs liveWs), everything
 * else fenced. After EVERY timeframe change it records, side by side:
 *   selected   : the URL ?tf= and the highlighted chart toolbar button
 *   candles    : bar count, the spacing between the last two bars (= the timeframe the data really is), last bar time, close, volume
 *   indicator  : the timeframe the EMA signal panel says it is computed on ("· 15M chart ·")
 *   feed       : ms since the last live frame arrived on any market socket, sockets opened and closed so far
 * A sample is CONSISTENT when selected = candle spacing = indicator timeframe. Liveness: the last bar's close/volume is read twice,
 * 10 s apart, and must move on the 1m-15m charts.
 * usage: node tf-freeze.mjs <qa|prod> <out.json> [soakSeconds=300]                                                                 */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'tf-freeze.json', soakArg = '300'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '1d': 86400e3 };
const TFS = Object.keys(MS);
const rows = []; const T0 = Date.now();
let lastFrameAt = 0; let wsOpened = 0; let wsClosed = 0; let frames = 0;

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
  const txt = document.body.innerText; const m = txt.match(/·\s*(\d+[mhd])\s+chart/i);
  return { urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, chartRead: !!chart, bars: n, barMs: last && prev ? last.timestamp - prev.timestamp : null, lastTs: last?.timestamp ?? null, lastClose: last?.close ?? null, lastVol: last?.volume ?? null, indicatorTf: m ? m[1].toLowerCase() : null, now: Date.now() };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit, base: B.base, startedAt: new Date().toISOString() });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  page.on('websocket', (ws) => { wsOpened++; ws.on('framereceived', () => { lastFrameAt = Date.now(); frames++; }); ws.on('close', () => { wsClosed++; }); });
  const snap = async (label, want) => {
    const r = await page.evaluate(READ); const sinceFrame = lastFrameAt ? r.now - lastFrameAt : null;
    const spacingOk = r.barMs === null ? null : r.barMs === MS[want];
    const ok = r.urlTf === want && r.activeBtn === want && spacingOk === true && r.indicatorTf === want;
    const row = { step: 'snap', label, want, ...r, sinceFrameMs: sinceFrame, wsOpened, wsClosed, frames, ageOfLastBarMs: r.lastTs ? r.now - r.lastTs : null, consistent: ok, t: Math.round((Date.now() - T0) / 1000) };
    rows.push(row); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); return row;
  };
  const click = (tf) => page.locator('.klc-tf-btn', { hasText: new RegExp(`^${tf}$`) }).first().click({ timeout: 5000 }).catch(() => {});
  await page.goto(B.base + '/arena?coin=btc&tf=15m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000);
  await snap('load', '15m');
  // slow, both orders: 6 s after each switch, then again 10 s later for the liveness read
  for (const [name, order] of [['slow-up', TFS], ['slow-down', [...TFS].reverse()]]) {
    for (const tf of order) {
      await click(tf); await sleep(6000); const a = await snap(`${name}:${tf}:+6s`, tf); await sleep(10000); const b = await snap(`${name}:${tf}:+16s`, tf);
      rows.push({ step: 'live', label: `${name}:${tf}`, closeMoved: a.lastClose !== b.lastClose, volMoved: a.lastVol !== b.lastVol, lastBarSame: a.lastTs === b.lastTs });
    }
  }
  // fast: rapid clicks with no wait, both orders and a shuffle, then let it settle and read
  const rapid = async (name, order, gap) => { for (const tf of order) { await click(tf); await sleep(gap); } const last = order[order.length - 1]; await sleep(8000); await snap(`${name}:settled:${last}`, last); await sleep(10000); await snap(`${name}:settled+10s:${last}`, last); };
  await rapid('fast-up-150ms', TFS, 150); await rapid('fast-down-150ms', [...TFS].reverse(), 150);
  await rapid('fast-up-0ms', TFS, 0); await rapid('fast-down-0ms', [...TFS].reverse(), 0);
  const shuffled = ['5m', '1h', '1m', '4h', '15m', '30m', '1d', '2h', '1m', '15m']; await rapid('fast-shuffle-100ms', shuffled, 100);
  // soak: stay on one timeframe and watch it
  const soak = Number(soakArg); const soakTf = '1m'; await click(soakTf); await sleep(5000);
  for (let s = 0; s < soak; s += 15) { await snap(`soak:${soakTf}:${s}s`, soakTf); await sleep(15000); }
  await snap(`soak:${soakTf}:end`, soakTf);
  await page.screenshot({ path: `${dir}/${B.tag}-${outArg.replace(/\.json$/, '')}-end.png` }).catch(() => {});
  await ctx.close();
} catch (e) { rows.push({ step: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
const s = rows.filter((r) => r.step === 'snap'); console.log(`snaps ${s.length}, inconsistent ${s.filter((r) => !r.consistent).length}, errors ${rows.filter((r) => r.step === 'ERROR').length}`);
for (const r of s.filter((x) => !x.consistent)) console.log(`${r.label} want=${r.want} url=${r.urlTf} btn=${r.activeBtn} spacing=${r.barMs} ind=${r.indicatorTf} read=${r.chartRead} sinceFrame=${r.sinceFrameMs}`);
