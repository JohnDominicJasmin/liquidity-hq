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
  expect: { timeout: 10_000 },

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
  // STEPPED TO 2, NOT 4, DELIBERATELY. Rate limits are per-IP and the
  // measurement above is from one developer machine, not CI's shared egress. A
  // clean local number proves the volume is low; it does not prove CI is under
  // the threshold. Two is the smallest step that tests the theory in the place
  // that matters. Raise it only after a green gate at 2.
  //
  // DO NOT EXPECT THE SAVING #114 CLAIMS. With `fullyParallel: false` Playwright
  // parallelises by FILE, and `contrast.spec.ts` is 2 tests in one file taking
  // ~19 of the gate's 41 minutes. It runs on a single worker whatever this
  // number says, so it is the floor. Realistically 41 -> ~20 min, not ~10.
  // Going below that needs contrast split into more files, which is its own
  // change and moves how its baselines are grouped.
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
