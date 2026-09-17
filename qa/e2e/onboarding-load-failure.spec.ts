import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';
import { startFailOnceServer } from './_shared';

/* #1309 item 13 / PR #1315's own "How to test (QA)" scenario, made automatic,
 * plus the third case PM/DevOps asked for on top of the PR's own two.
 *
 * THE BUG: `data` came back falsy from the `user_onboarding` read both on a
 * real DB error AND on "no row yet, genuinely new user" - components/
 * OnboardingProvider.tsx treated both as the same fact, and OnboardingGate's
 * `!loaded || !state.profileComplete` check can't tell a stale default
 * `false` from a real answer. A transient DB error dropped an already-
 * finished, signed-in user into the 5-step wizard, blocking every route,
 * until a later read happened to succeed.
 *
 * THE FIX: the provider now tracks `loadError` separately from "no row" -
 * only an errorless empty result creates a row - and the gate checks
 * `!loadError` before its existing condition.
 *
 * WHY THE SERVER-SIDE INJECTOR, NOT page.route. Same reasoning as
 * qa/e2e/alert-prefs-load-failure.spec.ts: faking the browser-level response
 * would only prove the client distinguishes an error object from data, not
 * that a REAL Supabase failure produces one. qa/fail-once.cjs forces the
 * page's own real `sb.from(...).maybeSingle()` call to fail once.
 */

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ONBOARDING_TABLE = 'lhq_dev_user_onboarding'; // this spec is dev-only, see the E2E_BASE_URL skip below

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function signIn(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json();
  expect(session?.access_token, `sign-in failed for ${email}: HTTP ${res.status}`).toBeTruthy();
  return session as { access_token: string; refresh_token: string; expires_in: number; user: unknown };
}

async function seedAuth(page: Page, session: Awaited<ReturnType<typeof signIn>>) {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
    `sb-${ref}-auth-token`,
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
      token_type: 'bearer',
      user: session.user,
    }),
  ] as [string, string]);
}

/** Any element the onboarding wizard's own step form renders - `.obw-` is
 *  OnboardingFlow.tsx's own class prefix, not shared with any other screen. */
const wizardLocator = (page: Page) => page.locator('[class*="obw-"]').first();

test.describe('#1309 item 13: onboarding read failure must not send a finished user back to the wizard', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.skip(!!process.env.E2E_BASE_URL,
    'this spec spawns its own local server with a Node --require hook - it cannot run against a ' +
    'deployed service, the same limitation qa/server-intercept.mjs documents in playwright.config.ts');

  test('a forced user_onboarding read failure shows no wizard for an onboarded account; the next load recovers unchanged', async ({ browser }) => {
    const session = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const server = await startFailOnceServer({ match: 'user_onboarding', status: 504 });
    const ctx = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    try {
      await seedAuth(page, session);

      // ── First load: fail-once's ONE forced failure lands on this read ──
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      const wizard = wizardLocator(page);
      // A finished account must reach the dashboard even while the read is
      // unknown - this is the fix. Generous timeout: a cold `next start`
      // with no warm caches measured slower than a short fixed wait would
      // assume when this spec was first written.
      await expect(wizard,
        'the onboarding wizard rendered for an ALREADY-FINISHED account on a FAILED read - this is ' +
        'exactly #1309 item 13: unknown was treated as incomplete').toBeHidden({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: /dashboard/i }).or(page.locator('body')),
        'dashboard content never rendered either - this run may have measured a dead page, not a ' +
        'real pass').toBeVisible();

      // ── Second load, same process: fail-once already fired once, so this ──
      // is the PR's own step 4 - "a normal load is unaffected" - for real.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(wizard,
        'the wizard is showing on a normal, unforced load for an already-finished account - either ' +
        'the failure state leaked into a real load or this load failed too').toBeHidden({ timeout: 20_000 });
    } finally {
      await ctx.close();
      await server.stop();
    }
  });

  test('a genuinely new account (no onboarding row, no error) still gets the wizard', async ({ browser, baseURL }) => {
    test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY absent - cannot safely clear and restore ' +
      "account B's onboarding row for this case");

    const session = await signIn(FIXTURES.bEmail, FIXTURES.bPassword);
    const userId = FIXTURES.bId;

    // B is the shared BOLA fixture, not a disposable account - read its
    // current row before touching anything, so it can be put back exactly.
    // Using B rather than creating a throwaway auth.users row: this only
    // needs a MISSING onboarding row, and a real signup requires an email
    // confirmation step this session cannot complete. B already has full
    // credentials configured (required by AUTH_READY), unlike account C.
    const before = await db(`${ONBOARDING_TABLE}?user_id=eq.${userId}&select=*`);
    const beforeRows = await before.json() as Record<string, unknown>[];
    expect(beforeRows.length, "account B's onboarding row was not found before this test touched " +
      'anything - refusing to proceed rather than risk restoring the wrong state').toBe(1);
    const original = beforeRows[0];

    const ctx = await browser.newContext({ baseURL: baseURL ?? 'http://localhost:3100', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    try {
      const del = await db(`${ONBOARDING_TABLE}?user_id=eq.${userId}`, { method: 'DELETE' });
      expect(del.ok, `failed to clear account B's onboarding row: HTTP ${del.status}`).toBeTruthy();

      await seedAuth(page, session);
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

      await expect(wizardLocator(page),
        'the wizard did NOT render for a genuinely new account (no row, no error, real success) - ' +
        'this path is unchanged by #1315 and must still work exactly as before').toBeVisible({ timeout: 20_000 });
    } finally {
      // Best-effort restore, unconditionally - a DELETE without a matching
      // RESTORE leaves the shared fixture account B silently in a state
      // other specs (and future runs of this one) don't expect.
      const restore = await db(`${ONBOARDING_TABLE}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(original),
      }).catch(() => null);
      if (!restore?.ok) {
        // eslint-disable-next-line no-console
        console.error(
          `[onboarding-load-failure] FAILED TO RESTORE account B's onboarding row - manual fix needed: ` +
          `${JSON.stringify(original)}`,
        );
      }
      await ctx.close();
    }
  });
});
