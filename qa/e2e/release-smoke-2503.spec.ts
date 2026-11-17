/* #2503 SMOKE (tightened CSP, symbol allowlist, server-only reads) on a DEPLOYED staging: does anything the app loads from a third party get blocked?
 *   CS0  the response CSP header: printed, and it must name the hosts the app uses (PostHog, Cloudflare Turnstile, Whop)
 *   CS1  pages / /arena /login /upgrade /briefing /dashboard /markets with analytics consent granted: ZERO securitypolicyviolation events and no "Content Security Policy" console error
 *   PH1  PostHog: with consent granted, a capture request to the PostHog host answers 2xx (the event lands)
 *   TS1  /login: the Turnstile widget (iframe from challenges.cloudflare.com) renders and is not blocked
 *   WH1  Free fixture on /upgrade: choosing a plan opens the embedded Whop checkout (a frame or request to whop.com) with no CSP violation; NOTHING is bought (no card is entered)
 *   CH1  Pro fixture: the floating Ask AI opens the chat panel (nothing is sent: the paid AI route is fenced)
 * Notes printed, not asserted: whether a tracker (GlitchTip/Sentry) host is in the CSP. A test error is NOT sent (staging runs with APP_ENV=dev, where the tracker is suppressed by design). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const WATCH = () => { const w = window as unknown as { __csp: string[] }; w.__csp = []; document.addEventListener('securitypolicyviolation', (e) => { w.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI.slice(0, 90)}`); }); };
const consent = (page: Page) => page.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'granted'); localStorage.setItem('lhq_lang_v1', 'en'); } catch { /* private */ } });
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);

test('CS0. the CSP header names the third parties the app uses', async ({ request }) => {
  const r = await request.get('/'); const csp = r.headers()['content-security-policy'] ?? ''; console.log(`[SMOKE] CSP: ${csp}`);
  expect(csp.length, 'no CSP header').toBeGreaterThan(50);
  for (const h of ['posthog', 'challenges.cloudflare.com', 'whop']) expect(csp.toLowerCase().includes(h), `the CSP does not name ${h}`).toBe(true);
  console.log(`[SMOKE] tracker host in CSP: ${/sentry|glitchtip|ingest/i.test(csp)}`);
});

for (const path of ['/', '/arena?coin=btc', '/login', '/upgrade', '/briefing', '/dashboard', '/markets']) {
  test(`CS1. no CSP violation on ${path}`, async ({ page }) => {
    test.setTimeout(120_000); const consoleCsp: string[] = []; page.on('console', (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200)); });
    await page.addInitScript(WATCH); await consent(page); await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(15_000);
    const v = await violations(page); console.log(`[SMOKE] CS1 ${path}: violations ${JSON.stringify(v)} console ${JSON.stringify(consoleCsp)}`);
    expect([...v, ...consoleCsp], `CSP blocked something on ${path}`).toEqual([]);
  });
}

test('PH1. the PostHog event lands', async ({ page }) => {
  test.setTimeout(90_000); const hits: Array<{ url: string; status: number }> = [];
  page.on('response', (r) => { if (/posthog/i.test(r.url()) && r.request().method() === 'POST') hits.push({ url: r.url().split('?')[0], status: r.status() }); });
  await consent(page); await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(20_000);
  console.log(`[SMOKE] PH1 posthog POSTs: ${JSON.stringify(hits.slice(0, 6))}`);
  expect(hits.length, 'no PostHog capture request was made').toBeGreaterThan(0); expect(hits.some((h) => h.status >= 200 && h.status < 300), `PostHog answered ${JSON.stringify(hits.map((h) => h.status))}`).toBe(true);
});

test('TS1. /login renders the Turnstile widget unblocked', async ({ page }) => {
  test.setTimeout(90_000); await page.addInitScript(WATCH); await consent(page); await page.goto('/login', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(15_000);
  const frames = page.frames().map((f) => f.url()).filter((u) => /challenges\.cloudflare\.com/.test(u)); const widget = await page.locator('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [data-testid*="turnstile"]').count();
  console.log(`[SMOKE] TS1 turnstile frames ${frames.length}, widget elements ${widget}, violations ${JSON.stringify(await violations(page))}`);
  expect(await violations(page), 'a CSP violation on /login').toEqual([]); expect(frames.length + widget, 'the Turnstile widget did not render').toBeGreaterThan(0);
});

test.describe('signed in', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test('WH1. choosing a plan opens the embedded Whop checkout, nothing is bought', async ({ browser }) => {
    test.setTimeout(150_000); const ctx = await signedInContext(browser, 'b'); await ctx.addInitScript(WATCH); const page = await ctx.newPage(); await installPaidAiFence(page);
    const whopReq: string[] = []; page.on('request', (r) => { if (/whop\.com/.test(r.url())) whopReq.push(r.url().split('?')[0].slice(0, 100)); });
    try {
      await consent(page); await gotoSignedIn(page, '/upgrade'); await page.waitForTimeout(8_000);
      const reveal = page.locator('[data-testid="upgrade-reveal-plans"]').first(); console.log(`[SMOKE] WH1 reveal button present: ${(await reveal.count()) > 0}`);
      await reveal.click({ timeout: 20_000 }).catch(() => undefined); await page.waitForTimeout(2_000);
      await page.locator('[data-testid="checkout-cta-monthly"]').first().click({ timeout: 20_000 }).catch(() => undefined); await page.waitForTimeout(3_000);
      const panel = await page.locator('[data-testid="checkout-method-panel"]').count(); console.log(`[SMOKE] WH1 method panel shown: ${panel > 0}`);
      await page.locator('[data-testid="checkout-method-whop"]').first().click({ timeout: 10_000 }).catch(() => undefined); await page.waitForTimeout(12_000);
      const embed = await page.locator('[data-testid="whop-checkout-embed"]').count(); const frames = page.frames().map((f) => f.url()).filter((u) => /whop\.com/.test(u)); const v = await violations(page);
      console.log(`[SMOKE] WH1 embed element ${embed}, whop frames ${JSON.stringify(frames.map((u) => u.slice(0, 80)))} whop requests ${JSON.stringify(whopReq.slice(0, 5))} violations ${JSON.stringify(v)}`);
      expect(v, 'a CSP violation while opening the checkout').toEqual([]); expect(embed + frames.length + whopReq.length, 'no Whop checkout element, frame or request appeared').toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  test('CH1. Ask AI opens the chat panel', async ({ browser }) => {
    test.setTimeout(120_000); const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(WATCH); const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await consent(page); await page.setViewportSize({ width: 1280, height: 900 }); await gotoSignedIn(page, '/dashboard'); await page.waitForTimeout(10_000);
      await page.locator('.gchat-fab').first().click({ timeout: 15_000 }); await page.waitForTimeout(2_000);
      const panel = await page.locator('[role="dialog"], .gchat-panel, [class*="gchat"][class*="panel"]').count();
      console.log(`[SMOKE] CH1 chat panel nodes ${panel}, violations ${JSON.stringify(await violations(page))}`);
      expect(await violations(page), 'a CSP violation opening the chat').toEqual([]); expect(panel, 'the chat panel did not open').toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });
});
