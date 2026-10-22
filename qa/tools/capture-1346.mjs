/* #1346 (7dfb8148) screenshot capture: HypothesisTracker's evidence panel, loading/error/confirmed-empty.
 *
 * NO REAL CREDENTIALS - same technique as capture-1292.mjs (which this file's structure follows, lessons
 * from that run applied: init-script statement ORDER matters, since a throw partway through silently skips
 * whatever comes after it - the two localStorage writes go first, the DOM attribute last). A fabricated,
 * unexpired session is written to localStorage before any page script runs; the hypotheses list and the
 * evidence read are both intercepted with `page.route()` and answered with synthetic, hand-written
 * responses - nothing is sent to, or answered by, Supabase or this app's real backend for a real account.
 *
 * Usage: node capture-1346.mjs <baseURL> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3101';
const OUT = process.argv[3] ?? '.';
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set in this process\'s env');
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const FAKE_UID = '00000000-0000-4000-8000-00000000fa4e';
const HYP_ID = '00000000-0000-4000-8000-0000000000h1';

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

const HYPOTHESIS = {
  id: HYP_ID, title: 'BTC funding stays negative through the next FOMC',
  hypothesis: 'If funding stays negative for 48h before FOMC, price drifts up into the event.',
  acceptance_criteria: ['Funding < 0 for 48h pre-event', 'Price +2% into the event window'],
  status: 'active', grok_verdict: null, grok_reasoning: null, grok_evidence_assessment: null,
  grok_confidence: null, grok_next_check: null, grok_last_run: null, target_date: null,
  created_at: new Date().toISOString(),
};

async function mockRoutes(page, evidenceMode) {
  await page.route('**/api/hypotheses', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hypotheses: [HYPOTHESIS] }) });
  });
  await page.route(`**/api/hypotheses/${HYP_ID}/evidence`, async (route) => {
    if (evidenceMode === 'loading') return new Promise(() => {}); // held forever - the panel is captured mid-fetch
    if (evidenceMode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stand-in: read failed' }) });
    // 'empty': a genuinely empty, successful read
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ evidence: [] }) });
  });
  await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
}

async function captureOne(browser, { evidenceMode, theme, file }) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const { key, value } = fakeSession();
  await ctx.addInitScript(([k, v, t]) => {
    // Order matters (found capturing #1292): a throw partway through an addInitScript callback silently
    // skips everything after it, and `document.documentElement` is not guaranteed to exist this early.
    // Both localStorage writes go first; the DOM attribute (a same-tick head start only) goes last.
    localStorage.setItem(k, v);
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, [key, value, theme]);
  const page = await ctx.newPage();
  await mockRoutes(page, evidenceMode);
  const consoleErrors = [];
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/hypotheses')) consoleErrors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`); });
  await page.goto(`${BASE}/research`, { waitUntil: 'load' });
  const card = page.getByText(HYPOTHESIS.title, { exact: false }).first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  // Decline the cookie banner (privacy-preserving default), same pattern as capture-1292.mjs, checked only
  // once the page has settled - a bare isVisible() right after goto found it too early, before it mounts.
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
  await card.click(); // expand -> fires fetchEvidence
  if (evidenceMode === 'loading') {
    // The panel must show the spinner WHILE the fetch never resolves - give React a tick to settle into it.
    await page.waitForTimeout(400);
  } else if (evidenceMode === 'error') {
    await page.getByText(/Couldn.t load evidence/i).waitFor({ state: 'visible', timeout: 5_000 });
  } else {
    await page.getByText(/No evidence logged yet/i).waitFor({ state: 'visible', timeout: 5_000 });
  }
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  console.log(`${file}: consoleErrors=${consoleErrors.length}${consoleErrors.length ? '\n  ' + consoleErrors.join('\n  ') : ''}`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await captureOne(browser, { evidenceMode: 'loading', theme: 'dark', file: '1346-evidence-loading.png' });
  await captureOne(browser, { evidenceMode: 'error', theme: 'dark', file: '1346-evidence-error.png' });
  await captureOne(browser, { evidenceMode: 'empty', theme: 'dark', file: '1346-evidence-empty.png' });
} finally {
  await browser.close();
}
console.log('done');
