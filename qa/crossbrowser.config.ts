import { defineConfig, devices } from '@playwright/test';
import { isProductionTarget, assertProductionRunAllowed } from './prod-readonly.ts';

/* THE CROSS-BROWSER PASS (#1410) - a SEPARATE config, run explicitly.
 *
 * Everything this project tests automatically runs on Chromium: playwright.config.ts
 * has two projects and both are Chromium at different viewports, and the qa/*.mjs
 * audit tools launch Chromium too. So the engines real visitors use are checked by
 * nobody, and the one Brave defect anyone has found was found by hand.
 *
 * WHY A SECOND CONFIG RATHER THAN MORE PROJECTS IN THE FIRST. Adding firefox and
 * brave projects to playwright.config.ts would put them in the path of every
 * ordinary run: a routine `npx playwright test` would try to launch a Firefox that
 * may not be installed and a Brave that only exists on some machines, and fail for
 * reasons that have nothing to do with the change under test. This config is opted
 * into, names its own testMatch, and leaves the everyday suite exactly as it was.
 *
 *   E2E_BASE_URL=https://liquidity-hq-staging.onrender.com \
 *     npx playwright test --config qa/crossbrowser.config.ts
 *
 * STAGING ONLY, and the production guard is imported here too rather than trusted
 * to the other file - a config that skipped it would be a way around the thing
 * #1364 exists to enforce. E2E_BASE_URL is REQUIRED: without it the base config
 * would build and boot a local app, which is not what this measures (a local build
 * is not what a visitor loads) and would silently produce a pass about nothing.
 *
 * THE CHROMIUM PROJECTS ARE THE CONTROL, and they are not optional. A finding that
 * reads "the panel overlaps in Firefox" means nothing until the same measurement on
 * the same page at the same width says it does NOT overlap in Chromium. Without
 * that column every pre-existing bug in the app reads as a Firefox bug. Same
 * discipline as the control host in #1397's load measurement.
 */

const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, '');
if (!BASE_URL) {
  throw new Error(
    'REFUSING TO RUN: qa/crossbrowser.config.ts needs E2E_BASE_URL (staging). ' +
    'Without it the suite would boot a local build, which is not what this pass measures. ' +
    'E2E_BASE_URL=https://liquidity-hq-staging.onrender.com npx playwright test --config qa/crossbrowser.config.ts',
  );
}
if (isProductionTarget(BASE_URL)) assertProductionRunAllowed(process.env);

/* Brave is a real installed browser, not a Playwright download: it is driven by
 * pointing Chromium's launcher at its binary. Overridable for a machine that keeps
 * it elsewhere; when it is absent the brave projects fail at launch with Playwright's
 * own "executable doesn't exist" message, which is the honest outcome - better than
 * silently substituting Chromium and reporting a Brave column that is not Brave.
 *
 * SHIELDS ARE LEFT AT THEIR DEFAULT, deliberately. A fresh Brave profile starts with
 * standard shields, and that is what a visitor has. Lowering them to make the pass
 * green would test a browser nobody runs - the shields ARE the part of Brave most
 * likely to break something (storage, third-party requests, fingerprinting defences
 * that change what `canvas` and `navigator` report). */
const BRAVE_PATH = process.env.QA_BRAVE_PATH
  ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

export default defineConfig({
  testDir: './e2e',
  /* Only this pass's own spec. The rest of the suite is Chromium-tuned - it signs in,
     stubs routes and asserts selector-level detail that has no business being a
     cross-engine claim - and running it here would produce failures nobody would act on. */
  testMatch: /cross-browser-surface\.spec\.ts$/,
  // A cold free-plan service answers the first request in ~50s, and this spec
  // deliberately waits for fonts, canvases and sockets to settle on every page.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  /* One at a time. Three engines against one free-plan instance is exactly the
     ~5 page loads/s ceiling #1397 measured, and a queued page is a page whose
     layout timings mean nothing. Slower, but every number is attributable. */
  workers: 1,
  fullyParallel: false,
  /* Paths in a config resolve against the CONFIG's directory, not the repo root - the
     first version of these two wrote qa/qa/. Both land beside the everyday suite's
     own artefacts and are gitignored there. */
  reporter: [['list'], ['json', { outputFile: '../qa/crossbrowser-report.json' }]],
  outputDir: '../test-results/crossbrowser',
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  projects: [
    // ── the control column ──
    { name: 'chromium-1440', use: { ...devices['Desktop Chrome'], viewport: DESKTOP } },
    { name: 'chromium-390', use: { ...devices['Desktop Chrome'], viewport: MOBILE, isMobile: false, hasTouch: true } },
    // ── Gecko: a genuinely different engine, the one most likely to find real breakage ──
    { name: 'firefox-1440', use: { browserName: 'firefox', viewport: DESKTOP } },
    { name: 'firefox-390', use: { browserName: 'firefox', viewport: MOBILE, hasTouch: true } },
    // ── Brave: Chromium underneath, its own shields on top ──
    { name: 'brave-1440', use: { ...devices['Desktop Chrome'], viewport: DESKTOP, launchOptions: { executablePath: BRAVE_PATH } } },
    { name: 'brave-390', use: { ...devices['Desktop Chrome'], viewport: MOBILE, isMobile: false, hasTouch: true, launchOptions: { executablePath: BRAVE_PATH } } },
  ],
  // Never a local build: see the E2E_BASE_URL refusal above.
  webServer: undefined,
});
