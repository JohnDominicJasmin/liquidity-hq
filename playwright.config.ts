import { defineConfig, devices } from '@playwright/test';

// E2E config for the QA suite in qa/e2e.
//
// Runs against a PRODUCTION build (`npm run build` + `npm start`), never
// `next dev`. This is deliberate: docs/HANDOVER.md §8 records that Turbopack
// serves stale globals.css in dev and that a dev-server restart does not
// always clear it. A prod build compiles fresh, so a CSS regression caught
// here is real rather than an artefact of the dev server.
//
// PORT 3100, not 3000, so a suite run never collides with a dev server the
// owner already has open.
const PORT = Number(process.env.E2E_PORT ?? 3100);

// ── Running against a DEPLOYED environment ────────────────────────────────
//
// `E2E_BASE_URL` points the whole suite at a real service instead of a local
// build, and suppresses the webServer so nothing is built or booted:
//
//   E2E_BASE_URL=https://liquidity-hq-qa.onrender.com      npx playwright test
//   E2E_BASE_URL=https://liquidity-hq-staging.onrender.com npx playwright test
//
// WHY THIS EXISTS. QA signs off on what is DEPLOYED, and until now the suite
// could only ever address localhost - so every "verified on qa" claim was in
// fact measured against a local build of the same commit. Usually the same
// thing; not always. Two failures this suite has already produced came from
// exactly that gap: a stale `reuseExistingServer` build nearly reported a false
// negative on #180, and #198's cache headers are correct locally and inert on
// the deployed service, because the thing that was missing is infrastructure
// that no local build has.
//
// WHAT DOES NOT WORK REMOTELY, and must be skipped rather than silently
// mismeasured:
//   - `qa/e2e/_fixtures.ts` route stubs still work (they intercept in the
//     BROWSER), but `qa/server-intercept.mjs` does not - it is a node preload
//     for a process we do not own here.
//   - anything asserting build-time env inlining, since we did not do the build.
//
// Both Render non-prod services are on the free plan and sleep when idle, so
// the first request after a quiet period can take ~50s. That is why the
// navigation timeout is raised rather than the suite being called flaky.
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const IS_REMOTE = Boolean(BASE_URL);

export default defineConfig({
  testDir: './qa/e2e',
  // Each spec sweeps ~32 routes; the default 30s is not enough on a cold start.
  //
  // 240s, not 120s. Measured 2026-08-04: a 32-route sweep (a11y, seo) takes
  // ~90s on this dev machine, i.e. 75% of a 120s budget before CI is even
  // involved. A GitHub ubuntu-latest runner is slower, so 120s would have
  // turned every sweep test into a timeout the first time it ran in CI - and a
  // timeout reads as a product failure, not as "the budget was too tight".
  // The per-route cost is settle()'s deliberate 2500ms hydration wait; that
  // wait is load-bearing for measurement accuracy, so the budget moves, not it.
  timeout: 240_000,
  // 30s against a DEPLOYED service, 10s locally.
  //
  // Raising `navigationTimeout` alone was not enough and produced four false
  // failures on `staging` on 2026-08-10: the i18n positive control, two clock
  // holiday assertions and a session-window check all timed out waiting for
  // content, on a service that was serving 200s the whole time. All 18 of those
  // tests passed against a local build of the same commit minutes later.
  //
  // The gap: `navigationTimeout` covers `goto`, but the specs then wait on
  // ELEMENTS, and those waits use this budget. Both Render non-prod services are
  // free-plan and sleep when idle, so a wake-up page can take tens of seconds to
  // become interactive after it has already responded.
  //
  // Local stays at 10s deliberately - a slow local render is a finding, not an
  // environment, and raising it there would hide the thing this budget exists
  // to catch.
  expect: { timeout: process.env.E2E_BASE_URL ? 30_000 : 10_000 },

  // A flaky pass is worse than a fail - it teaches everyone to re-run until
  // green. Retries only in CI, and only to absorb genuine cold-start noise.
  retries: process.env.CI ? 1 : 0,
  // WAS `workers: 1` until 2026-08-09, for a reason that has been measured and
  // turned out to be much smaller than stated. Issue #114.
  //
  // The old comment said: market data comes from shared third-party APIs
  // (Binance/Bybit), parallel specs multiply that traffic and trip the app's own
  // per-IP rate limiter, and the resulting 429s look like product bugs. That was
  // sized at ~11,000 third-party requests per sweep.
  //
  // THAT NUMBER COUNTED BROWSER REQUESTS, and `qa/e2e/_fixtures.ts` now
  // intercepts those (#161). Measured on a full contrast sweep with fixtures
  // installed, what actually leaves the machine is the app's OWN server-side
  // calls:
  //
  //     101 [cmc] · 58 [proxy] · 4 [econ-calendar]  =  ~159 per sweep, ~25/min
  //
  // Two orders of magnitude below the figure the pin was justified with. A local
  // run at `--workers=2` produced ZERO 429s or rate-limit errors.
  //
  // WAS 2 until 2026-08-10, held there because "a clean LOCAL number does not
  // prove CI is under the threshold". CI has now been measured directly, and the
  // answer removes the argument entirely.
  //
  // Full suite, 38 minutes, GitHub runner, `count_egress=true`, run 31352612023:
  //
  //     processes reporting:  12
  //     total outbound:       32
  //           18  wdtjhrilakoitfcezxpx.supabase.co
  //           14  telemetry.nextjs.org
  //
  // ZERO calls to Binance. ZERO to Bybit. ZERO to any rate-limited exchange.
  // Against the ~11,000 the pin was originally justified with.
  //
  // BE PRECISE ABOUT WHY IT IS ZERO - it is not all fixtures, and the second
  // reason bounds the claim:
  //
  //   1. `_fixtures.ts` stubs the browser side. Designed, and working.
  //   2. CI HAS NO API KEYS for most upstreams. `/api/cmc` answers
  //      `500 CMC_API_KEY not configured` before it reaches CoinMarketCap; the
  //      Coinglass paths behave the same. Those routes cannot generate egress
  //      here even when exercised.
  //
  // So the supported claim is narrow: CI cannot trip a per-IP rate limit,
  // because CI barely talks to anything. It says nothing about a developer
  // machine, which has keys and does reach those hosts. Do not quote this as
  // "egress is solved".
  //
  // WHAT TO WATCH INSTEAD OF 429s. The failure mode at 4 is not rate limiting,
  // it is memory: four concurrent browsers on one runner produce timeouts, and a
  // timeout reads as a product failure. If a run at 4 times out where 2 did not,
  // drop it back and say so on #114. That is the revert criterion, written down
  // before the change rather than argued about after.
  //
  // DO NOT EXPECT THE SAVING #114 CLAIMS. With `fullyParallel: false` Playwright
  // parallelises by FILE, so `contrast.spec.ts` is a floor whatever this number
  // says. The old comment sized that floor at "~19 of the gate's 41 minutes";
  // measured 2026-08-10 it is 5.5 min for both themes plus the control, so the
  // floor is much lower than recorded but it is still a floor. Going below it
  // needs contrast split across files, which changes how its baselines group.
  // REVERTED FROM 4 TO 2 on 2026-08-10, by the criterion written before the
  // change rather than argued after it. #114, #215.
  //
  // The egress case for 4 was sound and still is - CI makes 32 outbound calls a
  // run, zero to any exchange, so there is no rate-limit argument left. That was
  // never the failure mode to watch. THIS was, quoted from the comment that
  // shipped with the raise:
  //
  //     "More workers means more concurrent browsers on one runner. Memory
  //      pressure produces timeouts that read as product failures, which is the
  //      failure mode to watch, not 429s. If a run at 4 times out where 2 did
  //      not, drop it back to 2 and say so."
  //
  // Run 31373400708, the first gate at 4:
  //
  //     timeout of 240000ms exceeded                    x4   <- whole-test budget
  //     browserContext.close: Target page, context or browser has been closed
  //     12 failed, 2 flaky, 232 passed in 42.4 min
  //
  // Whole-test timeouts and browser contexts dying, in `layout` and `seo` - the
  // two heaviest route sweeps, which is where memory pressure would land first.
  // The run at 2 (31367427640) produced NEITHER, and was 41.3 min. So 4 bought
  // no wall-clock and cost stability.
  //
  // ONE CONFOUND, NAMED HONESTLY: the dev Supabase auth endpoint was returning
  // 504 on ~half of sign-ins during this run (#223), which accounts for the
  // `bola`, `entitlements` and `payments-webhook` failures and for some of the
  // elapsed time. It does NOT account for `layout` and `seo` - those never sign
  // in - and it does not produce `browserContext ... has been closed`.
  //
  // So the revert is on the evidence that is not confounded, and it is
  // deliberately the conservative reading: 2 is known good.
  //
  // BEFORE RAISING IT AGAIN, in this order: wait for #223 to clear, re-run the
  // gate at 2 to confirm a clean baseline, then try 3 rather than 4. The step
  // from 2 to 4 was too big to attribute, which is the same mistake as the
  // original step from 1 to 2 being justified on a local measurement.
  workers: 2,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'qa/e2e-report', open: 'never' }], ['list']]
    : [['list'], ['html', { outputFolder: 'qa/e2e-report', open: 'never' }]],

  use: {
    baseURL: BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Free-plan Render services sleep when idle; the wake-up request is slow
    // once and fast afterwards. Only raised for remote runs so a genuine local
    // hang still fails fast.
    ...(IS_REMOTE ? { navigationTimeout: 90_000, actionTimeout: 30_000 } : {}),
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Real iPhone metrics + touch + mobile UA. The app is an installable PWA,
    // so 375px is a primary target, not an edge case.
    //
    // browserName MUST stay pinned to chromium. devices['iPhone 13'] carries
    // `defaultBrowserType: 'webkit'`, so without this the whole mobile project
    // silently tries to launch WebKit - which this repo deliberately does not
    // install (E2E_PLAN.md §3.3: Chromium only, the app ships as a
    // Chromium-based PWA + Capacitor Android shell). That mistake made all 71
    // mobile tests fail in ~2ms with "Executable doesn't exist at
    // ...webkit-2336", which reads like 71 product bugs rather than one config
    // line.
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],

  // Playwright builds and boots the app itself so CI and local behave the same.
  // reuseExistingServer locally means a server you already have on 3100 is used
  // as-is; CI always starts its own.
  //
  // ⚠ DO NOT RUN TWO SUITES AT ONCE LOCALLY. The port is fixed, so a second
  // invocation attaches to the first one's server and then tears it down when it
  // finishes - the still-running suite starts getting
  // `net::ERR_CONNECTION_REFUSED at http://localhost:3100/` partway through.
  //
  // Hit on 2026-08-10 while a 19-minute contrast sweep ran in the background and
  // I ran cache-policy tests alongside it. All three contrast tests failed, which
  // read as a broken refactor for a few minutes and was nothing of the kind.
  //
  // It did not become a WRONG result, only a lost one, because contrast.spec.ts
  // asserts every route was actually measured and said so:
  //
  //     These routes were NOT measured, so this run is invalid rather than clean:
  //     /privacy, /terms, /refund, ...
  //
  // That guard is the reason a half-measured sweep cannot report green. Any spec
  // that sweeps routes should have the equivalent - without it this exact
  // accident produces a clean-looking run over a fraction of the surface.
  //
  // If you need concurrency, give the second run its own port: `E2E_PORT=3101`.
  //
  // Omitted entirely when E2E_BASE_URL is set - building and booting a local app
  // we are not going to address would waste ~4 minutes and, worse, could make a
  // remote run look like it passed against something it never touched.
  webServer: IS_REMOTE ? undefined : {
    command: `npm run build && npm start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
