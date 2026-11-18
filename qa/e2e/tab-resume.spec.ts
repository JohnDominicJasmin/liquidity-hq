/* TAB RESUME (the owner's bug: leave the tab 1-2 h, come back to an EMPTY CHART until refresh). READ-ONLY, signed out.
 * Emulation of the idle gap: the page is FROZEN through the DevTools protocol (Page.setWebLifecycleState "frozen", what a browser does to a long-hidden tab), the network is OFFLINE for the whole freeze (sockets die), `visibilityState` is forced hidden; then everything is restored (active, online, visible + the visibilitychange / online / focus events a real return fires).
 * v2 (2026-11-18): v1 read the newest x-axis label and a price selector; both were already "stale" BEFORE the freeze (a bad instrument: 233 min old on a live page), and /dashboard and /markets have no chart canvas, so "ink" meant nothing there. v2 reads what the chart itself says and what the network did:
 *   ARENA     the feed dot (.klc-ws-dot title: live / connecting / error) · the number of WebSocket messages received AFTER the resume · sockets opened/closed · canvas ink (still painted)
 *   DASHBOARD / MARKETS   the live price text changes within 15 s of the resume (live data is flowing again) · no dash placeholder
 * Asserts: arena TR1 dot is "live" within 15 s · TR2 at least one WebSocket frame arrived after the resume · TR3 the chart is still painted · other pages TR4 a price changed. Prints every reading ([RESUME]) so a RED shows WHAT stayed stale.
 * FREEZE_S is the idle length (default 150 s; a real "1-2 h" run sets TAB_FREEZE_S=5400). PAGES via TAB_PAGES (arena,dashboard,markets). */
import { test, expect, type Page } from '@playwright/test';

const FREEZE_S = Number(process.env.TAB_FREEZE_S ?? 150);
const ALL: Array<[string, string]> = [['/arena?coin=btc&tf=1m', 'arena'], ['/dashboard', 'dashboard'], ['/markets', 'markets']];
const WANT = (process.env.TAB_PAGES ?? 'arena,dashboard,markets').split(',');
const PAGES = ALL.filter(([, n]) => WANT.includes(n));

const INIT = () => {
  const w = window as unknown as { __ws: { opened: number; closed: number; msgs: number; resumeAt: number; msgsAfter: number; opensAfter: number } };
  w.__ws = { opened: 0, closed: 0, msgs: 0, resumeAt: 0, msgsAfter: 0, opensAfter: 0 };
  const Orig = window.WebSocket;
  const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    w.__ws.opened++; if (w.__ws.resumeAt) w.__ws.opensAfter++;
    ws.addEventListener('message', () => { w.__ws.msgs++; if (w.__ws.resumeAt) w.__ws.msgsAfter++; });
    ws.addEventListener('close', () => { w.__ws.closed++; });
    return ws;
  } as unknown as typeof WebSocket;
  Wrapped.prototype = Orig.prototype;
  Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Wrapped;
};
const read = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ws: { opened: number; closed: number; msgs: number; resumeAt: number; msgsAfter: number; opensAfter: number } };
  let best = 0; for (const c of Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]) { if (c.width < 300 || c.height < 150) continue; try { const d = c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, c.width, c.height).data; if (!d) continue; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; best = Math.max(best, n); } catch { /* tainted */ } }
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  const dot = (document.querySelector('.klc-ws-dot') as HTMLElement | null)?.getAttribute('title') ?? null;
  const price = Array.from(document.querySelectorAll('[data-testid="hero-price"], .arena-price, [class*="price"]')).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^\$?[\d,]+(\.\d+)?$/.test(t)).slice(0, 3).join(' | ');
  return { ink: best, dot, price, ws: { ...w.__ws }, dash: /(^|\s)(—|--)(\s|$)/.test(text) };
});

for (const [path, name] of PAGES) {
  test(`TR:${name}: the page recovers its data after a frozen, offline, hidden gap`, async ({ browser }) => {
    test.setTimeout(240_000 + FREEZE_S * 1000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(INIT);
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(30_000);
      const before = await read(page); console.log(`[RESUME] ${name} BEFORE: ${JSON.stringify(before)}`);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); });
      await ctx.setOffline(true); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch((e) => console.log(`[RESUME] freeze not applied: ${String(e).slice(0, 80)}`));
      await new Promise((r) => setTimeout(r, FREEZE_S * 1000));
      await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined); await ctx.setOffline(false);
      await page.evaluate(() => { (window as unknown as { __ws: { resumeAt: number } }).__ws.resumeAt = Date.now(); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
      const samples: Array<Awaited<ReturnType<typeof read>> & { at: string }> = []; let waited = 0;
      for (const at of [2_000, 5_000, 8_000, 15_000]) { await page.waitForTimeout(at - waited); waited = at; samples.push({ at: `+${at / 1000}s`, ...(await read(page)) }); }
      console.log(`[RESUME] ${name} FREEZE ${FREEZE_S}s AFTER: ${JSON.stringify(samples)}`);
      const last = samples[samples.length - 1];
      if (name === 'arena') {
        expect(last.dot, `TR1 arena: the feed dot is "${last.dot}" 15 s after the resume (before: "${before.dot}")`).toBe('live');
        expect(last.ws.msgsAfter, `TR2 arena: no WebSocket frame arrived in the 15 s after the resume (sockets opened after: ${last.ws.opensAfter})`).toBeGreaterThan(0);
        expect(last.ink, `TR3 arena: the chart is EMPTY after the resume (ink ${last.ink}, before ${before.ink})`).toBeGreaterThan(Math.max(200, before.ink * 0.3));
      } else {
        expect(samples.some((s) => s.price && s.price !== before.price), `TR4 ${name}: the live price never changed in 15 s after the resume (before "${before.price}", after "${last.price}")`).toBe(true);
      }
      expect(last.dash && !before.dash, `TR5 ${name}: a dash placeholder appeared after the resume (none before)`).toBe(false);
    } finally { await ctx.close(); }
  });
}
