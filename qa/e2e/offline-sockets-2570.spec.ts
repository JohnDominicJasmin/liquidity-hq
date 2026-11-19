/* #2570 OFFLINE RECONNECT BACKOFF (QA finding of 2026-11-18: a 90-minute offline run on prod opened ~1,554 sockets, one every ~3.5 s). Signed out, read-only (an offline switch and a socket counter only).
 *   OS1  /arena offline for 120 s: the page opens FEW sockets (the old loop opened ~35 in that time; the specified schedule 5,5,5,8,16,30 s allows at most ~10 per loop and there are a handful of loops: asserted as <= 25 in total), and after the network returns + resume events a NEW socket opens within 3 s and the feed dot is live within 20 s (recovery is not slowed by the backoff)
 *   OS2  same on /liq (liquidations + whale trades feeds): few sockets offline, live again within 20 s of the return
 * Prints [OS] readings. The same cell on dev is the CONTROL (OS1/OS2 must fail the count there). */
import { test, expect, type Page } from '@playwright/test';

const INIT = () => {
  const w = window as unknown as { __ws: { opened: number; resumeAt: number; opensAfter: number } }; w.__ws = { opened: 0, resumeAt: 0, opensAfter: 0 };
  const Orig = window.WebSocket;
  const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) { const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols); w.__ws.opened++; if (w.__ws.resumeAt) w.__ws.opensAfter++; return ws; } as unknown as typeof WebSocket;
  Wrapped.prototype = Orig.prototype; Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket = Wrapped;
};
const ws = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __ws: Record<string, number> }).__ws }));
const dots = (page: Page) => page.evaluate(() => ({ chart: (document.querySelector('.klc-ws-dot') as HTMLElement | null)?.getAttribute('title') ?? null, liq: Array.from(document.querySelectorAll('.liqfeed-dot')).map((e) => e.className.replace(/.*liqfeed-dot-/, '')), whale: Array.from(document.querySelectorAll('.wf-dot')).map((e) => e.className.replace(/.*wf-dot-/, '')) }));
const resume = (page: Page) => page.evaluate(() => { (window as unknown as { __ws: { resumeAt: number } }).__ws.resumeAt = Date.now(); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('resume')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });

for (const [path, name] of [['/arena?coin=btc&tf=1m', 'OS1 arena'], ['/liq', 'OS2 liq']] as const) {
  test(`${name}: offline 120 s opens few sockets, and the return recovers quickly`, async ({ browser }) => {
    test.setTimeout(300_000); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(INIT);
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(30_000); const before = await ws(page); const dBefore = await dots(page);
      await ctx.setOffline(true); await page.waitForTimeout(120_000); const offlineTotal = (await ws(page)).opened - before.opened;
      await ctx.setOffline(false); const t0 = Date.now(); await resume(page); let first: number | null = null; for (let i = 0; i < 15; i++) { await page.waitForTimeout(200); if ((await ws(page)).opensAfter > 0) { first = Date.now() - t0; break; } }
      await page.waitForTimeout(18_000); const dAfter = await dots(page);
      console.log(`[OS] ${name}: before ${JSON.stringify(dBefore)} · sockets opened while offline (120 s) ${offlineTotal} · first new socket after the return ${first} ms · after ${JSON.stringify(dAfter)}`);
      expect(offlineTotal, `${offlineTotal} sockets opened in 120 s offline (the backoff should keep this under 25)`).toBeLessThanOrEqual(25);
      expect(first, 'no new socket within 3 s of the network returning').not.toBeNull(); expect(first!, `first new socket took ${first} ms`).toBeLessThanOrEqual(3_000);
      if (name.startsWith('OS1')) expect(dAfter.chart, `the chart feed dot is "${dAfter.chart}" 20 s after the return`).toBe('live');
      else { expect([...dAfter.liq, ...dAfter.whale].includes('live'), `liq/whale dots after the return: ${JSON.stringify(dAfter)}`).toBe(true); }
    } finally { await ctx.close(); }
  });
}
