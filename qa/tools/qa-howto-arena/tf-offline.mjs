/* #1572 extra: does the chart recover after the connection drops (laptop sleep, Wi-Fi drop)? Pro synthetic session, BTC, live market sockets.
 * Sequence: 15m settled -> OFFLINE 30 s (the page keeps running) -> switch to 5m WHILE offline -> ONLINE -> read at 5/15/30/60 s.
 * Then a second drop with NO switch. Same readings as tf-freeze.mjs: selected vs candle spacing vs indicator timeframe vs live frames.
 * usage: node tf-offline.mjs <qa|prod> <out.json>                                                                                   */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg = 'tf-offline.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3 };
const rows = []; const T0 = Date.now(); let lastFrameAt = 0; let wsOpened = 0; let wsClosed = 0;
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
  return { urlTf: new URL(location.href).searchParams.get('tf'), activeBtn: (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim() || null, bars: n, barMs: last && prev ? last.timestamp - prev.timestamp : null, lastTs: last?.timestamp ?? null, lastClose: last?.close ?? null, indicatorTf: m ? m[1].toLowerCase() : null, indText: ([...document.querySelectorAll('div')].filter((d) => /moving averages \(fast\/mid\/slow\)/.test(d.textContent || '') && (d.textContent || '').length < 2500).pop()?.innerText || '').replace(/\s+/g, ' ').slice(0, 400), now: Date.now() };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ step: 'build', commit: v.commit });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  page.on('websocket', (ws) => { wsOpened++; ws.on('framereceived', () => { lastFrameAt = Date.now(); }); ws.on('close', () => { wsClosed++; }); });
  const snap = async (label, want) => { const r = await page.evaluate(READ); const ok = r.urlTf === want && r.activeBtn === want && r.barMs === MS[want] && r.indicatorTf === want; const row = { step: 'snap', label, want, ...r, sinceFrameMs: lastFrameAt ? r.now - lastFrameAt : null, ageOfLastBarMs: r.lastTs ? r.now - r.lastTs : null, wsOpened, wsClosed, consistent: ok, t: Math.round((Date.now() - T0) / 1000) }; rows.push(row); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); return row; };
  const click = (tf) => page.locator('.klc-tf-btn', { hasText: new RegExp(`^${tf}$`) }).first().click({ timeout: 5000 }).catch(() => {});
  await page.goto(B.base + '/arena?coin=btc&tf=15m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000);
  await snap('A:before', '15m');
  await ctx.setOffline(true); await sleep(30000); await snap('A:offline+30s', '15m');
  await click('5m'); await sleep(4000); await snap('A:switched-to-5m-while-offline', '5m');
  await ctx.setOffline(false);
  for (const s of [5, 15, 30, 60]) { await sleep(s === 5 ? 5000 : s === 15 ? 10000 : s === 30 ? 15000 : 30000); await snap(`A:online+${s}s`, '5m'); }
  await ctx.setOffline(true); await sleep(60000); await snap('B:offline+60s(no switch)', '5m'); await ctx.setOffline(false);
  for (const s of [5, 15, 30, 60]) { await sleep(s === 5 ? 5000 : s === 15 ? 10000 : s === 30 ? 15000 : 30000); await snap(`B:online+${s}s`, '5m'); }
  await ctx.close();
} catch (e) { rows.push({ step: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows.filter((x) => x.step === 'snap')) console.log(`${r.label} ok=${r.consistent} url=${r.urlTf} btn=${r.activeBtn} spacing=${r.barMs} ind=${r.indicatorTf} sinceFrame=${r.sinceFrameMs === null ? null : Math.round(r.sinceFrameMs / 1000) + 's'} barAge=${r.ageOfLastBarMs === null ? null : Math.round(r.ageOfLastBarMs / 1000) + 's'} ws=${r.wsOpened}/${r.wsClosed}`);
