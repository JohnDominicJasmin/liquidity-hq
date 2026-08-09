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

  /* ── PROMOTED FROM `PROPOSED` when #198 merged, 2026-08-10 ────────────────
   *
   * These five were the KNOWN group. #198 applied a policy to each, those
   * inverting assertions failed exactly as designed, and this is the move they
   * were written to trigger. Values read off `origin/dev` after the merge
   * rather than copied from the PR description.
   *
   * READ THIS BEFORE CONCLUDING ANYTHING ABOUT COST. A policy here does NOT
   * currently save an upstream call. Measured on prod and qa the same day:
   * `age` is absent from every response, `x-render-origin-server: Render` is on
   * every repeat, and a `_next/static` chunk with `max-age=31536000, immutable`
   * is `cf-cache-status: DYNAMIC` too. Nothing in front of this app caches
   * anything, so `s-maxage` has no consumer.
   *
   * What actually collapses upstream calls is server-side: `cached()` in
   * `lib/apiCache.ts` and `next: { revalidate: N }`. That was already working
   * before #198, which is why the real numbers never moved.
   *
   * So these assertions guard a header that is CORRECT and currently INERT.
   * Worth keeping - it starts working the day a CDN appears and costs nothing -
   * but `cache-effective.spec.ts` is the file that measures whether callers are
   * actually served, and this one must not be mistaken for it again. */
  { path: '/api/funding',         expect: /s-maxage=60\b/,   note: 'Binance + Bybit, #198' },
  { path: '/api/cycle',           expect: /s-maxage=300\b/,  note: 'slow signal, #198' },
  { path: '/api/signal-accuracy', expect: /s-maxage=3600\b/, note: 'historical stats, #198' },
  { path: '/api/cmc',             expect: /s-maxage=300\b/,  note: 'CoinMarketCap is credit-metered, #198' },
  { path: '/api/proxy',           expect: /s-maxage=300\b/,  note: 'Coinglass + trends, #198' },
  /* Was the `max-age` case below - a per-browser cache that did nothing for the
   * second visitor. #198 changed it to `s-maxage`, which is the fix. */
  { path: '/api/forex/jpy',       expect: /s-maxage=300\b/,  note: 'was per-browser max-age, #198' },
];

/** Uncached today. Proposed values are in the failure message, not asserted.
 *
 *  EMPTY since #198 - every route that was here now carries a policy and has
 *  moved into SHIPPED above. Kept rather than deleted because the audit in
 *  `qa/API_CACHE_AUDIT.md` covers 37 third-party routes and only 11 are
 *  asserted here, so the next batch has somewhere to go. */
const PROPOSED: Array<{ path: string; proposed: string; why: string }> = [];

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

  /* `/api/forex/jpy` HAD ITS OWN TEST HERE UNTIL #198, and the reason is worth
   * keeping even though the test is gone.
   *
   * It sent `max-age=300`, which caches in ONE browser and does nothing for the
   * second visitor. It was in neither list because "has a header" and "has a
   * USEFUL header" are different claims, and the audit found this route had been
   * mistaken for the first. #198 changed it to `s-maxage` and it moved into
   * SHIPPED above.
   *
   * The distinction it was written to make is the same one this whole file got
   * wrong at a larger scale: a `Cache-Control` header being present says nothing
   * about whether any cache honours it. See `cache-effective.spec.ts`. */
});
