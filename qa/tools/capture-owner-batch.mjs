/* Owner-look batch, v2: #1113 rollout (079d59cb, all 8 pages incl. fixed settings) + a closer look at the
 * calc/econ-calendar h1-vs-hint stacking + #1455's mobile save-toast against dev's CORRECTED fix (0cf51a8e).
 * All three land together because the capture worktree merges both dev branches - see qa: merge commit.
 *
 * v1 (this file's previous version) missed a documented trap: OnboardingProvider gates EVERY route behind a
 * user_onboarding read (OnboardingGate.tsx - `if (user && !loadError && (!loaded || !state.profileComplete))
 * return <OnboardingFlow .../>`), which renders ONBOARDING_FLOW_PREPARING_TITLE ("Setting up your
 * account...") until that read resolves. v1 never mocked that route and used a fixed 600ms wait, so all 8
 * base-page screenshots showed the loading screen, not the page - only the two fullPage captures happened to
 * clear it, because fullPage's extra scroll/stitch work incidentally bought enough time. qa/e2e/_auth.ts's
 * `gotoSignedIn()` already documents this exact trap ("MATCHED ON STRUCTURE, NOT COPY... `.obw-root.obw-loading`
 * is the discriminator") - this version fixes it the same way PM caught it: mock user_onboarding to resolve
 * immediately with profile_complete:true, AND poll for `.obw-root.obw-loading` to clear rather than trust a
 * fixed timeout.
 *
 * NO REAL CREDENTIALS - same fake-unexpired-session technique as capture-1292.mjs. The settings-conflict shot
 * reuses capture-1292.mjs's exact mock-route + trigger pattern (mocked user_settings GET + /api/settings PATCH
 * returning a rejected field), since that is what actually drives saveStatus to 'conflict' and shows the toast
 * for real, rather than guessing at its rendered position.
 *
 * Usage: node capture-owner-batch.mjs <baseURL> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3102';
const OUT = process.argv[3] ?? '.';
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set in this process\'s env');
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const FAKE_UID = '00000000-0000-4000-8000-00000000fa4e';

function fakeSession() {
  const future = Math.floor(Date.now() / 1000) + 3600;
  return {
    key: `sb-${REF}-auth-token`,
    value: JSON.stringify({
      access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token',
      expires_in: 3600, expires_at: future, token_type: 'bearer',
      user: { id: FAKE_UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }),
  };
}

const ONBOARDING_ROW = {
  user_id: FAKE_UID, tour_seen: true, profile_complete: true,
  checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true,
};
const SETTINGS_ROW = { user_id: FAKE_UID, risk_pct: 1, default_coin: 'BTC', default_tf: '1h', watchlist: [], field_updated_at: {} };

/* Mocked on EVERY page in this batch, not just settings - OnboardingGate wraps the whole app shell, so any
 * signed-in route hits this same read. Matches OnboardingProvider.tsx's own query shape: .select('*').eq
 * ('user_id', user.id).maybeSingle() -> a GET, single row, 200. */
async function mockOnboardingComplete(page) {
  await page.route('**/rest/v1/*user_onboarding*', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONBOARDING_ROW) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

async function newCtx(browser, { mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 900, height: 700 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  const { key, value } = fakeSession();
  await ctx.addInitScript(([k, v, t]) => {
    // localStorage writes first, no setAttribute call - the page's own bootstrap script in app/layout.tsx
    // applies data-theme from localStorage before first paint. Found the hard way capturing #1292: a throw
    // from a premature setAttribute silently skips every statement after it in the same addInitScript.
    localStorage.setItem(k, v);
    localStorage.setItem('theme', t);
  }, [key, value, 'dark']);
  return ctx;
}

async function declineCookies(page) {
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
}

/* MATCHED ON STRUCTURE, NOT COPY - same discriminator qa/e2e/_auth.ts's gotoSignedIn() uses, so a future
 * locale/copy change to ONBOARDING_FLOW_PREPARING_TITLE can't silently make this pass on nothing. 20s, not
 * that helper's 90s - this run mocks the read to resolve near-instantly, so if it is still showing after 20s
 * something is actually wrong, not just a slow dev database. */
async function waitOutOnboardingLoading(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 20_000 });
}

/* ── 1. The 8 rollout pages, first-visit, incl. settings now on the signed-in view ── */

const ROLLOUT_PAGES = [
  { path: '/news', file: 'owner-1113-news.png' },
  { path: '/alerts', file: 'owner-1113-alerts.png' },
  { path: '/settings', file: 'owner-1113-settings.png' },
  { path: '/dashboard', file: 'owner-1113-dashboard.png' },
  { path: '/calc', file: 'owner-1113-calc.png' },
  { path: '/econ-calendar', file: 'owner-1113-econ-calendar.png' },
  { path: '/hours', file: 'owner-1113-hours.png' },
  { path: '/playbook', file: 'owner-1113-playbook.png' },
];

async function captureRolloutPage(browser, { path, file }) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
  await mockOnboardingComplete(page);
  let hadHardFailure = false;
  page.on('pageerror', (e) => { hadHardFailure = true; console.log(`  [pageerror] ${e.message}`); });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 }).catch(() => { hadHardFailure = true; });
  let stuckOnLoading = false;
  await waitOutOnboardingLoading(page).catch(() => { stuckOnLoading = true; });
  await declineCookies(page); // banner can mount either before or after the onboarding wait resolves
  await page.waitForTimeout(300); // settle after the loading screen unmounts, not instead of waiting for it
  await declineCookies(page); // check again - #1292 found the banner mounting late enough to miss the first check
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log(`${file}: pageerror=${hadHardFailure} stuckOnOnboardingLoading=${stuckOnLoading}`);
  await ctx.close();
}

/* ── 2. calc + econ-calendar close-up: full page, so the h1-vs-PageHint stacking is visible in one frame ── */

async function captureHeaderCloseup(browser, { path, file }) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
  await mockOnboardingComplete(page);
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
  let stuckOnLoading = false;
  await waitOutOnboardingLoading(page).catch(() => { stuckOnLoading = true; });
  await declineCookies(page);
  await page.waitForTimeout(300);
  await declineCookies(page);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  console.log(`${file}: captured (full page) stuckOnOnboardingLoading=${stuckOnLoading}`);
  await ctx.close();
}

/* ── 3. #1455: settings save-toast forced to 'conflict', mobile viewport, against dev's corrected fix
   (0cf51a8e) - confirms the toast now clears the REAL terminal .tnav-tabs bar. ── */

const SERVER_WINS_VALUE = 1.5;

async function mockSettingsRoutes(page) {
  await mockOnboardingComplete(page);
  await page.route('**/rest/v1/*user_settings*', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS_ROW) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const body = { ok: true, accepted: [], rejected: ['risk_pct'], settings: { ...SETTINGS_ROW, risk_pct: SERVER_WINS_VALUE } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function captureMobileToastClearance(browser, file) {
  const ctx = await newCtx(browser, { mobile: true });
  const page = await ctx.newPage();
  await mockSettingsRoutes(page);
  await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
  let stuckOnLoading = false;
  await waitOutOnboardingLoading(page).catch(() => { stuckOnLoading = true; });
  await page.waitForSelector('.st-preset', { timeout: 15_000 });
  await declineCookies(page);
  await page.locator('.st-preset', { hasText: '2%' }).click();
  const toast = page.locator('.st-save-toast.conflict');
  await toast.waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.st-preset.on', { hasText: `${SERVER_WINS_VALUE}%` }).waitFor({ state: 'visible', timeout: 3_000 });
  await page.waitForTimeout(150);
  const tabBar = page.locator('[data-design="terminal"] .tnav-tabs, .tnav-tabs');
  const tabBarVisible = await tabBar.first().isVisible().catch(() => false);
  const actualDesign = await page.evaluate(() => document.documentElement.getAttribute('data-design'));
  const overlap = tabBarVisible
    ? await Promise.all([toast.boundingBox(), tabBar.first().boundingBox()]).then(([t, b]) => (t && b ? t.y + t.height > b.y : null))
    : null;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log(`${file}: stuckOnOnboardingLoading=${stuckOnLoading} data-design=${actualDesign} tnav-tabs visible=${tabBarVisible} toast-overlaps-tab-bar=${overlap} (want false)`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const p of ROLLOUT_PAGES) await captureRolloutPage(browser, p);
  await captureHeaderCloseup(browser, { path: '/calc', file: 'owner-1113-calc-fullpage.png' });
  await captureHeaderCloseup(browser, { path: '/econ-calendar', file: 'owner-1113-econ-calendar-fullpage.png' });
  await captureMobileToastClearance(browser, 'owner-1455-mobile-conflict-toast.png');
} finally {
  await browser.close();
}
console.log('done');
