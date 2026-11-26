/* QA #101: sign-in and sign-up on the Safari engine (WebKit), and where the /login script error comes from.
 *   FLOW (runner build only): the form is submitted ONLY when the widget issued Cloudflare's published dummy token, i.e. the build carries Cloudflare's always-passing TEST sitekey. No real bot check is ever answered.
 *        Sign-in uses the project's own Pro fixture. Sign-up is stopped at the network: the account request is answered by the test, so NO account is created; what it proves is that the browser sends it with the token.
 *   LOOK (deployed site): the widget and the page errors only. Nothing is filled in or submitted.
 * No address, password or token is printed. Prints [S101] lines. */
import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';
import { AUTH_READY, FIXTURES } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DEPLOYED = !!process.env.E2E_BASE_URL;
const DUMMY = 'XXXX.DUMMY.TOKEN.XXXX';
test.describe.configure({ timeout: 240_000, retries: 0 });
const PROFILES = [['iphone', 'iPhone 13'], ['desktop', 'Desktop Safari']] as const;

async function throughGate(ctx: BrowserContext) {
  const password = process.env.SITE_GATE_PASSWORD; if (!password || !DEPLOYED) return;
  const origin = new URL(process.env.E2E_BASE_URL as string).origin; const basic = `Basic ${Buffer.from(`team:${password}`).toString('base64')}`;
  await ctx.route((u) => u.origin === origin, async (route) => { const h = await route.request().allHeaders(); if (!h.authorization) h.authorization = basic; await route.continue({ headers: h }); });
}
async function login(playwright: typeof import('@playwright/test'), engine: 'webkit' | 'chromium', device: string) {
  const browser = await (playwright as unknown as Record<string, import('@playwright/test').BrowserType>)[engine].launch();
  const { defaultBrowserType: _ignored, ...d } = devices[device];
  const ctx = await browser.newContext({ ...d, baseURL: process.env.E2E_BASE_URL || 'http://localhost:3100', serviceWorkers: 'block' /* on WebKit the app's worker carried the sign-up POST past the stub (run 45811907745): one real unconfirmed account was made on dev */ });
  await throughGate(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${String(e.message).slice(0, 220)} @ ${(e.stack ?? '').split('\n').slice(0, 3).join(' < ').replace(/\?[^ )]*/g, '').slice(0, 260)}`));
  await installPaidAiFence(page);
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 150_000 });
  return { browser, page, errors };
}
const token = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="cf-turnstile-response"]')).map((i) => i.value).find((v) => v) ?? '');
const waitToken = async (page: Page) => { for (let i = 0; i < 40; i++) { const t = await token(page); if (t) return t; await page.waitForTimeout(1_000); } return ''; };

for (const engine of ['webkit', 'chromium'] as const) for (const [profile, device] of PROFILES) {
  test(`LOOK ${engine} ${profile}`, async ({ playwright }) => {
    test.skip(!DEPLOYED, 'deployed site only');
    const { browser, page, errors } = await login(playwright as never, engine, device);
    try {
      await page.waitForTimeout(8_000); const t = await waitToken(page);
      const frames = page.frames().map((f) => f.url()).filter((u) => /challenges\.cloudflare\.com/.test(u));
      const key = frames.map((u) => /\/(0x[A-Za-z0-9_-]{10,}|[123]x0{10,}[A-Z]{2})\//.exec(u)?.[1]).find(Boolean) ?? '';
      console.log(`[S101] look ${engine} ${profile}: widgetFrames=${frames.length} sitekey=${!key ? 'not seen' : /^[123]x0{10,}/.test(key) ? 'Cloudflare test key' : 'real key'} tokenIssued=${!!t} dummyToken=${t === DUMMY} errors=${errors.length ? JSON.stringify(errors.slice(0, 2)) : 'none'}`);
    } finally { await browser.close().catch(() => {}); }
  });

  test(`FLOW sign-in ${engine} ${profile}`, async ({ playwright }) => {
    test.skip(DEPLOYED, 'runner build only'); test.skip(!AUTH_READY, 'no fixtures');
    const { browser, page, errors } = await login(playwright as never, engine, device);
    try {
      await page.getByRole('button', { name: /password/i }).first().click({ timeout: 60_000 });
      const t = await waitToken(page);
      console.log(`[S101] sign-in ${engine} ${profile}: token issued=${!!t} dummy=${t === DUMMY}`);
      expect(t, 'not the test widget: the form is not submitted').toBe(DUMMY);
      await page.getByTestId('login-email').first().fill(FIXTURES.aEmail);
      await page.locator('input[type="password"]').first().fill(FIXTURES.aPassword);
      const button = page.getByRole('button', { name: /^sign in$/i }).last(); await expect(button).toBeEnabled({ timeout: 30_000 });
      const answer = page.waitForResponse((r) => /\/auth\/v1\/token\?grant_type=password/.test(r.url()), { timeout: 60_000 });
      await button.click(); const r = await answer;
      const sent = (r.request().postDataJSON() as { gotrue_meta_security?: { captcha_token?: string } }).gotrue_meta_security?.captcha_token;
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
      const session = await page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));
      console.log(`[S101] sign-in ${engine} ${profile}: HTTP ${r.status()} captchaSent=${sent === DUMMY} landed=${new URL(page.url()).pathname} sessionStored=${session} errors=${errors.length ? JSON.stringify(errors.slice(0, 2)) : 'none'}`);
      expect(r.status()).toBe(200); expect(session).toBe(true);
    } finally { await browser.close().catch(() => {}); }
  });

  test(`FLOW sign-up ${engine} ${profile}`, async ({ playwright }) => {
    test.skip(DEPLOYED, 'runner build only');
    const { browser, page, errors } = await login(playwright as never, engine, device);
    try {
      let body: Record<string, unknown> | null = null;
      await page.context().route(/\/auth\/v1\/signup/, async (route) => {
        if (route.request().method() !== 'POST') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } }); return; }
        body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000101', aud: 'authenticated', role: '', email: 'qa-101@example.test', identities: [{ id: 'qa' }], created_at: new Date().toISOString() }) });
      });
      await page.getByRole('button', { name: /password/i }).first().click({ timeout: 60_000 });
      await page.getByRole('button', { name: /^(sign up|create account)$/i }).first().click();
      const t = await waitToken(page); expect(t, 'not the test widget: the form is not submitted').toBe(DUMMY);
      await page.getByTestId('login-email').first().fill('qa-101@example.test');
      const made = `Qa-${Math.random().toString(36).slice(2, 10)}-Z9x!`;
      for (const field of await page.locator('input[type="password"]').all()) await field.fill(made);
      const button = page.getByRole('button', { name: /create account/i }).last(); await expect(button).toBeEnabled({ timeout: 30_000 });
      await button.click(); await page.waitForTimeout(6_000);
      const sent = (body as { gotrue_meta_security?: { captcha_token?: string } } | null)?.gotrue_meta_security?.captcha_token;
      const after = (await page.locator('main, .login-card').first().innerText()).replace(/\s+/g, ' ').replace(/qa-101@example\.test/g, '<address>').slice(0, 200);
      console.log(`[S101] sign-up ${engine} ${profile}: requestSent=${!!body} captchaSent=${sent === DUMMY} screenAfter=${JSON.stringify(after)} errors=${errors.length ? JSON.stringify(errors.slice(0, 2)) : 'none'}`);
      expect(sent).toBe(DUMMY); expect(after).toMatch(/inbox|check your email|confirm/i);
    } finally { await browser.close().catch(() => {}); }
  });
}
