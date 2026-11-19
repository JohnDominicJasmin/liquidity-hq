/* #2553 CHART / FEEDS RESUME (owner bug: chart EMPTY after 1-2 h idle). Signed out, read-only (client-side route blocking and an offline switch only; nothing is written anywhere).
 *   CR1  history reload FAILS: all /api/market/klines requests are aborted AFTER the first load, then the timeframe goes 1h -> 4h -> 1h; the 1h candles must still be drawn (canvas ink well above an empty chart). Dev measured: dev 900 (empty) vs fix 6720.
 *   CR2  offline 60 s, back online, `visibilitychange`+`resume` dispatched: a NEW chart socket opens within 2 s of the resume, the console says "[chart] resume: ...", and within 15 s the feed dot is live and frames arrive.
 *   CR3  /liq: the Liquidations feed and the Whale Trades feed are live, go offline 60 s, resume: both are live again within 10 s (a feed that was never live in this environment is reported, not asserted).
 * Every reading is printed ([CR]) so a RED shows what stayed stale. Run it on dev as the CONTROL: CR1 must fail there. */
import { test, expect, type Page } from '@playwright/test';

const INIT = () => {
  const w = window as unknown as { __ws: { opened: number; closed: number; msgs: number; resumeAt: number; msgsAfter: number; opensAfter: number; urls: string[] } };
  w.__ws = { opened: 0, closed: 0, msgs: 0, resumeAt: 0, msgsAfter: 0, opensAfter: 0, urls: [] };
  const Orig = window.WebSocket;
  const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    w.__ws.opened++; if (w.__ws.resumeAt) { w.__ws.opensAfter++; w.__ws.urls.push(String(url).slice(0, 60)); }
    ws.addEventListener('message', () => { w.__ws.msgs++; if (w.__ws.resumeAt) w.__ws.msgsAfter++; });
    ws.addEventListener('close', () => { w.__ws.closed++; });
    return ws;
  } as unknown as typeof WebSocket;
  Wrapped.prototype = Orig.prototype; Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket = Wrapped;
};
const ink = (page: Page) => page.evaluate(() => { let best = 0; for (const c of Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]) { if (c.width < 300 || c.height < 150) continue; try { const d = c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, c.width, c.height).data; if (!d) continue; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; best = Math.max(best, n); } catch { /* tainted */ } } return best; });
/* THE MEASURE FOR "THE CANDLES ARE STILL THERE": the number of distinct pixel COLUMNS of the main chart canvas that hold 6+ red or green candle pixels (a candle body or wick; a thin horizontal price line is not one). Total ink was a bad instrument: one huge live candle painted as much ink as 200 small ones (dev after a failed reload: 1 candle, ink 2214; fix: full history, ink 2884). */
const candleCols = (page: Page) => page.evaluate(() => { let best = 0; for (const c of Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]) { if (c.width < 300 || c.height < 150) continue; try { const ctx = c.getContext('2d', { willReadFrequently: true }); if (!ctx) continue; const d = ctx.getImageData(0, 0, c.width, c.height).data; let cols = 0; for (let x = 0; x < c.width; x++) { let px = 0; for (let y = 0; y < c.height; y++) { const i = (y * c.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], al = d[i + 3]; if (al > 200 && ((r > 170 && g < 110 && b < 120) || (g > 140 && r < 110 && b < 130))) px++; } if (px >= 6) cols++;   /* 6+ candle-coloured pixels in the column: a candle body or wick; a dashed price line is 1-2 px tall and is NOT counted (v3 counted it: dev read 430 columns on ONE candle) */ } best = Math.max(best, cols); } catch { /* tainted */ } } return best; });
const dot = (page: Page) => page.evaluate(() => (document.querySelector('.klc-ws-dot') as HTMLElement | null)?.getAttribute('title') ?? null);
const ws = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __ws: Record<string, unknown> }).__ws }));
async function ctxFor(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(INIT);
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  return ctx;
}
const resumeEvents = (page: Page) => page.evaluate(() => { (window as unknown as { __ws: { resumeAt: number } }).__ws.resumeAt = Date.now(); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('resume')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });

test('CR1. every klines request fails, 1h -> 4h -> 1h: the 1h candles are still drawn', async ({ browser }) => {
  test.setTimeout(180_000); const ctx = await ctxFor(browser); const page = await ctx.newPage();
  try {
    await page.goto('/arena?coin=btc&tf=1h', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(25_000);
    const before = await candleCols(page); await page.screenshot({ path: 'qa/.shots/cr1-1-before.png' }).catch(() => {});
    const seen: string[] = []; page.on('request', (r) => { if (/kline|candle|history|ohlc/i.test(r.url())) seen.push(`${r.method()} ${r.url().replace(/^https?:\/\//, '').slice(0, 90)}`); });
    const warns: string[] = []; page.on('console', (m) => { if (/\[chart\]|kline|history/i.test(m.text())) warns.push(`${m.type()}: ${m.text().slice(0, 120)}`); });
    await page.route(/\/api\/market\/klines/, (r) => r.abort());
    await page.getByRole('button', { name: /^4h$/i }).first().click({ timeout: 30_000 }); await page.waitForTimeout(6_000); const mid = await candleCols(page); await page.screenshot({ path: 'qa/.shots/cr1-2-on4h.png' }).catch(() => {});
    await page.getByRole('button', { name: /^1h$/i }).first().click({ timeout: 30_000 }); await page.waitForTimeout(8_000); const after = await candleCols(page);
    await page.screenshot({ path: 'qa/.shots/cr1-3-after.png' }).catch(() => {}); console.log(`[CR] CR1 requests after the block (${seen.length}): ${JSON.stringify(seen.slice(0, 12))} · chart logs ${JSON.stringify(warns.slice(0, 8))}`);
    console.log(`[CR] CR1 candle columns before ${before} · on 4h (klines blocked) ${mid} · back on 1h ${after}`);
    expect(before, 'CONTROL: the candles were drawn before the klines were blocked').toBeGreaterThan(100);
    expect(after, `CR1: the 1h chart lost its candles after a failed reload (candle columns ${after}, was ${before})`).toBeGreaterThan(before * 0.6);
  } finally { await ctx.close(); }
});

test('CR2. offline 60 s then resume: a new chart socket within 2 s, a resume log, live within 15 s', async ({ browser }) => {
  test.setTimeout(240_000); const ctx = await ctxFor(browser); const page = await ctx.newPage(); const logs: string[] = [];
  page.on('console', (m) => { const t = m.text(); if (/\[chart\]/.test(t)) logs.push(`${m.type()}: ${t.slice(0, 140)}`); });
  try {
    await page.goto('/arena?coin=btc&tf=1m', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(30_000);
    const before = { dot: await dot(page), ink: await ink(page), ws: await ws(page) }; console.log(`[CR] CR2 BEFORE ${JSON.stringify(before)}`);
    await ctx.setOffline(true); await page.waitForTimeout(60_000); await ctx.setOffline(false); const t0 = Date.now(); await resumeEvents(page);
    let within2: number | null = null; for (let i = 0; i < 10; i++) { await page.waitForTimeout(200); const s = await ws(page); if ((s.opensAfter as number) > 0) { within2 = Date.now() - t0; break; } }
    await page.waitForTimeout(13_000); const after = { dot: await dot(page), ink: await ink(page), ws: await ws(page) };
    console.log(`[CR] CR2 first new socket after ${within2} ms · AFTER ${JSON.stringify(after)} · logs ${JSON.stringify(logs)}`);
    expect(before.dot, 'CONTROL: the feed was live before the offline period').toBe('live');
    expect(within2, 'CR2a: no new chart socket opened within 2 s of the resume').not.toBeNull();
    expect(logs.some((l) => /\[chart\] resume: (reconnect|reload)/.test(l)), `CR2b: no "[chart] resume:" console line (got ${JSON.stringify(logs)})`).toBe(true);
    expect(after.dot, `CR2c: feed dot is "${after.dot}" 15 s after the resume`).toBe('live');
    expect((after.ws as { msgsAfter: number }).msgsAfter, 'CR2d: no frame arrived after the resume').toBeGreaterThan(0);
    expect(after.ink, 'CR2e: the chart went empty').toBeGreaterThan(Math.max(200, before.ink * 0.3));
  } finally { await ctx.close(); }
});

test('CR3. /liq: liquidations feed and whale trades feed are live again after offline 60 s + resume', async ({ browser }) => {
  test.setTimeout(240_000); const ctx = await ctxFor(browser); const page = await ctx.newPage();
  const read = () => page.evaluate(() => ({ liq: Array.from(document.querySelectorAll('.liqfeed-dot')).map((e) => e.className.replace(/.*liqfeed-dot-/, '')), whale: Array.from(document.querySelectorAll('.wf-dot')).map((e) => e.className.replace(/.*wf-dot-/, '')) }));
  try {
    await page.goto('/liq', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(30_000); const before = await read(); const wsB = await ws(page);
    await ctx.setOffline(true); await page.waitForTimeout(60_000); await ctx.setOffline(false); await resumeEvents(page);
    await page.waitForTimeout(10_000); const after = await read(); const wsA = await ws(page);
    console.log(`[CR] CR3 before ${JSON.stringify(before)} sockets ${wsB.opened}/${wsB.msgs} · after ${JSON.stringify(after)} new sockets ${wsA.opensAfter} frames after ${wsA.msgsAfter}`);
    const liqWas = before.liq.includes('live'), whaleWas = before.whale.includes('live');
    if (liqWas) expect(after.liq.includes('live'), `CR3a: the liquidations feed is ${JSON.stringify(after.liq)} 10 s after the resume`).toBe(true);
    if (whaleWas) expect(after.whale.includes('live'), `CR3b: the whale trades feed is ${JSON.stringify(after.whale)} 10 s after the resume`).toBe(true);
    expect(liqWas || whaleWas, 'CONTROL: neither feed was live before the offline period in this environment (nothing proven)').toBe(true);
  } finally { await ctx.close(); }
});
