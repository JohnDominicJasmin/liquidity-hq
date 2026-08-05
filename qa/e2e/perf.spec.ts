import { test, expect } from '@playwright/test';
import { settle, CLS_BUDGET, CLS_GOOD, CLS_UNSTABLE } from './_shared';

// Core Web Vitals + third-party request volume.
//
// These run against a LOCAL server, so timings are a floor, not a field
// measurement - no network latency, no Render cold start. Budgets are set
// loose enough that only a real regression trips them.

// /scanner was missing from this list until 2026-08-05, and at the time it was
// added it was by far the worst route in the app for layout shift - CLS
// 0.622-1.693 over 10 identical loads even WITH fix/scanner-layout-shift. A
// Core Web Vitals spec that skips the worst offender is not doing its job, and
// this one did for its whole existence.
// It now measures 0.007-0.028 warm over 24 runs and carries a real 0.25 budget
// (see CLS_BUDGET). Worth noting WHY it looked non-deterministic: the route was
// only ever measured on a build missing fix/scanner-card-layout-shift, so the
// spread was a genuine race that has since been fixed - not observer noise. The
// lesson that survives is the sampling one: 3 runs called it fixed, 10 runs
// disproved that.
// If you add a route to the app, add it here too; the cost is a few seconds per
// run.
const KEY_ROUTES = ['/', '/login', '/arena', '/dashboard', '/markets', '/briefing', '/scanner'];

test.describe('performance', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one viewport is enough for budgets');
  });

  for (const route of KEY_ROUTES) {
    test(`${route} stays within CLS and LCP budget`, async ({ page }, testInfo) => {
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

      // Record every measurement, asserted or not, so the number reaches the
      // report even for routes too unstable to gate on.
      testInfo.attach(`cls-${route.replace(/\W+/g, '_') || 'root'}.txt`, {
        body: `${route}  CLS=${vitals.cls}  LCP=${vitals.lcp}ms`,
        contentType: 'text/plain',
      });

      // Audit §3.2 claimed 0.000 everywhere. That was wrong - see CLS_BUDGET
      // and CLS_UNSTABLE in _shared.ts for what actually shifts and by how
      // much. Known-bad routes get a documented budget; the rest are held to
      // the real 0.1 "good" threshold.
      if (CLS_UNSTABLE.has(route)) {
        // Measured and reported, deliberately NOT asserted, for a route whose
        // CLS varies so much that any threshold either flakes or is too loose to
        // catch anything. That is a WORSE state than a bad fixed number, not a
        // pass - the annotation exists so it cannot be mistaken for one.
        // CLS_UNSTABLE is currently EMPTY (/scanner was retired to a real budget
        // on 2026-08-05), so this branch does not run today. Kept because the
        // distinction is real and re-deriving it mid-incident would be worse.
        testInfo.annotations.push({
          type: 'known-issue',
          description:
            `${route} CLS ${vitals.cls} - non-deterministic, not gated. ` +
            `See CLS_UNSTABLE in qa/e2e/_shared.ts for the distribution and the ` +
            `retirement condition.`,
        });
      } else {
        const budget = CLS_BUDGET[route] ?? CLS_GOOD;
        const known = route in CLS_BUDGET;
        expect(
          vitals.cls,
          known
            ? `${route} CLS ${vitals.cls} exceeded its known-bad budget of ${budget}. ` +
              `This route already fails the 0.1 "good" threshold; it just got worse. ` +
              `Do NOT raise the budget - see CLS_BUDGET in qa/e2e/_shared.ts.`
            : `${route} CLS regressed to ${vitals.cls} (budget ${budget}). Content is ` +
              `jumping during load.`,
        ).toBeLessThan(budget);
      }

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
