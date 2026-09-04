import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/* AN ENTITLED SESSION, WITHOUT AUTHENTICATING AS ANYONE.
 *
 * QA cannot cover the Pro path. Creating accounts and typing passwords are hard
 * limits on that session, so "sign up and look" is not available to it — and
 * `GlobalMacroContext` / `PerpSpotCard` render an entitlement-gated branch that
 * nothing has ever verified. #717's spacing work sits inside that branch, on
 * `app/dashboard/page.tsx` — the current-design dashboard, which after #719 is
 * the screen every user sees. So the uncovered path is the high-traffic one.
 *
 * WHAT THIS IS NOT, AND WHY IT MATTERS
 *
 * It is NOT an entitlement flag in application code. The obvious version of
 * this — `NEXT_PUBLIC_TEST_ENTITLED=1` short-circuiting `entitled` in
 * AuthProvider — ships a paywall bypass in the production bundle, gated on a
 * variable anyone can set at build time. This codebase already has that
 * incident on record: #377, where a stuck `loading` state granted Pro access
 * for free, and the fix commentary at AuthProvider.tsx:89 exists because of
 * it. A DELIBERATE bypass is strictly worse than the accidental one, so it is
 * not on the table regardless of how convenient the fixture would be.
 *
 * It is also NOT a credential. The token seeded below is a syntactically
 * well-formed JWT with a deliberately invalid signature. It authenticates
 * nothing: every request that would carry it to Supabase is intercepted here
 * and answered locally, and any that escaped would be rejected by the server.
 * It is a local test double for a client library that reads its session from
 * localStorage, not a key to anything.
 *
 * IT WAS BROKEN, AND THE DIAGNOSIS IN THIS COMMENT WAS WRONG (#767, 2026-09-05)
 *
 * This section used to read "IT DOES NOT WORK OUTSIDE PLAYWRIGHT, AND THAT IS
 * NOT A BUG TO FIX", explaining that seeding the key by hand fails because
 * supabase-js refreshes with the invalid refresh token, the request reaches
 * Supabase, and the client discards the session. That explanation was wrong,
 * and it made a real defect look like a design property.
 *
 * Measured by patching localStorage.removeItem before any app code ran and
 * recording a stack for every touch of the session key:
 *
 *   3011ms  setItem     sb-<ref>-auth-token       written by this file
 *   4371ms  removeItem  sb-<ref>-auth-token       GoTrueClient._removeSession
 *   4371ms  removeItem  sb-<ref>-auth-token-user
 *   /auth/v1 traffic that escaped interception:   NONE
 *
 * The network was never involved. The session was rejected locally, on shape:
 * this file wrote `{ currentSession, expiresAt }` - the supabase-js v1 layout -
 * while v2's `GoTrueClient._isValidSession` requires `access_token`,
 * `refresh_token` and `expires_at` at the TOP level of the stored value
 * (auth-js 2.106.2, GoTrueClient.js:3788). A wrapped session has none of them
 * there, so `__loadSession` judged it invalid and deleted it.
 *
 * Storing the session object directly fixes it. Verified against the deployed
 * qa build: the key survives, and `.auth-avatar-btn` renders - a positive
 * signal rather than merely the absence of a "Sign in" link.
 *
 * THE PORTABILITY CLAIM WAS WRONG TOO. Seeding this key with NO page.route and
 * no interception at all now produces the same signed-in page. The interception
 * keeps the fixture's requests off the real project; it was never what made the
 * session survive.
 *
 * WHAT IS STILL NOT PROVEN: pro versus free. `as: 'pro'`, a control with
 * `as: 'free'`, and a bare localStorage seed all rendered the same zero locked
 * cards on /dashboard, so that probe did not discriminate. Signed-in is
 * measured; entitled is not. Do not read one as the other.
 *
 * HOW THE WRONG EXPLANATION SURVIVED. It was written after a failed attempt, it
 * was plausible, and it predicted the observed outcome - a signed-out page. It
 * was never tested, because it explained the failure well enough that nobody
 * looked further, and it named itself a design property so the next reader had
 * a reason not to. An explanation that tells you to stop looking should be held
 * to a higher standard than one that tells you where to look.
 *
 * HOW IT WORKS
 *
 * `AuthProvider` resolves the user from `sb.auth.getSession()`
 * (AuthProvider.tsx:65), which reads localStorage and makes no network call.
 * It then reads the role from one PostgREST select (AuthProvider.tsx:171).
 * So an entitled render needs exactly two things faked, both client-side:
 *
 *   1. a session in localStorage under supabase-js's key
 *   2. that one subscription row coming back as `role: 'pro'`
 *
 * Everything else — the paywall logic, the gate at each call site, the
 * components themselves — runs as shipped. That is the point: a fixture that
 * stubbed `entitled` directly would prove nothing about the code under test.
 */

/* Next.js loads .env.local for the APP, but Playwright's own process does not
   inherit it - the spec runs in plain Node. Rather than edit playwright.config.ts
   (QA's file) to pull in dotenv, this reads the one variable it needs. Falls
   back to the real process env first so CI, which sets it properly, is
   unaffected. */
function envSupabaseUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  for (const f of ['.env.e2e.local', '.env.local', '.env']) {
    try {
      const m = readFileSync(f, 'utf8').match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* file absent is normal - try the next one */ }
  }
  return undefined;
}

/** supabase-js keys its session `sb-<project-ref>-auth-token`, where the ref is
 *  the first hostname label of the project URL. Derived rather than hardcoded so
 *  this keeps working when the harness points at a different project. */
function storageKey(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

/** A structurally valid JWT whose signature is intentionally not valid.
 *  supabase-js decodes the payload locally to find `exp` and the user; it does
 *  not verify the signature client-side, and no request carrying this ever
 *  reaches a server (see the routes installed below). */
function unsignedJwt(userId: string, email: string, expSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: userId, email, role: 'authenticated', aud: 'authenticated',
    exp: expSeconds, iat: Math.floor(Date.now() / 1000),
  });
  return `${header}.${payload}.test-signature-not-valid`;
}

export interface EntitledOptions {
  /** 'pro' is a paid subscriber; 'trial' exercises the OTHER branch of
   *  `entitled = isPro || isTrial`, which is the one a real new signup gets.
   *
   *  'free' is SIGNED IN BUT NOT ENTITLED, and it is not a contradiction of
   *  this file's name - it is the state `/upgrade` needs. That page redirects
   *  Pro users straight to /arena (app/upgrade/page.tsx:84), so a 'pro'
   *  session cannot see the checkout button at all, and a signed-OUT session
   *  renders no CTA either. Only a signed-in non-subscriber is shown the
   *  thing being sold. Found by running it: my first #243 check used 'pro',
   *  got redirected, and reported a config disagreement that was really my
   *  own wrong session state. */
  as?: 'pro' | 'trial' | 'free' | 'expired';
  supabaseUrl?: string;
}

/**
 * Make the page render as an entitled user.
 *
 * MUST be called before the first navigation — it installs an init script and
 * network routes, neither of which applies retroactively to a loaded page.
 *
 * ```ts
 * test('macro card renders its full breakdown', async ({ page }) => {
 *   await useEntitledSession(page);
 *   await page.goto('/dashboard');
 *   await expect(page.getByTestId('locked-feature')).toHaveCount(0);
 * });
 * ```
 */
export async function useEntitledSession(page: Page, opts: EntitledOptions = {}): Promise<void> {
  const as = opts.as ?? 'pro';
  const supabaseUrl = opts.supabaseUrl ?? envSupabaseUrl();
  if (!supabaseUrl) {
    /* Loud, not skipped. A fixture that silently no-ops leaves the test
       asserting against a SIGNED-OUT page — which renders the locked card, so
       an entitled-path assertion fails with a message about the wrong thing.
       Every "false clean" in this project's history started as a check that
       quietly measured nothing. */
    throw new Error(
      'useEntitledSession: NEXT_PUBLIC_SUPABASE_URL is unset, so the session key ' +
      'cannot be derived. Set it in the harness env, or pass { supabaseUrl }.',
    );
  }

  const userId = '00000000-0000-4000-8000-000000000001';
  const email = 'qa-entitled@example.invalid'; // .invalid is reserved (RFC 2606)
  const nowSec = Math.floor(Date.now() / 1000);
  /* 'expired' puts the expiry an hour in the PAST. Everything else about the
     session is identical - this is the state a returning user's browser is in
     between visits, which is the normal case rather than an edge one, since
     tokens expire by design. #727. */
  const expired = as === 'expired';
  const expSec = expired ? nowSec - 3600 : nowSec + 3600;
  const accessToken = unsignedJwt(userId, email, expSec);

  const user = {
    id: userId, aud: 'authenticated', role: 'authenticated', email,
    app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: new Date(0).toISOString(),
  };

  const session = {
    access_token: accessToken,
    refresh_token: 'test-refresh-token-not-valid',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expSec,
    user,
  };

  const key = storageKey(supabaseUrl);

  await page.addInitScript(
    ({ key, session }) => {
      /* THE SESSION OBJECT DIRECTLY, NOT WRAPPED. This wrote
         `{ currentSession, expiresAt }` until 2026-09-05 - the supabase-js v1
         shape. v2's GoTrueClient._isValidSession requires `access_token`,
         `refresh_token` and `expires_at` at the TOP level of the stored value
         (auth-js 2.106.2, GoTrueClient.js:3788); a wrapped session has none of
         them there, so __loadSession judged it invalid and called
         _removeSession(), deleting the key 1.4s after this wrote it. */
      window.localStorage.setItem(key, JSON.stringify(session));
      /* AuthProvider force-signs-out a session idle more than 7 days
         (AuthProvider.tsx:49, #304). Without this the fixture would be
         torn down by the app's own expiry check and the test would see a
         signed-out page. */
      window.localStorage.setItem('lhq_last_active', String(Date.now()));
    },
    { key, session },
  );

  /* The one row that decides `entitled`. A trial is the NON-pro branch:
     role stays 'free' and the window carries it, exactly as the signup
     trigger writes it (supabase/migrations/20260804g_trial_email_dedup.sql). */
  const row = as === 'pro'
    ? { role: 'pro', trial_ends_at: null }
    : as === 'trial'
      ? { role: 'free', trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString() }
      /* 'free': a PAST trial end, not null. Both read as not-entitled, but an
         expired window also exercises the `trialEndsAt > clock` comparison
         rather than short-circuiting on null - closer to a real lapsed user. */
      : { role: 'free', trial_ends_at: new Date(Date.now() - 864e5).toISOString() };

  await page.route(`${supabaseUrl}/rest/v1/**`, async route => {
    const url = route.request().url();
    if (!/user_subscriptions/.test(url)) return route.fallback();
    /* `.maybeSingle()` asks PostgREST for a single object via the Accept
       header rather than an array. Answering with the wrong shape makes
       supabase-js return null data and the app reads that as 'free' - a
       fixture that fails by looking like a correct not-entitled result. */
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(single ? row : [row]),
    });
  });

  /* supabase-js calls these when it refreshes or re-validates. Unhandled they
     would hit the real project with an invalid token, and its 401 would sign
     the fixture out mid-test. */
  /* DELIBERATELY NOT INTERCEPTED FOR 'expired'. The whole point of that state
     is what supabase-js does when it tries to refresh a dead token and the
     refresh does not come back - fulfilling /auth/v1/token here with a valid
     session would paper over exactly the condition under test and the fixture
     would prove the opposite of what it claims. Left to reach the real
     endpoint, which rejects the bogus refresh token. */
  if (expired) return;

  await page.route(`${supabaseUrl}/auth/v1/**`, async route => {
    const url = route.request().url();
    if (/\/user\b/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    if (/token/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
    }
    return route.fallback();
  });
}
