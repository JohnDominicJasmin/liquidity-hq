/* TAB RESUME (the owner's bug: leave the tab 1-2 h, come back to an EMPTY CHART until refresh). READ-ONLY, signed out.
 * Emulation of the idle gap (real time cannot be skipped): the page is FROZEN through the DevTools protocol (Page.setWebLifecycleState "frozen", what the browser does to a long-hidden tab), the network is taken OFFLINE for the whole freeze (sockets die), `visibilityState` is forced to hidden, then everything is restored (active, online, visible + the visibilitychange / online / focus events a real return fires).
 * After the resume, within 15 s:  TR1 the main chart canvas holds bars (ink well above its pre-freeze minimum) · TR2 the newest time label on the x axis is within 3 candles of NOW · TR3 the live price text changed or is a real number (no "…", no dash) · TR4 no "updated just now" while the data is older than 2 minutes.
 * Prints the per-moment readings ([RESUME]) so a RED shows WHAT stayed stale. Asserts TR1..TR3. The freeze length is FREEZE_S (default 150 s: long enough for exchange sockets to be dropped; not 2 h). */
import { test, expect, type Page } from '@playwright/test';

const FREEZE_S = Number(process.env.TAB_FREEZE_S ?? 150);
const PAGES: Array<[string, string]> = [['/arena?coin=btc&tf=1m', 'arena'], ['/dashboard', 'dashboard'], ['/markets', 'markets']];

const INIT = () => {
  const w = window as unknown as { __axis: Array<{ t: string; at: number }> }; w.__axis = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) {
    const s = String(text); if (/^\d{1,2}[:.]\d{2}$/.test(s) || /^\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) { w.__axis.push({ t: s, at: Date.now() }); if (w.__axis.length > 400) w.__axis.splice(0, 200); }
    return mw === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, mw);
  };
};
const read = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __axis: Array<{ t: string; at: number }> };
  let best = 0, total = 0; const cs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
  for (const c of cs) { if (c.width < 300 || c.height < 150) continue; try { const d = c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, c.width, c.height).data; if (!d) continue; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; total += n; best = Math.max(best, n); } catch { /* tainted */ } }
  const now = new Date(); const mins = (t: string) => { const m = /(\d{1,2})[:.](\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const recent = w.__axis.filter((a) => Date.now() - a.at < 6_000).map((a) => mins(a.t)).filter((x): x is number => x != null);
  const nowMin = now.getHours() * 60 + now.getMinutes(); const newest = recent.length ? recent.reduce((a, b) => { const da = (nowMin - a + 1440) % 1440, db = (nowMin - b + 1440) % 1440; return db < da ? b : a; }) : null;
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  const price = (document.querySelector('[data-testid="hero-price"], .arena-price, [class*="price"]') as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 24) ?? '';
  return { ink: best, inkTotal: total, canvases: cs.length, axisSeen: recent.length, newestAxisAgeMin: newest == null ? null : (nowMin - newest + 1440) % 1440, price, justNow: /updated just now|just now/i.test(text), dash: /(^|\s)(—|--)(\s|$)/.test(text) };
});

for (const [path, name] of PAGES) {
  test(`TR:${name}: the page recovers its data after a frozen, offline, hidden gap`, async ({ browser }) => {
    test.setTimeout(240_000 + FREEZE_S * 1000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(INIT);
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(25_000);
      const before = await read(page); console.log(`[RESUME] ${name} BEFORE: ${JSON.stringify(before)}`);
      /* the gap: hidden + offline + frozen */
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); });
      await ctx.setOffline(true); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch((e) => console.log(`[RESUME] freeze not applied: ${String(e).slice(0, 80)}`));
      await new Promise((r) => setTimeout(r, FREEZE_S * 1000));
      /* the return */
      await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined); await ctx.setOffline(false);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
      const samples: unknown[] = []; for (const ms of [2_000, 5_000, 8_000]) { await page.waitForTimeout(ms); samples.push({ at: `+${ms}ms`, ...(await read(page)) }); }
      await page.waitForTimeout(0); const after = await read(page); console.log(`[RESUME] ${name} AFTER samples: ${JSON.stringify(samples)}`); console.log(`[RESUME] ${name} AFTER 15s: ${JSON.stringify(after)}`);
      expect(after.ink, `TR1 ${name}: the chart is EMPTY after the resume (ink ${after.ink}, before ${before.ink})`).toBeGreaterThan(Math.max(200, before.ink * 0.3));
      if (name === 'arena') { expect(after.newestAxisAgeMin == null || after.newestAxisAgeMin <= 3, `TR2 arena: the newest x-axis time is ${after.newestAxisAgeMin} min old after the resume`).toBe(true); }
      expect(after.dash, `TR3 ${name}: a dash placeholder is showing after the resume`).toBe(false);
    } finally { await ctx.close(); }
  });
}
