import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';
import { ENTITLEMENT_READY, ENTITLEMENT_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON, signIn } from './_auth';

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
/* `/api/push/test` was excluded from this list until 2026-08-09, and now is not.
 *
 * It verifies the caller with `getSupabaseAdmin()` rather than the anon client,
 * so without SUPABASE_SERVICE_ROLE_KEY the admin client throws, `getUser`
 * catches and returns null, and the route answers 401 to a perfectly good
 * token. Asserting on it then would have failed the release gate for an
 * environment gap, so it was excluded LOUDLY and the gap recorded: push/test's
 * Pro gate was verified by nothing.
 *
 * The owner supplied the key to the E2E job (see the long block in `ci.yml`),
 * so the exclusion no longer has a reason and the route is in GATED below.
 *
 * What it does in CI, checked against the route rather than assumed:
 *   free -> 403 `PRO_REQUIRED`, which is what this spec asserts
 *   pro  -> 503 `VAPID not configured`, because CI has no VAPID keys. That is
 *           not 403, which is all the PRO direction claims - and it means
 *           **no real push is sent**, so this adds no side effect.
 *
 * If the 503 ever becomes a 200, someone has put VAPID credentials in CI and
 * this route now messages real devices on every release run. Worth noticing.
 */
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

/* The two GATED routes that can produce a REAL external side effect, mapped to
 * the `configured` flag on /api/version that says whether they can fire.
 *
 * Everything else in GATED reads or computes. These two send. */
const DELIVERS: Record<string, string> = {
  '/api/push/test': 'vapid',
  '/api/telegram/test': 'telegram',
};

test.describe('Pro entitlement boundary', () => {
  let configured: Record<string, boolean> | null = null;
  test.skip(!ENTITLEMENT_READY, ENTITLEMENT_SKIP_REASON);
  // HTTP level — running both viewport projects would just double the requests.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  let freeToken = '';
  let proToken = '';

  /** Read an account's own subscription row. RLS restricts this to the caller,
   *  which is the same read `getEntitlement()` performs server-side. */
  async function readRow(token: string, userId: string) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${P}user_subscriptions?user_id=eq.${userId}&select=role,trial_ends_at`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`could not read ${P}user_subscriptions (HTTP ${res.status})`);
    const rows = (await res.json()) as Array<{ role?: string; trial_ends_at?: string | null }>;
    return rows[0] ?? {};
  }

  /* PIN the state, do not read it and adapt.
   *
   * The previous version derived its expectation from whatever the account
   * happened to be. That sounds safer than hardcoding and is not: user A is on a
   * trial ending 2026-08-19, so the same spec asserted "Pro access allowed"
   * before that date and "free access blocked" after it, with nothing
   * announcing the switch. A test whose meaning depends on the calendar reports
   * green either way.
   *
   * These fixtures are seeded to a fixed state and this hook FAILS if they have
   * drifted, rather than quietly testing the other direction. */
  test.beforeAll(async () => {
    /* A is the PRO fixture, B is the FREE one - set that way in
     * `lhq_dev_user_subscriptions` rather than by seeding new accounts. */
    proToken = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    freeToken = await signIn(FIXTURES.bEmail, FIXTURES.bPassword);

    const pro = await readRow(proToken, FIXTURES.aId);
    const free = await readRow(freeToken, FIXTURES.bId);

    expect(free.role ?? 'free',
      `fixture B drifted: role=${free.role}. It must be 'free' or this spec cannot prove the gate blocks anyone.`,
    ).toBe('free');
    expect(free.trial_ends_at ?? null,
      `fixture B has a trial (${free.trial_ends_at}). A trial grants Pro FEATURES, so the gate lets it through and this spec would assert the opposite of what it claims. Both fixtures ran a trial to 2026-08-19 until it was nulled.`,
    ).toBeNull();
    expect(pro.role,
      `fixture A drifted: role=${pro.role}. It must be 'pro' - nothing in the dev database was pro before 2026-08-08, so this direction has never been exercised by anything else.`,
    ).toBe('pro');
  });

  /* Ask the host which integrations are live, so the delivery routes below can
   * refuse to fire. Absent on any build predating #283 - handled as "unknown",
   * which skips rather than sends. */
  test.beforeAll(async ({ request }) => {
    try {
      const r = await getGuarded(request, '/api/version');
      configured = (await r.json())?.configured ?? null;
    } catch { configured = null; }
  });

  /* Guard against a vacuous pass. If the token were rejected, every route below
   * would return 401 and a naive "not 200" assertion would read as a clean run.
   * The ungated GET proves the token authenticates before anything else is
   * concluded from a status code. */
  test('the fixture token actually authenticates (guards against a vacuous pass)', async ({ request }) => {
    const r = await getGuarded(request, '/api/price-alerts', {
      headers: { Authorization: `Bearer ${freeToken}` },
      failOnStatusCode: false,
    });
    expect(r.status(), 'GET /api/price-alerts is not Pro-gated, so a valid token must be accepted').toBe(200);
  });

  for (const { method, path } of GATED) {
    test(`${method} ${path} refuses a FREE account`, async ({ request }) => {
      const opts = {
        headers: { Authorization: `Bearer ${freeToken}`, 'Content-Type': 'application/json' },
        data: {},
        failOnStatusCode: false,
      };
      const r = method === 'GET'   ? await getGuarded(request, path, opts)
              : method === 'PATCH' ? await request.patch(path, opts)
              :                      await request.post(path, opts);
      const status = r.status();

      /* 404/405/401 mean this entry names the wrong method or path, or the token
       * stopped working - a fault in the spec, not a finding about the product. */
      expect(status, `${method} ${path} -> ${status}: wrong method/path in this spec, not a finding`).not.toBe(405);
      expect(status, `${method} ${path} -> 404: route moved or renamed`).not.toBe(404);
      expect(status, `${method} ${path} -> 401. The token works elsewhere in this run, so this route authenticates differently - check whether it uses getSupabaseAdmin(), which needs env CI does not have.`).not.toBe(401);

      expect(status, `${path} did NOT refuse a free account — a Pro feature is reachable without Pro`).toBe(403);
      /* The 403 is what matters; the CODE is a contract clients branch on.
       * `/api/alerts/preview` answers `{ error: 'Pro required' }` where the
       * other 14 answer `PRO_REQUIRED` - gated correctly, inconsistently
       * labelled. Accepting both rather than failing the release on a string,
       * and recorded so the inconsistency is visible rather than absorbed. */
      const body = (await r.text()).toLowerCase();
      expect(body.includes('pro_required') || body.includes('pro required'),
        `${path} returned 403 but named no Pro requirement — refused for some other reason`).toBe(true);
    });

    test(`${method} ${path} admits a PRO account`, async ({ request }) => {
      /* DELIVERY ROUTES: prove the send is IMPOSSIBLE before calling one.
       *
       * Two of these fifteen do not just answer - they message a real device or
       * chat. The old assumption, written in this file's header, was that they
       * were inert because CI had no credentials:
       *
       *   "pro -> 503 VAPID not configured ... it means no real push is sent,
       *    so this adds no side effect. If the 503 ever becomes a 200, someone
       *    has put VAPID credentials in CI ... Worth noticing."
       *
       * That condition came true and nothing noticed, because the assertion is
       * `not.toBe(403)` and a 200 satisfies it identically to a 503. Measured
       * 2026-08-12 on deployed `qa` (#299): `telegram: true`, and
       * `/api/telegram/test` falls back to the environment's TELEGRAM_CHAT_ID
       * when the user has no linked chat - which on qa is a copy of dev's. So
       * this sweep was posting a real message to dev's chat on every run.
       *
       * A comment describing an invariant is the thing that goes stale. This
       * asks the HOST instead, via #283's `configured` block, and refuses to
       * call the route unless the host says delivery cannot happen.
       *
       * The default is SKIP, not send: if the block is absent, or reports the
       * integration as live, we do not know the call is safe and do not make it.
       * The FREE direction above is unaffected - a 403 lands before any send. */
      const flag = DELIVERS[path];
      if (flag) {
        test.skip(configured?.[flag] !== false,
          `${path} can deliver on this host (configured.${flag}=${String(configured?.[flag])}). ` +
          `Calling it messages a real device or chat, so this direction is not exercised here. ` +
          `See #299.`);
      }

      const opts = {
        headers: { Authorization: `Bearer ${proToken}`, 'Content-Type': 'application/json' },
        data: {},
        failOnStatusCode: false,
      };
      const r = method === 'GET'   ? await getGuarded(request, path, opts)
              : method === 'PATCH' ? await request.patch(path, opts)
              :                      await request.post(path, opts);

      /* The control for the test above. Without it, a route that returns 403 to
       * EVERYONE - broken, not gated - reads as a pass. Anything else about the
       * response (400 for an empty body, 500 upstream) is not this test's
       * business; only that it was not refused for entitlement. */
      expect(r.status(), `${path} refused a PRO account — the gate is not gating, it is broken`).not.toBe(403);

      /* When the host says the integration is off, the route must SAY so rather
       * than answering 200. This is what makes the skip above meaningful: on a
       * host where delivery is impossible we assert the not-configured path
       * explicitly, so "no side effect" is a measurement rather than a belief.
       *
       * 404 and 503 are both legitimate here and mean different things - dev
       * measured push answering 404 'No subscriptions found' before it reaches
       * sendNotification, where the header predicted 503. The reason changed and
       * the safety did not, which is exactly why this asserts the class of
       * answer rather than the number. */
      if (flag) {
        expect([404, 503],
          `${path} answered ${r.status()} on a host reporting configured.${flag}=false. ` +
          `A 200 here means it found some other way to deliver, and this sweep would be ` +
          `sending on every run - the thing #299 exists to stop.`).toContain(r.status());
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
      const r = method === 'GET'   ? await getGuarded(request, path, opts)
              : method === 'PATCH' ? await request.patch(path, opts)
              :                      await request.post(path, opts);
      if (r.status() === 403) failures.push(`${method} ${path} -> 403 with no token`);
      if (r.status() === 200) failures.push(`${method} ${path} -> 200 with no token`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
