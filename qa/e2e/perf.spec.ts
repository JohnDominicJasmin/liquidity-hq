import { test, expect } from '@playwright/test';
import { settle } from './_shared';

// Core Web Vitals + third-party request volume.
//
// These run against a LOCAL server, so timings are a floor, not a field
// measurement - no network latency, no Render cold start. Budgets are set
// loose enough that only a real regression trips them.

const KEY_ROUTES = ['/', '/login', '/arena', '/dashboard', '/markets', '/briefing'];

test.describe('performance', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one viewport is enough for budgets');
  });

  for (const route of KEY_ROUTES) {
    test(`${route} stays within CLS and LCP budget`, async ({ page }) => {
      await settle(page, route);

      const vitals = await page.evaluate(() => new Promise<{ lcp: number; cls: number }>(resolve => {
        let lcp = 0, cls = 0;
        try {
          new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); })
            .observe({ type: 'largest-contentful-paint', buffered: true });
        } catch { /* unsupported - reported as 0 and skipped below */ }
        try {
          new PerformanceObserver(l => {
            for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
              if (!e.hadRecentInput) cls += e.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch { /* unsupported */ }
        setTimeout(() => resolve({ lcp: Math.round(lcp), cls: +cls.toFixed(3) }), 1200);
      }));

      // Measured 0.000 on every page in the audit. 0.1 is the "good" threshold;
      // anything above means content is jumping during load.
      expect(vitals.cls, `${route} CLS regressed to ${vitals.cls}`).toBeLessThan(0.1);

      // Measured 84-720ms locally. 2500ms is Google's "good" bar - generous
      // headroom so this only fires on a genuine regression.
      if (vitals.lcp > 0) {
        expect(vitals.lcp, `${route} LCP ${vitals.lcp}ms`).toBeLessThan(2500);
      }
    });
  }

  // Audit §1.1 - the headline finding. /refund is a static legal page and
  // issued 618 third-party requests on mount (446 Binance + 165 Bybit),
  // because MarketProvider is mounted app-wide. Binance rate-limits per IP,
  // and these come from the USER's browser, so it is the user's own IP that
  // gets banned. The dev machine already returns HTTP 418 from Binance.
  //
  // Baseline is deliberately set just above today's measurement so it cannot
  // get worse, and should be driven towards ~0 for static routes.
  test('a static legal page does not fan out to market-data APIs', async ({ page }, testInfo) => {
    const thirdParty: string[] = [];
    page.on('request', r => {
      const url = r.url();
      if (!url.startsWith('http://localhost') && !url.startsWith('data:')) thirdParty.push(url);
    });

    await page.goto('/refund', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const byHost = thirdParty.reduce<Record<string, number>>((acc, u) => {
      try { const h = new URL(u).host; acc[h] = (acc[h] || 0) + 1; } catch { /* ignore */ }
      return acc;
    }, {});
    testInfo.attach('refund-third-party-requests.json', {
      body: JSON.stringify(byHost, null, 2), contentType: 'application/json',
    });

    const marketCalls = Object.entries(byHost)
      .filter(([h]) => /binance|bybit/.test(h))
      .reduce((s, [, n]) => s + n, 0);

    expect(
      marketCalls,
      `/refund made ${marketCalls} market-data requests (baseline 650). It renders a ` +
      `refund policy and needs none. Fix: do not mount MarketProvider on static routes, ` +
      `then proxy Binance server-side behind cached(). Lower this number as that lands.`,
    ).toBeLessThanOrEqual(650);
  });
});
