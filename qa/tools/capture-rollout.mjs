/* #1113 option-4 rollout screenshot capture: the 8 new PageHint pages, first-visit state, plus a closer look
 * at calc/econ-calendar where the old subtitle was dropped (checking the hint doesn't crowd the h1).
 *
 * NO REAL CREDENTIALS - same fake-unexpired-session technique as capture-1292.mjs/capture-1346.mjs. No API
 * mocking beyond the auth-refresh abort: these pages' own data reads are allowed to fail with a real 401
 * against Supabase (same as any signed-in-but-token-invalid state) - PageHint renders unconditionally at the
 * top of each page, before any of that data, so it does not need those reads to succeed to be seen.
 *
 * Usage: node capture-rollout.mjs <baseURL> <outDir>
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

const PAGES = [
  { path: '/news', file: '1113-rollout-news.png' },
  { path: '/alerts', file: '1113-rollout-alerts.png' },
  { path: '/settings', file: '1113-rollout-settings.png' },
  { path: '/dashboard', file: '1113-rollout-dashboard.png' },
  { path: '/calc', file: '1113-rollout-calc.png' },
  { path: '/econ-calendar', file: '1113-rollout-econ-calendar.png' },
  { path: '/hours', file: '1113-rollout-hours.png' },
  { path: '/playbook', file: '1113-rollout-playbook.png' },
];

async function captureOne(browser, { path, file, theme = 'dark' }) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const { key, value } = fakeSession();
  await ctx.addInitScript(([k, v, t]) => {
    // Found capturing #1292: `document.documentElement` is not guaranteed to exist this early, and a
    // page-level "Cannot read properties of null (reading 'setAttribute')" showed up here even as the LAST
    // statement (harmless to the two writes before it, but noisy). The page's own blocking bootstrap script
    // (app/layout.tsx) reads localStorage('theme') and applies data-theme itself before first paint - no
    // need to race it from here, so only the two localStorage writes remain.
    localStorage.setItem(k, v);
    localStorage.setItem('theme', t);
  }, [key, value, theme]);
  const page = await ctx.newPage();
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
  let hadHardFailure = false;
  page.on('pageerror', (e) => { hadHardFailure = true; console.log(`  [pageerror] ${e.message}`); });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 }).catch(() => { hadHardFailure = true; });
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
  await page.waitForTimeout(600); // let the PageHint's mount-effect settle out of 'pending'
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log(`${file}: pageerror=${hadHardFailure}`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const p of PAGES) await captureOne(browser, p);
} finally {
  await browser.close();
}
console.log('done');
