import { test, expect } from '@playwright/test';

/* Does each API route return the cache policy it is supposed to?
 *
 * Nothing in this suite asserts a `Cache-Control` header today, so one could be
 * deleted and no test would notice - the same shape as every other gap this
 * suite has closed.
 *
 * WHY IT MATTERS BEYOND TIDINESS. `qa/API_CACHE_AUDIT.md` measured 6 of 37
 * third-party routes carrying any policy. `/api/market/snapshot` sends
 * `s-maxage=60`, so its upstream cost is a function of TIME - one call a minute
 * serves one user or ten thousand. `/api/funding` sends nothing, so it calls
 * Binance and Bybit again on every page load and scales linearly with users.
 *
 * A header is also exactly the kind of thing that disappears in a refactor
 * without anyone noticing, because nothing breaks - it just gets expensive.
 *
 * ── TWO GROUPS, AND THE SECOND IS DELIBERATELY NOT STRICT ──────────────────
 *
 * SHIPPED: routes that already carry a policy. Asserted exactly. If one of
 * these changes, that is a regression and this fails.
 *
 * PROPOSED: routes the audit flagged as uncached, with values proposed for dev
 * on 2026-08-09. They are recorded here as a KNOWN state - the test asserts what
 * is true TODAY (no policy) and names what it should become. When dev applies a
 * policy, this test FAILS, and that failure is the signal to move the route into
 * the SHIPPED group.
 *
 * That is the same inverting-assertion pattern used for #157 in i18n.spec.ts. A
 * skip would have stayed silent; a passing test that names its own obsolescence
 * cannot rot.
 */

/** Routes with a policy today. Asserted exactly - a change here is a regression. */
const SHIPPED: Array<{ path: string; expect: RegExp; note: string }> = [
  { path: '/api/market/snapshot', expect: /s-maxage=60\b/,   note: 'Binance + CMC' },
  { path: '/api/market/rsi',      expect: /s-maxage=60\b/,   note: 'Binance' },
  { path: '/api/macro',           expect: /s-maxage=300\b/,  note: 'Yahoo, er-api' },
  { path: '/api/econ-calendar',   expect: /s-maxage=3600\b/, note: 'ForexFactory, Fed' },
  { path: '/api/ath',             expect: /s-maxage=3600\b/, note: 'CoinGecko' },
];

/** Uncached today. Proposed values are in the failure message, not asserted. */
const PROPOSED: Array<{ path: string; proposed: string; why: string }> = [
  { path: '/api/funding',         proposed: 's-maxage=60, swr=600',   why: 'funding settles on a fixed 8-hour schedule' },
  { path: '/api/cycle',           proposed: 's-maxage=300, swr=600',  why: 'a slow signal; 5 minutes changes nobody\'s decision' },
  { path: '/api/signal-accuracy', proposed: 's-maxage=3600, swr=7200', why: 'historical stats, change when outcomes resolve' },
  { path: '/api/cmc',             proposed: 's-maxage=300, swr=600',  why: 'CoinMarketCap is credit-metered - longer is strictly cheaper' },
];

test.describe('API cache policy', () => {
  // HTTP-level; the mobile project would fetch identical headers.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'response headers are viewport-independent');
  });

  for (const { path, expect: pattern, note } of SHIPPED) {
    test(`${path} still caches at the edge (${note})`, async ({ request }) => {
      const res = await request.get(path);

      /* A 4xx/5xx can carry no cache header for reasons that have nothing to do
       * with policy, so a failing route must not read as a missing policy.
       *
       * SKIP, NOT FAIL, and this changed on 2026-08-10 after the first run
       * against a DEPLOYED environment. `/api/ath` returns 502 on qa while
       * production serves 200 from the same commit - CoinGecko rate-limits per
       * IP and the qa instance has spent its budget, which `lib/apiCache.ts`
       * already documents.
       *
       * Failing here reported that as `/api/ath returned 502 - cannot judge its
       * cache policy` in the middle of a cache-policy run, which reads like this
       * PR broke caching. It is an environmental limit on one non-prod service
       * and has nothing to do with any header.
       *
       * The 502 is NOT swallowed - `cache-effective.spec.ts` asserts it as a
       * KNOWN condition that fails the day qa starts succeeding. So the outage
       * is still tracked, by a test whose subject it actually is, and this file
       * goes back to only ever reporting on cache policy. */
      test.skip(res.status() >= 400,
        `${path} returned ${res.status()}, so there is nothing to judge here - a failing route ` +
        'carries no cache policy either way. This is NOT a silent pass: the failure itself is ' +
        'asserted in cache-effective.spec.ts, which fails when the route recovers. If you are ' +
        'seeing this for a route other than /api/ath, that is a new upstream outage - check it ' +
        'there rather than treating this skip as the finding.');

      const cc = res.headers()['cache-control'] ?? '';
      expect(cc,
        `${path} lost its Cache-Control header. It previously sent a policy matching ` +
        `${pattern}. Without it this route calls its upstream on EVERY request rather than ` +
        `once per window, so cost scales with users instead of with time. See ` +
        `qa/API_CACHE_AUDIT.md.`,
      ).toMatch(pattern);

      /* `s-maxage` and not `max-age`: max-age caches in the USER'S browser and
       * does nothing for the second visitor. /api/forex/jpy has that mistake
       * today and it is why this assertion is separate. */
      expect(cc, `${path} must cache at the shared edge, not only in one browser`).toContain('s-maxage');
    });
  }

  /* KNOWN, and written to fail when it is fixed. */
  for (const { path, proposed, why } of PROPOSED) {
    test(`KNOWN: ${path} has no cache policy yet`, async ({ request }) => {
      const res = await request.get(path);
      const cc = res.headers()['cache-control'] ?? '';

      expect(cc,
        `${path} now sends "${cc}" - a cache policy has been applied and this KNOWN test is ` +
        `obsolete. That is the good outcome. Move this route into the SHIPPED list above with ` +
        `its actual value and delete this entry.\n\n` +
        `Proposed on 2026-08-09 was: ${proposed} (${why}).`,
      ).not.toContain('s-maxage');
    });
  }

  /* Not in either list: /api/forex/jpy uses `max-age`, which caches per-browser
   * and does nothing for the second visitor. Recorded as its own case because
   * "has a header" and "has a USEFUL header" are different claims, and the audit
   * found this one had been mistaken for the first. */
  test('KNOWN: /api/forex/jpy caches per-browser, not at the edge', async ({ request }) => {
    const res = await request.get('/api/forex/jpy');
    const cc = res.headers()['cache-control'] ?? '';

    expect(cc, '/api/forex/jpy lost its Cache-Control entirely').toContain('max-age');
    expect(cc,
      '/api/forex/jpy now sends s-maxage - it caches at the shared edge and this KNOWN test is ' +
      'obsolete. Move it into SHIPPED and delete this test.',
    ).not.toContain('s-maxage');
  });
});
