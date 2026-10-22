/* #1292 (d090d232) screenshot capture: the settings-save conflict toast, dark+light x desktop+mobile.
 *
 * NO REAL CREDENTIALS. A fabricated, already-unexpired session blob is written to localStorage before any
 * page script runs (same technique as qa/e2e/arena-authloading-lock-icon.spec.ts's expired-session fixture,
 * except this one is NOT expired, so supabase-js accepts it from cache and never calls the network for a
 * refresh). The initial `user_settings` read and the `/api/settings` PATCH are both intercepted with
 * `page.route()` and answered with synthetic, hand-written responses - nothing here is sent to, or answered
 * by, Supabase or this app's real backend for a real account. The one real network call left is the app's own
 * same-origin `/api/labels` (public label text, no auth, no PII) - unmocked on purpose, same as existing
 * qa/e2e specs' `servedLabels()`.
 *
 * Usage: node capture-1292.mjs <baseURL> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = process.argv[3] ?? '.';
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set in this process\'s env');
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const FAKE_UID = '00000000-0000-4000-8000-00000000fa4e';

function fakeSession() {
  const future = Math.floor(Date.now() / 1000) + 3600; // NOT expired - read from cache, no network refresh
  return {
    key: `sb-${REF}-auth-token`,
    value: JSON.stringify({
      access_token: 'qa.synthetic.access-token', refresh_token: 'qa-synthetic-refresh-token',
      expires_in: 3600, expires_at: future, token_type: 'bearer',
      user: { id: FAKE_UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }),
  };
}

const SETTINGS_ROW = { user_id: FAKE_UID, risk_pct: 1, default_coin: 'BTC', default_tf: '1h', watchlist: [], field_updated_at: {} };
const SERVER_WINS_VALUE = 1.5; // deliberately different from the 2% this run clicks, so the screenshot visibly shows the click LOSING to the server's value, not coincidentally matching it

async function mockRoutes(page) {
  await page.route('**/rest/v1/*user_settings*', async (route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS_ROW) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    // The exact shape #1292's fix reacts to: a real 200 that rejected the field this run is about to change.
    const body = { ok: true, accepted: [], rejected: ['risk_pct'], settings: { ...SETTINGS_ROW, risk_pct: SERVER_WINS_VALUE } };
    console.log('[mock PATCH /api/settings] request body:', route.request().postData());
    console.log('[mock PATCH /api/settings] responding:', JSON.stringify(body));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function captureOne(browser, { theme, mobile, file }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  const { key, value } = fakeSession();
  await ctx.addInitScript(([k, v, t]) => {
    // Order matters: `document.documentElement` is not guaranteed to exist yet this early (addInitScript
    // runs before the document is parsed), and a throw there would abort the rest of this script silently -
    // costing an earlier run its whole theme write, reproduced and confirmed in isolation before this fix.
    // Both localStorage writes go first; the DOM attribute (a same-tick visual head start only - the
    // in-page bootstrap script and lib/theme.ts's own mount effect re-derive and re-apply it from
    // localStorage regardless) goes last, so a throw there can never take anything else down with it.
    localStorage.setItem(k, v);
    // lib/theme.ts's useTheme() effect re-derives the theme on mount from getStoredTheme() (an explicit
    // localStorage 'theme' choice, else system preference) and would overwrite a bare attribute set with
    // no matching localStorage row - persist it as the SAME explicit choice applyTheme() itself would make.
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, [key, value, theme]);
  const page = await ctx.newPage();
  await mockRoutes(page);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => consoleErrors.push(`[requestfailed] ${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`); });
  await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
  console.log('  immediately after goto:', await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('theme') })));
  await page.waitForSelector('.st-preset', { timeout: 15_000 });
  console.log('  after .st-preset appears:', await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('theme') })));
  // Decline the cookie banner (privacy-preserving default) - it also sits in the bottom corner and would
  // otherwise cover the toast/FAB in the screenshot.
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
  // Click a DIFFERENT risk preset than the current one (1%), to guarantee `update()` actually fires.
  await page.locator('.st-preset', { hasText: '2%' }).click();
  const toast = page.locator('.st-save-toast.conflict');
  await toast.waitFor({ state: 'visible', timeout: 5_000 });
  // Wait for the ACTUAL adopted-value reconciliation to land, not a fixed delay - the toast can render
  // before the risk_pct merge's own re-render paints (two separate setState calls in the same tick; under
  // load the browser can paint between them). A fixed sleep here proved flaky across a 4-context batch.
  await page.locator('.st-preset.on', { hasText: `${SERVER_WINS_VALUE}%` }).waitFor({ state: 'visible', timeout: 3_000 });
  await page.waitForTimeout(150); // let the settings-toast-open class + its CSS transition settle
  const fab = page.locator('.gchat-fab');
  const fabHidden = (await fab.count()) === 0 || (await fab.first().evaluate((el) => getComputedStyle(el).opacity === '0' || getComputedStyle(el).pointerEvents === 'none').catch(() => true));
  const text = await toast.textContent();
  const debugTheme = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('theme'), design: document.documentElement.getAttribute('data-design') }));
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log(`${file}: toast="${text}" fabHidden=${fabHidden} theme=${JSON.stringify(debugTheme)} consoleErrors=${consoleErrors.length}`);
  if (consoleErrors.length) console.log('  ' + consoleErrors.join('\n  '));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await captureOne(browser, { theme: 'dark', mobile: false, file: '1292-conflict-dark-desktop.png' });
  await captureOne(browser, { theme: 'light', mobile: false, file: '1292-conflict-light-desktop.png' });
  await captureOne(browser, { theme: 'dark', mobile: true, file: '1292-conflict-dark-mobile.png' });
  await captureOne(browser, { theme: 'light', mobile: true, file: '1292-conflict-light-mobile.png' });
} finally {
  await browser.close();
}
console.log('done');
