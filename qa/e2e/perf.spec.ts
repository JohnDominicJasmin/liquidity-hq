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

      /* LCP: ASSERTED LOCALLY, RECORDED ONLY IN CI. Changed 2026-08-10.
       *
       * `< 2500` was set from a LOCAL measurement of 84-720ms, with 2500 chosen
       * as generous headroom. That is 3x headroom over a developer machine and
       * none at all over a GitHub runner. Measured on the same commit:
       *
       *     local   8/8 pass
       *     CI      5 fail - /arena 2740 & 3536, /dashboard 4456 & 3204,
       *                      /markets 3080 & 3172, /briefing 3176, /scanner
       *
       * So in CI it failed every run, which means it gated nothing: a test that
       * is always red is indistinguishable from a test nobody reads. It was also
       * invisible for weeks because the browser suite was not running at all
       * (#207), and it is not a product regression - #198 and #201 were cleared
       * by the same-commit local pass.
       *
       * WHY NOT JUST RAISE THE NUMBER. A budget moved to fit the measurement
       * stops being a budget, and `CLS_BUDGET` a few lines up already carries a
       * "Do NOT raise the budget" note for exactly this reason. Raising 2500 to
       * 5000 would make CI green and mean nothing.
       *
       * WHY NOT A CI-SPECIFIC BUDGET YET. That is the right end state, but there
       * are only two CI samples per route - both from dispatches run today - and
       * a threshold set from two points flakes. The /dashboard spread alone is
       * 3204-4456ms. `CLS_BUDGET` earned its numbers over 24 runs; this deserves
       * the same standard rather than a number that looks rigorous.
       *
       * So this follows the CLS_UNSTABLE precedent directly, including its
       * warning: a measured-but-ungated value is WORSE than a bad fixed number,
       * not a pass. The annotation is what stops it reading as one.
       *
       * RETIREMENT CONDITION: once ~10 CI runs exist - which #210 now produces,
       * one per push to `staging` - set a per-route CI budget from the observed
       * distribution the way CLS_BUDGET was set, and delete this branch. */
      /* `E2E_BASE_URL` counts too, and I found that out the hard way AFTER
       * writing the CI split. Run against deployed `staging`, the same routes
       * report:
       *
       *     /login 22184ms   /arena 23404ms   /dashboard 23244ms
       *     /markets 23288ms /briefing 22744ms /scanner 23612ms
       *
       * Twenty-two SECONDS, because both non-prod services are free plan and
       * sleep when idle, so the first measurement after a wake-up is a cold
       * container rather than the app. That is even further from a meaningful
       * budget than a CI runner, and gating on it would have made every remote
       * sign-off run red for a reason that has nothing to do with the code. */
      const UNCALIBRATED_ENV = process.env.CI || process.env.E2E_BASE_URL;

      if (vitals.lcp > 0) {
        if (UNCALIBRATED_ENV) {
          testInfo.annotations.push({
            type: 'known-issue',
            description:
              `${route} LCP ${vitals.lcp}ms - RECORDED, NOT GATED ` +
              `(${process.env.E2E_BASE_URL ? 'deployed service' : 'CI runner'}). This is not a pass. ` +
              'The 2500ms budget was calibrated on a developer machine, where these routes measure ' +
              '84-720ms. A CI runner lands them at 2740-4456ms and a woken free-plan Render service ' +
              'at 22000-23600ms, so gating on that number reports a failure about the environment ' +
              'rather than the app. Collecting samples to set real per-environment budgets - see ' +
              'the comment above for the retirement condition.',
          });
        } else {
          /* Locally the 2500ms bar is meaningful: measured 84-720ms, so a route
           * approaching it really has regressed. This is the half of the
           * assertion that still has teeth, and it is why the check is split
           * rather than deleted. */
          expect(vitals.lcp,
            `${route} LCP ${vitals.lcp}ms exceeded 2500ms on a LOCAL run, where this route ` +
            'normally measures 84-720ms. Local timings have no network latency and no cold ' +
            'start, so this is a real regression rather than an environment difference.',
          ).toBeLessThan(2500);
        }
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
  test('a static legal page does not fan out to market-data APIs', async ({ page, baseURL }, testInfo) => {
    /* THIRD PARTY MEANS "NOT OUR ORIGIN", and that origin is not always
     * localhost.
     *
     * This used to test `!url.startsWith('http://localhost')`, which is correct
     * for a local run and silently wrong for every remote one: with
     * E2E_BASE_URL set, EVERY same-origin request counts as third-party and the
     * number is nonsense.
     *
     * The dangerous part is that it does not fail - it inflates. A baseline
     * comparison against an inflated count either fails for the wrong reason or,
     * worse, passes because the baseline was itself recorded remotely.
     *
     * Found 2026-08-11 alongside the same bug in security.spec.ts, which at
     * least had the decency to ECONNREFUSED. */
    /* `baseURL`, not `page.url()` - the listener is registered BEFORE the
       navigation, so page.url() is still `about:blank` here and every request
       would look foreign. Caught while writing this fix, which is a fair
       indication of how easy the original mistake was to make. */
    const ownOrigin = new URL(baseURL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`).origin;
    const thirdParty: string[] = [];
    page.on('request', r => {
      const url = r.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (url.startsWith(ownOrigin)) return;
      thirdParty.push(url);
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
