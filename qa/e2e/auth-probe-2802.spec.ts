/* QA probe (dispatch-only, qa / staging): why does a fixture's bearer call to /api/push/subscribe answer 401? Prints statuses only, never a token. The one write attempted is a DELETE of an endpoint that does not exist. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, FIXTURES, SUPABASE_URL, SUPABASE_ANON, signIn, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site');
test('AP fixture bearer calls: Auth itself, a locally verified route, an Auth-asking route, from the runner and from the page', async ({ browser, request }) => {
  test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(240_000);
  const token = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
  const H = { Authorization: `Bearer ${token}` };
  const who = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: { ...H, apikey: SUPABASE_ANON } });
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { iss: string; exp: number };
  console.log(`[AP] direct Auth /user: ${who.status()}; token issuer host ${new URL(claims.iss).host}; runner project host ${new URL(SUPABASE_URL).host}; seconds to expiry ${claims.exp - Math.floor(Date.now() / 1000)}`);
  const one = async (label: string, p: Promise<{ status: () => number; text: () => Promise<string>; headers: () => Record<string, string> }>) => { const r = await p; console.log(`[AP] ${label}: ${r.status()} ${(await r.text()).replace(/"(access|refresh)_token":"[^"]+"/g, '"$1":"…"').slice(0, 110)}`); };
  await one('runner GET /api/settings', request.get('/api/settings', { headers: H, timeout: 120_000 }));
  await one('runner GET /api/telegram/status', request.get('/api/telegram/status', { headers: H }));
  await one('runner DELETE /api/push/subscribe', request.delete('/api/push/subscribe', { headers: H, data: { endpoint: 'https://fcm.googleapis.com/fcm/send/qa-none' } }));
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await gotoSignedIn(page, '/settings'); await page.waitForTimeout(6_000);
    const r = await page.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)); const t = key ? (JSON.parse(localStorage.getItem(key) as string) as { access_token?: string }).access_token : undefined;
      const call = async (path: string, init: RequestInit = {}) => { const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` } }); return `${res.status} ${(await res.text()).slice(0, 90)}`; };
      return { hasToken: !!t, settings: await call('/api/settings'), pushDelete: await call('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/qa-none' }) }), pushPost: await call('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://example.invalid/x', keys: { p256dh: 'p', auth: 'a' } }) }) };
    });
    console.log(`[AP] from the signed-in page: ${JSON.stringify(r)}`);
  } finally { await ctx.close().catch(() => {}); }
  expect(true).toBe(true);
});
