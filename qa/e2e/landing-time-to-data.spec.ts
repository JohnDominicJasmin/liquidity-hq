/* THE LANDING'S TIME TO DATA (#2583 + #2592, PM/owner target: data on / within 8 s on 4G + 4x CPU). Signed out, read-only, a deployed site.
 *   TD1  at 390 and 1280, six cold loads each, CPU throttled 4x (CDP) and a 4G network (1.6 Mbps down, 150 ms RTT): the time from navigation start to the FIRST live number on the page
 *        (a BTC price in the page text, $ + digits + a thousands comma, which only a live feed can supply; the markup carries no price), plus LCP and the worst layout shift (hadRecentInput excluded).
 *        The MEDIAN time to data must be under 8 s; the worst load is printed. LCP and CLS are informational (CLS must stay under 0.1, the repo's budget).
 * Nothing is written. Throttling is CDP, so this is Chromium only. Numbers vary with the runner: the median of six is the reading, not one load. */
import { test, expect } from '@playwright/test';

const LOADS = 6;
const TARGET_S = 8;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

for (const width of [390, 1280]) {
  test(`TD1 ${width}: the first live number appears within ${TARGET_S} s (median of ${LOADS} cold loads, 4G + 4x CPU)`, async ({ browser }) => {
    test.setTimeout(LOADS * 70_000);
    const times: number[] = [], lcps: number[] = [], cls: number[] = [];
    for (let i = 0; i < LOADS; i++) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addInitScript(() => {
        try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private */ }
        (window as unknown as { __cls: number; __lcp: number }).__cls = 0; (window as unknown as { __lcp: number }).__lcp = 0;
        try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
        try { new PerformanceObserver((l) => { const e = l.getEntries(); (window as unknown as { __lcp: number }).__lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
      });
      const page = await ctx.newPage();
      try {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
        await page.goto('/', { waitUntil: 'commit' });
        const t0 = await page.evaluate(() => performance.timeOrigin).catch(() => 0);
        const start = Date.now();
        let t = -1;
        while (Date.now() - start < 60_000) {
          const has = await page.evaluate(() => /\$\s?\d{1,3},\d{3}/.test(document.body?.innerText || '')).catch(() => false);
          if (has) { t = (Date.now() - start) / 1000; break; }
          await page.waitForTimeout(250);
        }
        void t0;
        const m = await page.evaluate(() => ({ cls: (window as unknown as { __cls: number }).__cls || 0, lcp: (window as unknown as { __lcp: number }).__lcp || 0 })).catch(() => ({ cls: 0, lcp: 0 }));
        times.push(t < 0 ? 60 : t); lcps.push(m.lcp / 1000); cls.push(m.cls);
        console.log(`[TD] ${width} load ${i + 1}: first live number ${t < 0 ? 'NEVER (60 s)' : t.toFixed(1) + ' s'} · LCP ${(m.lcp / 1000).toFixed(1)} s · CLS ${m.cls.toFixed(3)}`);
      } finally { await ctx.close(); }
    }
    console.log(`[TD] ${width} MEDIAN time to data ${median(times).toFixed(1)} s (min ${Math.min(...times).toFixed(1)}, max ${Math.max(...times).toFixed(1)}) · median LCP ${median(lcps).toFixed(1)} s · worst CLS ${Math.max(...cls).toFixed(3)}`);
    expect(Math.max(...cls), `worst layout shift on / at ${width}`).toBeLessThanOrEqual(0.1);
    expect(median(times), `median time to the first live number on / at ${width} (4G + 4x CPU)`).toBeLessThan(TARGET_S);
  });
}
