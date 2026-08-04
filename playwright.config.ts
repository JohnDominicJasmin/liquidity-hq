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

export default defineConfig({
  testDir: './qa/e2e',
  // Each spec sweeps ~32 routes; the default 30s is not enough on a cold start.
  timeout: 120_000,
  expect: { timeout: 10_000 },

  // A flaky pass is worse than a fail - it teaches everyone to re-run until
  // green. Retries only in CI, and only to absorb genuine cold-start noise.
  retries: process.env.CI ? 1 : 0,
  // Market data comes from shared third-party APIs (Binance/Bybit). Running
  // specs in parallel multiplies that traffic and can trip the app's own
  // per-IP rate limiter, producing 429s that look like product bugs.
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'qa/e2e-report', open: 'never' }], ['list']]
    : [['list'], ['html', { outputFolder: 'qa/e2e-report', open: 'never' }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Real iPhone metrics + touch + mobile UA. The app is an installable PWA,
    // so 375px is a primary target, not an edge case.
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],

  // Playwright builds and boots the app itself so CI and local behave the same.
  // reuseExistingServer locally means a server you already have on 3100 is used
  // as-is; CI always starts its own.
  webServer: {
    command: `npm run build && npm start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
