import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON, signIn } from './_auth';

/* The Pro boundary — 15 routes, HTTP level.
 *
 * WHY THIS EXISTS. `lib/limits.ts` records that until 2026-08-07 only 6 of the
 * 11 ExtraTool routes actually called `hasProFeatures()`, so a free account
 * could run the other 5. Every one of them is sold on /upgrade. That was found
 * by a person reading a file, closed in code, and nothing has held it closed
 * since — there is no test anywhere that a free account is refused.
 *
 * This is the revenue boundary. It is also the cheapest thing on
 * `qa/TEST_GAPS.md` to test: pure HTTP, no market data, no UI, no LemonSqueezy,
 * so it is immune to §1 and can gate a release.
 *
 * WHY IT DERIVES THE EXPECTATION INSTEAD OF ASSUMING IT. A new account gets a
 * 14-day trial, and `getEntitlement()` grants Pro FEATURES for its duration
 * (`proFeatures = role === 'pro' || trialActive`). So a seeded fixture inside
 * its trial window legitimately passes every gate below. Hardcoding "expect
 * 403" would make this spec fail for a correct product, and hardcoding "expect
 * 200" would make it pass for a broken one.
 *
 * So it reads the account's own subscription row first (RLS-scoped — a token
 * can only see its own) and asserts whichever direction that row implies. The
 * test knows which case it is in and says so.
 */

const P = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';

/** The gated surface. Method matters: a GET against a POST-only handler returns
 *  405 and would look like a failure that has nothing to do with entitlement.
 *
 *  `price-alerts` appears twice on purpose — its GET is deliberately NOT gated
 *  (a free user may read alerts, not create them), so only POST and PATCH are
 *  listed. Asserting 403 on the GET would be asserting a bug. */
const GATED: Array<{ method: 'GET' | 'POST' | 'PATCH'; path: string }> = [
  { method: 'POST',  path: '/api/alerts/preview' },
  { method: 'POST',  path: '/api/behavioral-bias' },
  { method: 'GET',   path: '/api/dry-powder' },
  { method: 'GET',   path: '/api/macro-context' },
  { method: 'GET',   path: '/api/onchain' },
  { method: 'POST',  path: '/api/pine-script' },
  { method: 'POST',  path: '/api/price-alerts' },
  { method: 'PATCH', path: '/api/price-alerts' },
  { method: 'POST',  path: '/api/push/test' },
  { method: 'POST',  path: '/api/shadow-account' },
  { method: 'POST',  path: '/api/smc-snapshot' },
  { method: 'POST',  path: '/api/strategy-research' },
  { method: 'GET',   path: '/api/telegram/test' },
  { method: 'POST',  path: '/api/thesis-check' },
  { method: 'POST',  path: '/api/token-unlock' },
];

test.describe('Pro entitlement boundary', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  // HTTP level — running both viewport projects would just double the requests.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  let token = '';
  let expectPro = false;
  let why = '';

  test.beforeAll(async () => {
    token = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);

    // The account's own row. RLS restricts this to the caller's user_id, which
    // is the same read `getEntitlement()` performs server-side.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${P}user_subscriptions?user_id=eq.${FIXTURES.aId}&select=role,trial_ends_at`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(
        `could not read ${P}user_subscriptions for the fixture (HTTP ${res.status}). ` +
        'Refusing to continue: without the row this spec cannot know which direction ' +
        'to assert, and would be guessing.',
      );
    }
    const rows = (await res.json()) as Array<{ role?: string; trial_ends_at?: string }>;
    const row = rows[0];
    const role = row?.role === 'pro' ? 'pro' : 'free';
    const trialEnds = row?.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
    const trialActive = role !== 'pro' && trialEnds > Date.now();

    expectPro = role === 'pro' || trialActive;
    why = `role=${role} trialActive=${trialActive} (trial_ends_at=${row?.trial_ends_at ?? 'null'})`;
    console.log(`[entitlements] fixture A: ${why} -> expect Pro access: ${expectPro}`);
  });

  /* Guard against a vacuous pass. If the token were rejected, every route below
   * would return 401 and a naive "not 200" assertion would read as a clean run.
   * The ungated GET proves the token authenticates before anything else is
   * concluded from a status code. */
  test('the fixture token actually authenticates (guards against a vacuous pass)', async ({ request }) => {
    const r = await request.get('/api/price-alerts', {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    });
    expect(r.status(), 'GET /api/price-alerts is not Pro-gated, so a valid token must be accepted').toBe(200);
  });

  for (const { method, path } of GATED) {
    test(`${method} ${path} respects the Pro boundary`, async ({ request }) => {
      const opts = {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {},
        failOnStatusCode: false,
      };
      const r = method === 'GET'    ? await request.get(path, opts)
              : method === 'PATCH'  ? await request.patch(path, opts)
              :                       await request.post(path, opts);

      const status = r.status();
      const body = await r.text();

      /* 405 or 404 means this entry names the wrong method or path, not that the
       * product is wrong. Fail loudly rather than let it read as "refused". */
      expect(status, `${method} ${path} returned ${status} — this spec has the wrong method/path, not a finding`)
        .not.toBe(405);
      expect(status, `${method} ${path} returned 404 — route moved or renamed`).not.toBe(404);
      expect(status, `${method} ${path} returned 401 — the token stopped working mid-run`).not.toBe(401);

      if (expectPro) {
        // Trial or paid: the gate must NOT refuse. Anything else about the
        // response (400 for an empty body, 500 from an upstream) is not this
        // test's business — only that it was not refused for entitlement.
        expect(status, `${path} refused a Pro-entitled account (${why})`).not.toBe(403);
      } else {
        expect(status, `${path} did NOT refuse a free account (${why}) — Pro feature reachable without Pro`).toBe(403);
        expect(body, `${path} returned 403 without PRO_REQUIRED — refused for some other reason`).toContain('PRO_REQUIRED');
      }
    });
  }

  /* An unauthenticated caller must be turned away as unauthenticated. A 403 with
   * no token would mean the route evaluated entitlement for nobody, which is a
   * different and worse bug than a missing gate. */
  test('no token is 401, never 403', async ({ request }) => {
    const failures: string[] = [];
    for (const { method, path } of GATED) {
      const opts = { headers: { 'Content-Type': 'application/json' }, data: {}, failOnStatusCode: false };
      const r = method === 'GET'   ? await request.get(path, opts)
              : method === 'PATCH' ? await request.patch(path, opts)
              :                      await request.post(path, opts);
      if (r.status() === 403) failures.push(`${method} ${path} -> 403 with no token`);
      if (r.status() === 200) failures.push(`${method} ${path} -> 200 with no token`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
