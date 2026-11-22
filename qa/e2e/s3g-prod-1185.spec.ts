/* #1185 SLOW 3G on PRODUCTION (PM 2026-11-23): signed out, read-only (GETs only, nothing written), the audit matrix's own profile (400 kbit/s down, 200 kbit/s up, 400 ms latency), 390 px, a fresh context per page.
 * Per page: first text (first paint with any text), LCP, and MAIN CONTENT = the first moment the page body holds 300 characters of text and no skeleton / aria-busy element is visible. The criterion on the tracker is main content under 5 s on every page. Prints [S3G1185] lines; the assertion is soft so one page never hides the rest. */
import { test, expect } from '@playwright/test';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

const PAGES = ['/', '/about', '/faq', '/liq', '/news'] as const;
for (const path of PAGES) {
  test(`S3G1185 ${path}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
      const s: { lcp: number; fcp: number; main: number } = { lcp: 0, fcp: 0, main: 0 }; (window as unknown as { __s: typeof s }).__s = s;
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* none */ }
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') s.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true }); } catch { /* none */ }
      const tick = () => { if (!s.main && document.body && (document.body.innerText || '').replace(/\s+/g, ' ').trim().length >= 300 && !document.querySelector('[aria-busy="true"], [class*="skeleton"]')) s.main = Math.round(performance.now()); if (!s.main) setTimeout(tick, 100); }; tick();
    });
    const page = await ctx.newPage();
    try {
      await page.goto('/api/version', { waitUntil: 'domcontentloaded' });
      const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) });
      await page.goto(path, { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(40_000);
      const r = await page.evaluate(() => (window as unknown as { __s?: { lcp: number; fcp: number; main: number } }).__s ?? null).catch(() => null);
      console.log(`[S3G1185] ${path} 390 slow 3G (400 kbit/s, 400 ms): first text ${r?.fcp ?? 'n/a'} ms · main content ${r?.main || 'not reached in 40 s'} ms · LCP ${r?.lcp ?? 'n/a'} ms`);
      expect.soft(r?.main || 1e9, `${path}: main content at or above 5 s`).toBeLessThan(5_000);
    } finally { await ctx.close().catch(() => {}); }
  });
}
