/* #1572 / PR #1573: the four QA steps, measured. Pro synthetic session (plan stubbed; client only), BTC, live Bybit/Binance sockets passed through.
 *   1  soak 5+ min on 1m: candles keep updating, the connection dot stays live
 *   2  rapid timeframe switching, both orders plus a shuffle: ends on the selected timeframe, candles update, no frozen picture left
 *   3  connection drop: Offline ~15 s then online: dot connecting then live, candles resume      (3b extra: switch timeframe WHILE offline)
 *   4  reload on another timeframe: exactly one kline subscription, for that timeframe
 * Every reading is selected (URL, highlighted button) vs candle spacing vs the EMA panel's timeframe, so the WRONG-TIMEFRAME symptom is
 * watched in every step. A kline subscription is read from the frames the page sends on each socket (Bybit "kline.<iv>.BTCUSDT", Binance @kline_<iv>).
 * usage: node feed-1573.mjs <qa|prod> <out.json> [soakSeconds=330]                                                                  */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'feed-1573.json', soakArg = '330'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '1d': 86400e3 };
const IV = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D' }; const BN = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d' };
const TFS = Object.keys(MS); const rows = []; const T0 = Date.now();
const socks = []; let lastFrameAt = 0;
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
  const m = document.body.innerText.match(/·\s*(\d+[mhd])\s+chart/i); const dot = document.querySelector('.klc-ws-dot');
  const overlay = [...document.querySelectorAll('[class*="freeze"], [class*="snapshot"]')].map((e) => getComputedStyle(e).opacity).filter((o) => o !== '0');
  return { urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, bars: n, barMs: last && prev ? last.timestamp - prev.timestamp : null, lastTs: last?.timestamp ?? null, lastClose: last?.close ?? null, lastVol: last?.volume ?? null, indicatorTf: m ? m[1].toLowerCase() : null, dot: dot ? (dot.classList.contains('live') ? 'live' : dot.classList.contains('err') ? 'err' : 'connecting') : null, frozenOverlay: overlay.length > 0, now: Date.now() };
};
const klineTopics = () => socks.filter((s) => !s.closed).flatMap((s) => s.topics);
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ step: 'build', commit: v.commit, base: B.base, at: new Date().toISOString() });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  page.on('websocket', (ws) => {
    const s = { url: ws.url(), topics: [], closed: false }; socks.push(s);
    const bn = ws.url().match(/@kline_(\w+)/); if (bn) s.topics.push(`bn:${bn[1]}`);
    ws.on('framesent', (f) => { try { const j = JSON.parse(String(f.payload)); if (j.op === 'subscribe') for (const a of j.args || []) if (/^kline\./.test(a)) s.topics.push(`by:${a}`); } catch { /* not json */ } });
    ws.on('framereceived', () => { lastFrameAt = Date.now(); }); ws.on('close', () => { s.closed = true; });
  });
  const snap = async (step, label, want) => {
    const r = await page.evaluate(READ); const topics = klineTopics();
    const wantTopics = [`by:kline.${IV[want]}.BTCUSDT`, `bn:${BN[want]}`];
    const oneSub = topics.length >= 1 && topics.every((t) => wantTopics.includes(t));
    const ok = r.urlTf === want && r.activeBtn === want && r.barMs === MS[want] && r.indicatorTf === want;
    const row = { kind: 'snap', step, label, want, ...r, openKlineTopics: topics, socketsTotal: socks.length, onlyWantedSub: oneSub, sinceFrameMs: lastFrameAt ? r.now - lastFrameAt : null, ageOfLastBarMs: r.lastTs ? r.now - r.lastTs : null, consistent: ok, t: Math.round((Date.now() - T0) / 1000) };
    rows.push(row); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); return row;
  };
  const click = (tf) => page.locator('.klc-tf-btn', { hasText: new RegExp(`^${tf}$`) }).first().click({ timeout: 5000 }).catch(() => {});
  const load = async (tf) => { await page.goto(B.base + `/arena?coin=btc&tf=${tf}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000); };
  // step 1
  const PH = (process.env.PHASE || '1,2,3,3b,4').split(',');
  if (PH.includes('1')) { await load('1m'); const soak = Number(soakArg); for (let s = 0; s <= soak; s += 15) { await snap('1-soak', `${s}s`, '1m'); await sleep(15000); } }
  else await load(PH.includes('3b') ? '15m' : '1m');
  // step 2
  const rapid = async (name, order, gap) => { for (const tf of order) { await click(tf); await sleep(gap); } const last = order[order.length - 1]; await sleep(8000); const a = await snap('2-rapid', `${name}:${last}:+8s`, last); await sleep(10000); const b = await snap('2-rapid', `${name}:${last}:+18s`, last); rows.push({ kind: 'live', step: '2-rapid', label: `${name}:${last}`, closeOrVolMoved: a.lastClose !== b.lastClose || a.lastVol !== b.lastVol }); };
  if (PH.includes('2')) {
    await rapid('up-150ms', TFS, 150); await rapid('down-150ms', [...TFS].reverse(), 150); await rapid('up-0ms', TFS, 0); await rapid('down-0ms', [...TFS].reverse(), 0);
    await rapid('shuffle-100ms', ['5m', '1h', '1m', '4h', '15m', '30m', '1d', '2h', '1m', '15m', '5m', '1h'], 100);
    await rapid('shuffle2-60ms', ['1h', '5m', '30m', '1m', '2h', '15m', '4h', '5m', '1d', '1m', '1h', '15m'], 60);
  }
  // step 3: drop for ~15 s
  if (PH.includes('3')) {
    await click('1m'); await sleep(8000); await snap('3-drop', 'before', '1m');
    await ctx.setOffline(true); await sleep(15000); await snap('3-drop', 'offline+15s', '1m'); await ctx.setOffline(false);
    for (const [lab, wait] of [['online+3s', 3000], ['online+8s', 5000], ['online+15s', 7000], ['online+30s', 15000], ['online+60s', 30000], ['online+90s', 30000]]) { await sleep(wait); await snap('3-drop', lab, '1m'); }
  }
  // step 3b extra: switch timeframe while offline
  if (PH.includes('3b')) {
    await click('15m'); await sleep(8000); await snap('3b-switch-offline', 'before', '15m');
    await ctx.setOffline(true); await sleep(10000); await click('5m'); await sleep(5000); await snap('3b-switch-offline', 'switched-to-5m-offline', '5m'); await sleep(10000); await ctx.setOffline(false);
    for (const [lab, wait] of [['online+5s', 5000], ['online+15s', 10000], ['online+30s', 15000], ['online+60s', 30000], ['online+90s', 30000], ['online+120s', 30000]]) { await sleep(wait); await snap('3b-switch-offline', lab, '5m'); }
  }
  // step 4: reload on another timeframe
  if (PH.includes('4')) for (const tf of ['15m', '4h', '5m']) { socks.length = 0; await load(tf); await snap('4-reload', `tf=${tf}`, tf); await sleep(10000); await snap('4-reload', `tf=${tf}:+10s`, tf); }
  await page.screenshot({ path: `${dir}/${B.tag}-${outArg.replace(/\.json$/, '')}-end.png` }).catch(() => {});
  await ctx.close();
} catch (e) { rows.push({ kind: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
const s = rows.filter((r) => r.kind === 'snap'); console.log(`snaps ${s.length}, inconsistent ${s.filter((r) => !r.consistent).length}, errors ${rows.filter((r) => r.kind === 'ERROR').length}`);
