import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, signIn } from './_auth';

/* Does `/ops` ADMIT the people it is supposed to admit? (#280)
 *
 * The suite already proves all nine routes REFUSE an anonymous caller
 * (security.spec.ts). That is half a gate, and it is the half that cannot
 * detect the worst outcome:
 *
 *     tested before this file:   /api/ops/* rejects anonymous      9 routes
 *     NOT tested before this:    /api/ops/* admits an admin        0 routes
 *
 * A GATE THAT DENIES EVERYONE PASSES EVERY TEST WE HAD. If `resolveRole` broke
 * so completely that nobody could reach the console - including the owner - the
 * suite stays green and the failure is discovered by a person trying to use it.
 * Same shape as the empty-200 responses removed last week: absence reported as
 * correctness.
 *
 * Dev probed this by hand on 2026-08-12 and it passed. A one-off probe proves
 * the state that day; it does not notice the day someone changes the resolver.
 * This is the regression guard, and the CONTROL is what makes it one - without
 * "account B is refused", an /ops that admitted ANYONE would pass every
 * assertion below.
 *
 * IT ALSO WALKS THE BOOTSTRAP PATH. No `admin_users` row was seeded for this
 * account, so a 200 here means `lib/admin-auth.ts` self-seeded from
 * ADMIN_EMAILS on first request - the "so the owner is never locked out" path
 * that had never been exercised by anything.
 */

const ADMIN_EMAIL    = process.env.E2E_USER_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_USER_ADMIN_PASSWORD ?? '';

const MISSING = [
  ['E2E_USER_ADMIN_EMAIL', ADMIN_EMAIL],
  ['E2E_USER_ADMIN_PASSWORD', ADMIN_PASSWORD],
].filter(([, v]) => !v).map(([n]) => n);

/* Named, not globbed. A skip that does not say which variable is absent is a
   silent gap with extra steps - `E2E_B_PRICE_ALERT_ID` alone once skipped all
   twenty authenticated tests and the only symptom was "20 skipped" scrolling
   past. */
const ADMIN_READY = AUTH_READY && MISSING.length === 0;
const ADMIN_SKIP  = MISSING.length
  ? `admin fixture absent - MISSING: ${MISSING.join(', ')}. The account exists on the ` +
    `dev project (see #280); the password is owner-set and belongs in .env.e2e.local.`
  : AUTH_SKIP_REASON;

/* `/api/ops/spike-alert` is DELIBERATELY NOT IN THIS LIST. Do not add it.
 *
 * `app/api/ops` has ten route directories; this covers nine. The tenth is a cron
 * route that happens to live under /ops - `app/api/ops/spike-alert/route.ts:20`
 * calls `checkCronAuth(req)`, not the admin resolver - so it answers to
 * CRON_SECRET and an admin token is refused there, correctly.
 *
 * Putting it in OPS_ROUTES would produce a spec asserting that an admin can
 * reach a cron endpoint, which is the opposite of what we want to be true.
 *
 * "Nine of ten routes covered" is exactly the kind of thing someone helpfully
 * fixes later, so the exclusion is pinned by the test at the bottom of this file
 * rather than left to this comment. A comment can be overruled by a confident
 * reader; a red test cannot. */
const CRON_GUARDED_UNDER_OPS = '/api/ops/spike-alert';

const OPS_ROUTES = [
  '/api/ops/overview', '/api/ops/users', '/api/ops/team', '/api/ops/config',
  '/api/ops/accuracy', '/api/ops/ai-cost', '/api/ops/api-health',
  '/api/ops/crons', '/api/ops/me',
] as const;

test.describe('/ops admit path', () => {
  test.skip(!ADMIN_READY, ADMIN_SKIP);

  let adminToken = '';
  let freeToken  = '';

  test.beforeAll(async () => {
    /* signIn throws loudly on failure by design - a silent auth failure would
       make every assertion below trivially "pass" by turning a 200 check into a
       test that never ran. */
    adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    freeToken  = await signIn(FIXTURES.bEmail, FIXTURES.bPassword);
  });

  for (const path of OPS_ROUTES) {
    test(`ADMITS an authenticated admin: ${path}`, async ({ request }) => {
      const res = await getGuarded(request, path, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status(),
        `${path} refused an ADMIN_EMAILS account. Either the admin resolver broke, or ` +
        `ADMIN_EMAILS on this host does not contain ${ADMIN_EMAIL} - check /api/version ` +
        `'configured.adminEmails' before assuming the first.`).toBe(200);
    });
  }

  for (const path of OPS_ROUTES) {
    test(`CONTROL - REFUSES a signed-in non-admin: ${path}`, async ({ request }) => {
      /* Account B: a real session, a real user, no admin claim. This is the
         assertion that stops the file degrading into "the gate is open".
         Anonymous refusal is already covered in security.spec.ts; a SIGNED-IN
         non-admin is the case that distinguishes "checks the role" from
         "checks for any token at all". */
      const res = await getGuarded(request, path, {
        headers: { Authorization: `Bearer ${freeToken}` },
      });
      expect([401, 403],
        `${path} admitted a non-admin signed-in user - every paying account can read ` +
        `the ops console`).toContain(res.status());
    });
  }

  test(`CONTROL: ${CRON_GUARDED_UNDER_OPS} REFUSES an admin - it is a cron route`, async ({ request }) => {
    /* The executable form of the comment above OPS_ROUTES. It is under /ops and
       it is NOT admin-guarded, and the only thing stopping someone adding it to
       the list "for completeness" is this failing when they do.
       Also worth having in its own right: if this ever starts returning 200 to a
       user token, a route that fires alerts became reachable by anyone signed
       in. */
    const res = await request.get(CRON_GUARDED_UNDER_OPS, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([401, 403],
      `${CRON_GUARDED_UNDER_OPS} admitted an admin token. It is guarded by checkCronAuth ` +
      `(CRON_SECRET), not the admin resolver - if this is now admin-guarded that is a ` +
      `behaviour change, and it belongs in OPS_ROUTES above with a note saying why.`)
      .toContain(res.status());
  });

  test('CONTROL: the two tokens are actually different sessions', async () => {
    /* If both helpers somehow minted the same token, "admin gets 200" and
       "non-admin gets 401" could not both be true, and the file would fail in a
       confusing way rather than an obvious one. Cheap, and it names the cause. */
    expect(adminToken.length, 'admin token missing').toBeGreaterThan(20);
    expect(freeToken.length, 'free-account token missing').toBeGreaterThan(20);
    expect(adminToken, 'both fixtures minted the same session').not.toBe(freeToken);
  });
});
