import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';

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

/**
 * Routes with a policy today. Asserted exactly - a change here is a regression.
 *
 * `perCaller` INVERTS THE SHARED-CACHE ASSERTION for a route whose body depends on WHO IS
 * ASKING. For those, `s-maxage` is not the goal - it is the defect - so the usual
 * "must cache at the shared edge" expectation would be asking for a cross-user leak. See
 * `/api/market/rsi` below.
 */
const SHIPPED: Array<{
  path: string;
  expect: RegExp;
  note: string;
  perCaller?: { vary: string; why: string };
}> = [
  { path: '/api/market/snapshot', expect: /s-maxage=60\b/,   note: 'Binance + CMC' },
  /* NOT A SHARED-CACHE ROUTE SINCE #1263, and this entry must never be "fixed" back.
   *
   * It asserted /s-maxage=60/ for 29 days after the route stopped sending it. The route is
   * RIGHT and the assertion was stale: the body now merges per caller, so
   * `app/api/market/rsi/route.ts` serves `private, max-age=60` with `Vary: Authorization`.
   * `s-maxage` explicitly permits a shared cache to store the response to an authorized
   * request, which is how a Pro body gets served to a free caller - so making this green by
   * restoring `s-maxage` would put the leak back, in a file whose whole subject is cache
   * policy. The sibling control `/api/market/snapshot` still asserts `s-maxage` with no
   * `Vary`, so the instrument can tell the two policies apart and only this route diverged. */
  {
    path: '/api/market/rsi',
    expect: /private,\s*max-age=60\b/,
    note: 'per-caller merge since #1263 - private, NOT shared',
    perCaller: { vary: 'Authorization', why: 'the body merges Pro and free fields per caller (#1263)' },
  },
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
  /* `/api/signal-accuracy` WAS HERE AND ASSERTED NOTHING. Moved to GATED below - it answers
   * 404 on every environment because `SHOW_PERFORMANCE_STATS` is off, so it hit the skip
   * guard on every run while this file reported green. Found 2026-10-29 while verifying the
   * rsi entry: 404 in 0.19s on qa, which is the 4xx case the guard calls permanent. */
  /* THE QUERY PARAMETER IS LOAD-BEARING. Do not "tidy" it away.
   *
   * Both routes dispatch on `?type=` and return 400 to a bare request BY
   * DESIGN, on every service. Measured on qa and production:
   *
   *   /api/proxy           400      /api/proxy?type=etf      200
   *   /api/cmc             400      /api/cmc?type=global     200
   *
   * Without the parameter they hit the skip guard below on EVERY run on EVERY
   * environment, forever - so two of the six routes #198 changed would have
   * been pinned by nothing while the file reported ten green tests.
   *
   * That is the same shape as the `/briefing` exemption removed in #196:
   * invisible in a green run, reads as covered, asserts nothing. Different
   * cause, identical effect on the report. Caught by dev on review of #203,
   * after I promoted these two straight from PROPOSED without noticing that a
   * bare request had never been a valid one. */
  { path: '/api/cmc?type=global', expect: /s-maxage=300\b/,  note: 'CoinMarketCap is credit-metered, #198' },
  { path: '/api/proxy?type=etf',  expect: /s-maxage=300\b/,  note: 'Coinglass + trends, #198' },
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

/**
 * Routes whose cache policy CANNOT BE READ in any environment we test, because a feature flag
 * turns the route off. Unreadable, not wrong - and the distinction matters because the two
 * look identical in a green run.
 *
 * WHY THIS LIST EXISTS. `/api/signal-accuracy` sat in SHIPPED asserting `s-maxage=3600` while
 * answering **404 in 0.19s** on qa: `app/api/signal-accuracy/route.ts:191` returns
 * `{ error: 'Not found' }` when `SHOW_PERFORMANCE_STATS` is off. The skip guard below reads a
 * 4xx as "this spec asked wrong" and skips - correctly - so the entry was pinned by nothing on
 * every run on every service, and the file still reported ten green tests. That is the same
 * shape as the `/briefing` exemption removed in #196 and as the two bare-`?type=` paths caught
 * on review of #203: invisible in a green run, reads as covered, asserts nothing.
 *
 * SO THE SKIP IS REPLACED BY AN ASSERTION. This is not "ignore the route" - it pins the REASON
 * it cannot be measured, and goes RED the day the flag flips, which is the day its cache policy
 * becomes readable and it belongs back in SHIPPED. A permanent silent skip becomes a loud
 * prompt, at the cost of one assertion.
 */
const GATED: Array<{ path: string; flag: string; shipped: string }> = [
  { path: '/api/signal-accuracy', flag: 'SHOW_PERFORMANCE_STATS', shipped: 's-maxage=3600' },
];

test.describe('API cache policy', () => {
  // HTTP-level; the mobile project would fetch identical headers.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'response headers are viewport-independent');
  });

  for (const { path, expect: pattern, note, perCaller } of SHIPPED) {
    test(`${path} still caches at the edge (${note})`, async ({ request }) => {
      const res = await getGuarded(request, path);

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
      /* A 4xx and a 5xx mean OPPOSITE things here, and conflating them is how
       * two routes ended up permanently skipped in #203.
       *
       *   5xx  the upstream is down or the IP is rate-limited. Environmental,
       *        recovers on its own, and the route itself is fine. /api/ath.
       *   4xx  WE asked wrong. The route is healthy and rejected the request,
       *        which almost always means the path in the table above is missing
       *        a required query parameter. A spec bug, and one that never
       *        recovers on its own - it skips on every run on every service
       *        forever while the file reports green.
       *
       * Both still skip rather than fail, because neither says anything about a
       * cache policy. But the message has to name which one it is, or the next
       * person reads a permanent spec bug as a passing upstream blip. */
      const body = await res.text().catch(() => '');
      const unconfigured = /not configured/i.test(body);

      test.skip(res.status() >= 400,
        `${path} returned ${res.status()}, so there is nothing to judge here - a failing route ` +
        'carries no cache policy either way.\n\n' +
        (res.status() < 500
          ? `A 4xx means THIS SPEC ASKED WRONG, not that anything is broken. Check whether ${path} ` +
            'needs a query parameter: /api/cmc and /api/proxy both dispatch on `?type=` and return ' +
            '400 to a bare request by design, on every environment. A skip from this cause is ' +
            'PERMANENT - it will never recover, and the route is pinned by nothing until the path ' +
            'is fixed. Same shape as the /briefing exemption removed in #196.'
          : unconfigured
            ? 'A MISSING API KEY, which is permanent in this environment rather than a passing ' +
              'outage. The route answers 500 "not configured" on every run here and will never ' +
              'recover on its own, so this assertion is pinned by nothing LOCALLY and IN CI.\n\n' +
              'Known and accepted: /api/cmc needs CMC_API_KEY, which CI deliberately does not ' +
              'carry. It is not left unverified - run this spec against a deployed service, where ' +
              'the key exists and the route answers 200:\n\n' +
              '    E2E_BASE_URL=https://liquidity-hq-staging.onrender.com npx playwright test ' +
              'qa/e2e/cache-policy.spec.ts --project=desktop\n\n' +
              'If a NEW route starts skipping for this reason, it is not covered anywhere until ' +
              'someone runs it remotely. Say so rather than letting the green count imply otherwise.'
            : 'A 5xx with no "not configured" is environmental - the upstream is down or this IP ' +
              'is rate-limited, and it recovers on its own. Known case: /api/ath, where CoinGecko ' +
              'limits per IP and both non-prod services have spent their budget while production ' +
              'is fine. Not a silent pass: cache-effective.spec.ts asserts that 502 as a KNOWN ' +
              'condition and fails when the route recovers.'));

      const cc = res.headers()['cache-control'] ?? '';
      expect(cc,
        `${path} lost its Cache-Control header. It previously sent a policy matching ` +
        `${pattern}. Without it this route calls its upstream on EVERY request rather than ` +
        `once per window, so cost scales with users instead of with time. See ` +
        `qa/API_CACHE_AUDIT.md.`,
      ).toMatch(pattern);

      /* `s-maxage` and not `max-age`: max-age caches in the USER'S browser and
       * does nothing for the second visitor. /api/forex/jpy has that mistake
       * today and it is why this assertion is separate.
       *
       * INVERTED for a per-caller route, and the inversion is the point. When the body
       * depends on WHO IS ASKING, `s-maxage` is the defect rather than the goal - it
       * explicitly permits a shared cache to store the response to an authorized request,
       * which is how one caller's body reaches another. So the same file that demands a
       * shared cache for 10 routes must FORBID it for this one, and a reviewer who "fixes"
       * the red assertion by restoring `s-maxage` would be reintroducing a cross-user leak.
       *
       * This is also why `Vary` is asserted rather than assumed: `private` alone stops a
       * CDN, but `Vary: Authorization` is what stops any intermediary keying one entry
       * across both an authorized and an anonymous request. */
      if (perCaller) {
        expect(cc,
          `${path} sends "${cc}", which contains s-maxage. That route's body merges per caller - ` +
          `${perCaller.why} - so a shared cache storing one caller's response can serve it to ` +
          `another. If this assertion is red, the ROUTE regressed; do not satisfy it by changing ` +
          `this expectation back. See app/api/market/rsi/route.ts and #1263.`,
        ).not.toContain('s-maxage');

        /* `headersArray()` AND NOT `headers()`, measured: this route really sends THREE
         * separate `vary` headers - Next's own `rsc, next-router-state-tree, ...`, then
         * `Authorization`, then `Accept-Encoding`. `headers()` collapses duplicates into one
         * value, and exactly how it does that is not something this assertion should depend
         * on; if it ever surfaced only the first, `Authorization` would be absent and this
         * would fail on a correct route. The array form is unambiguous. */
        const vary = res.headersArray()
          .filter((h) => h.name.toLowerCase() === 'vary')
          .map((h) => h.value)
          .join(', ');

        expect(vary,
          `${path} is \`private\` but does not Vary on ${perCaller.vary} (vary: "${vary}"). Without ` +
          `it an intermediary may key one cache entry across an authorized and an anonymous ` +
          `request, which is the same leak \`private\` was added to close.`,
        ).toContain(perCaller.vary);
      } else {
        expect(cc, `${path} must cache at the shared edge, not only in one browser`).toContain('s-maxage');
      }
    });
  }

  /* GATED OFF, and written to fail when the flag flips. No skip: a skip here was permanent
     and silent, which is what put this list in the file. */
  for (const { path, flag, shipped } of GATED) {
    test(`KNOWN: ${path} is gated off, so its cache policy cannot be read here`, async ({ request }) => {
      const res = await getGuarded(request, path);

      expect(res.status(),
        `${path} now answers ${res.status()} instead of 404, so \`${flag}\` is ON here and its ` +
        `cache policy is readable for the first time. That is the good outcome and this test is ` +
        `obsolete: move the route back into SHIPPED with its actual header - it was ` +
        `"${shipped}" before the flag turned off - and delete this entry.\n\n` +
        `It was moved out of SHIPPED because a 404 made the skip guard fire on every run on ` +
        `every environment, so the assertion was pinned by nothing while this file reported ` +
        `green. See app/api/signal-accuracy/route.ts:191.`,
      ).toBe(404);
    });
  }

  /* KNOWN, and written to fail when it is fixed. */
  for (const { path, proposed, why } of PROPOSED) {
    test(`KNOWN: ${path} has no cache policy yet`, async ({ request }) => {
      const res = await getGuarded(request, path);
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
