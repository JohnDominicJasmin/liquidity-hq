/* DIAGNOSTIC PROBE for the three harness items still red after run 43241934159. It asserts nothing
 * about the product; it LOGS what each path actually does on a GitHub runner so the cause is read, not
 * guessed. Dispatched like any spec (local stubbed build, no base_url):
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/harness-probe.spec.ts -f project=desktop
 * Delete once the three items are fixed. */
import { test } from '@playwright/test';
import { installMarketFixtures, installSyntheticSocket } from './_fixtures';
import { gotoGuarded } from './_shared';
import { synthCombinedFrame } from '../syntheticMarket.mjs';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test('PROBE 1 - F&G: what does the proxy hand the widget, and does a sparkline draw?', async ({ page }) => {
  await installSyntheticSocket(page);
  await gotoGuarded(page, '/dashboard');
  await page.evaluate(() => localStorage.removeItem('lhq_fng_history'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12_000);
  const probe = await page.evaluate(async () => {
    const r = await fetch('/api/proxy?type=fng&limit=30&format=json');
    const text = await r.text();
    let n = -1; let first = ''; let keys = '';
    try { const j = JSON.parse(text); n = Array.isArray(j?.data) ? j.data.length : -2; first = JSON.stringify(j?.data?.[0] ?? null); keys = Object.keys(j ?? {}).join(','); } catch { /* not json */ }
    const panel = Array.from(document.querySelectorAll('.av-rail-panel')).find(e => /Market conditions/.test(e.textContent || ''));
    return {
      status: r.status, bytes: text.length, head: text.slice(0, 160), dataLen: n, first, keys,
      panelFound: !!panel, polylines: panel ? panel.querySelectorAll('svg polyline').length : -1,
      svgs: panel ? panel.querySelectorAll('svg').length : -1,
      cache: (localStorage.getItem('lhq_fng_history') || 'none').slice(0, 120),
    };
  });
  console.log('[PROBE1]', JSON.stringify(probe));
});

test('PROBE 2 - sentinel: which source sets the first on-screen BTC price?', async ({ page }) => {
  const served = await installMarketFixtures(page, 'price-sentinel');
  await gotoGuarded(page, '/arena', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(45_000);
  const probe = await page.evaluate(async () => {
    const snap = await fetch('/api/market/snapshot').then(r => r.text()).catch(() => 'ERR');
    let snapBtc: unknown = 'n/a';
    try { snapBtc = JSON.parse(snap)?.ticker?.btc?.price; } catch { /* */ }
    const b24 = await fetch('/api/proxy?type=binance-24hr').then(r => r.text()).catch(() => 'ERR');
    const t = document.body.innerText;
    const idx = t.search(/11[,\s]?111/);
    const btcCtx = (t.match(/BTC[^\n]{0,40}\n?[^\n]{0,40}/g) || []).slice(0, 4);
    return { snapshotBtcPrice: snapBtc, binance24hrHead: b24.slice(0, 120), sentinelOnScreen: idx >= 0, btcContexts: btcCtx, textLen: t.length };
  });
  console.log('[PROBE2]', JSON.stringify({ ...probe, servedByKey: served.byKey }));
});

test('PROBE 3 - reconnect: does a routed close() reach the page, with and without a code?', async ({ page, context }) => {
  await page.addInitScript(() => {
    (window as unknown as { __ws: unknown[] }).__ws = [];
    const N = window.WebSocket;
    class W extends N {
      constructor(u: string | URL, pr?: string | string[]) {
        super(u, pr);
        const log = (window as unknown as { __ws: unknown[] }).__ws; const s = String(u).slice(0, 60);
        this.addEventListener('open', () => log.push({ k: 'open', u: s, t: Date.now() }));
        this.addEventListener('close', (e) => log.push({ k: 'close', u: s, code: (e as CloseEvent).code, clean: (e as CloseEvent).wasClean, t: Date.now() }));
        this.addEventListener('error', () => log.push({ k: 'error', u: s, t: Date.now() }));
      }
    }
    window.WebSocket = W as unknown as typeof WebSocket;
  });
  const live: Array<{ close: (o?: { code?: number; reason?: string }) => void }> = [];
  let routed = 0;
  await context.routeWebSocket(/stream\.binance\.com|fstream\.binance\.com/, (ws) => {
    routed += 1;
    live.push(ws);
    const streams = (() => { try { return new URL(ws.url()).searchParams.get('streams') ?? ''; } catch { return ''; } })();
    const syms = streams.split('/').filter(x => x.includes('@ticker')).map(x => x.split('@')[0].toUpperCase());
    const emit = () => { for (const s of (syms.length ? syms : ['BTCUSDT'])) { try { ws.send(synthCombinedFrame(s)); } catch { /* closed */ } } };
    emit(); setInterval(emit, 1000);
  });
  await gotoGuarded(page, '/arena');
  await page.waitForTimeout(15_000);
  const read = () => page.evaluate(() => (window as unknown as { __ws: unknown[] }).__ws);
  console.log('[PROBE3] routed sockets:', routed, '| live now:', live.length, '| page events before:', JSON.stringify(await read()));
  const results: string[] = [];
  for (const [i, ws] of [...live].entries()) {
    try { ws.close(i % 2 === 0 ? { code: 1006 } : undefined); results.push(`#${i} close(${i % 2 === 0 ? '1006' : 'plain'}) ok`); } catch (e) { results.push(`#${i} close threw: ${String(e).slice(0, 80)}`); }
  }
  await page.waitForTimeout(8_000);
  console.log('[PROBE3] close calls:', JSON.stringify(results), '| page events after:', JSON.stringify(await read()));
});
