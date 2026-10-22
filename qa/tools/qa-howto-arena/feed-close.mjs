/* #1573: the two cases the fix is about, on the real Bybit stream, BTC 1m, Pro synthetic session.
 *   clean   : after 20 s the "server" closes the chart's socket with a clean close (code 1000). Before the fix the chart never reconnected.
 *   silent  : after 20 s the "server" stops delivering frames but the socket stays open. Watchdog should replace it after ~60 s of silence.
 * Reads every 5 s: kline sockets created, open, frames received, dot, last bar time. Reconnect = a NEW kline.1 subscription appears and frames resume.
 * usage: node feed-close.mjs <qa|prod> <clean|silent> <out.json>                                                                      */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', mode = 'clean', outArg = `feed-close-${mode}.json`] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/tf-freeze`; mkdirSync(dir, { recursive: true });
const rows = []; const T0 = Date.now();
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); rows.push({ kind: 'build', commit: v.commit, mode });
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const routes = []; let framesToPage = 0; let klineFrames = 0; let created = 0;
  // registered after open(), so it takes priority over the plain pass-through for these hosts
  await ctx.routeWebSocket(/^wss:\/\/stream\.(bybit|bytick)\.com/, (ws) => {
    const id = ++created; const srv = ws.connectToServer(); const r = { id, ws, closedByPage: false, topics: [] }; routes.push(r);
    ws.onMessage((m) => { try { const j = JSON.parse(String(m)); if (j.op === 'subscribe') r.topics.push(...(j.args || [])); } catch { /* */ } srv.send(m); });
    ws.onClose(() => { r.closedByPage = true; });
    srv.onMessage((m) => { if (r.silenced) return; if (r.topics.some((t) => /^kline\./.test(t))) klineFrames++; framesToPage++; ws.send(m); });
  });
  const page = await ctx.newPage();
  await page.goto(B.base + '/arena?coin=btc&tf=1m', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(6000);
  const read = () => page.evaluate(() => { const d = document.querySelector('.klc-ws-dot'); return { dot: d ? (d.classList.contains('live') ? 'live' : d.classList.contains('err') ? 'err' : 'connecting') : null }; });
  let injectedAt = null; let lastFrames = 0;
  const total = mode === 'silent' ? 110 : 60;
  for (let s = 0; s <= total; s += 5) {
    if (s === 20 && injectedAt === null) { injectedAt = s; if (mode === 'clean') { const live = routes.filter((r) => !r.closedByPage && r.topics.some((t) => /^kline\./.test(t))).pop(); rows.push({ kind: 'inject', s, mode, target: live ? { id: live.id, topics: live.topics } : null }); if (live) live.ws.close({ code: 1000, reason: 'qa clean close' }); } else { const live = routes.filter((r) => !r.closedByPage && r.topics.some((t) => /^kline\./.test(t))).pop(); if (live) live.silenced = true; rows.push({ kind: 'inject', s, mode, target: live ? { id: live.id, topics: live.topics } : null }); } }
    const d = await read(); const klineOpen = routes.filter((r) => !r.closedByPage && r.topics.some((t) => /^kline\./.test(t)));
    rows.push({ kind: 'snap', s, mode, ...d, klineSocketsCreated: routes.filter((r) => r.topics.some((t) => /^kline\./.test(t))).length, klineOpen: klineOpen.map((r) => ({ id: r.id, t: r.topics.filter((x) => /^kline\./.test(x)) })), framesToPageDelta: klineFrames - lastFrames });
    lastFrames = klineFrames; writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); await sleep(5000);
  }
  await ctx.close();
} catch (e) { rows.push({ kind: 'ERROR', error: String(e.message).slice(0, 200) }); }
finally { await browser.close(); writeFileSync(`${dir}/${outArg}`, JSON.stringify(rows, null, 1)); }
for (const r of rows.filter((x) => x.kind === 'inject' || x.kind === 'snap')) console.log(r.kind === 'inject' ? `-- inject at ${r.s}s ${r.mode}` : `${String(r.s).padStart(3)}s dot=${r.dot} klineCreated=${r.klineSocketsCreated} open=${JSON.stringify(r.klineOpen)} framesLast5s=${r.framesToPageDelta}`);
