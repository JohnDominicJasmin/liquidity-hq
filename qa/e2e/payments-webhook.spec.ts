import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
/* SIDE-EFFECT IMPORT, and it is load-bearing. `_auth.ts` reads `.env.e2e.local`
 * and `.env.local` into process.env at module scope. Without it this file sees
 * no LEMONSQUEEZY_WEBHOOK_SECRET locally, and ALL THREE signed tests skip -
 * including the BOLA-of-payments one, which is the most important assertion in
 * the file.
 *
 * That was the actual state until 2026-08-11: they passed in CI, where the job
 * supplies env directly, and skipped everywhere else. With CI disabled for cost
 * since 2026-08-10, "everywhere else" is the only place they run - so the
 * payments security surface was verified by nothing, anywhere, and the only
 * symptom was `3 skipped` scrolling past.
 *
 * Exactly the trap `_auth.ts` documents at length about E2E_B_PRICE_ALERT_ID
 * skipping all twenty authenticated tests. Same shape, different file, found by
 * adding a fourth test and noticing it skipped too. */
import './_auth';

/* The LemonSqueezy webhook — signature, replay guard, ownership check.
 *
 * `qa/QA_TEST_PLAN.md` has said since it was written:
 *
 *   > LemonSqueezy webhook: payer-email check + replay guard — not tested,
 *   > payments aren't live, no real webhook payload exists to test with
 *
 * That is still true of payments. It is not true of the handler: it verifies an
 * HMAC we can compute, and the branches that matter all answer BEFORE the
 * database write, so they can be exercised without a LemonSqueezy account and
 * without touching `user_subscriptions`.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER. The write itself — that the decision
 * `patchForEvent` returns actually reaches the row. Asserting that means
 * flipping a real account on a database shared with `dev`, and the row would be
 * the entitlement spec's `pro` fixture. Tracked on #134; needs a sacrificial
 * account.
 *
 * The DECISION is covered by `__tests__/lemonsqueezyEvents.test.mts`, which
 * needs no database at all. Neither file replaces the other:
 *
 *   this           -> is the caller allowed to reach the decision
 *   that           -> is the decision right
 *   still missing  -> does the decision reach the database
 */

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
const ENDPOINT = '/api/lemonsqueezy/webhook';

/** Sign exactly as `verifySignature` does — HMAC-SHA256 over the raw body, hex. */
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/* EVERY PAYLOAD CARRIES A NONCE, and that is load-bearing.
 *
 * The route hashes the raw body and inserts it into `ls_webhook_events` BEFORE
 * the ownership check (route.ts:51 vs :72). A byte-identical payload therefore
 * takes the replay path on every run after the first — the request never
 * reaches the branch the test is about.
 *
 * Without this, the two signed tests fail in opposite directions:
 *
 *   ownership test -> passes on run 1, FAILS on every run after, during a
 *                     release, which is the worst place to read a red run
 *   replay test    -> passes forever and stops meaning anything from run 2,
 *                     because both POSTs take the replay path and it can no
 *                     longer tell a working guard from one that answers
 *                     "replay" to everything
 *
 * Caught by dev on review. It is the same shape as every other defect found
 * today: a test that reports the same result whether or not the thing it
 * covers works.
 *
 * The nonce goes in `custom_data`, which the handler reads but does not
 * validate, so it changes the hash without changing any behaviour under test. */
function payload(eventName: string, userId: string, payerEmail: string, id = 'sub_test_1') {
  return JSON.stringify({
    meta: {
      event_name: eventName,
      custom_data: { user_id: userId, qa_nonce: crypto.randomUUID() },
    },
    data: {
      id,
      attributes: {
        status: 'active',
        user_email: payerEmail,
        customer_id: 4242,
        renews_at: '2099-01-01T00:00:00Z',
      },
    },
  });
}

test.describe('LemonSqueezy webhook', () => {
  // HTTP level — the viewport is irrelevant and running both projects would
  // double the requests for nothing.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  /* These two need no secret: they assert the handler refuses BEFORE it needs
   * one, which is the whole point of checking the signature first. */

  test('a payload with no signature is rejected', async ({ request }) => {
    const body = payload('subscription_created', 'anyone', 'someone@example.test');
    const r = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json' },
      data: body,
      failOnStatusCode: false,
    });
    expect(r.status(), 'an unsigned payload was accepted').toBe(401);
  });

  test('a payload signed with the wrong secret is rejected', async ({ request }) => {
    const body = payload('subscription_created', 'anyone', 'someone@example.test');
    const r = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'x-signature': sign(body, 'not-the-secret') },
      data: body,
      failOnStatusCode: false,
    });

    /* The most important assertion in this file. If a forged signature is
     * accepted, everything below is decoration - anyone who can reach the URL
     * can grant themselves Pro. */
    expect(r.status(), 'a payload signed with the WRONG secret was accepted').toBe(401);
  });

  test('a syntactically invalid signature is rejected, not thrown on', async ({ request }) => {
    const body = payload('subscription_created', 'anyone', 'someone@example.test');
    const r = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'x-signature': 'zzzz-not-hex' },
      data: body,
      failOnStatusCode: false,
    });

    /* `timingSafeEqual` throws on a non-hex buffer, and the handler catches it.
     * Without that catch this is a 500 - a crash an attacker controls, and one
     * that would make the route a denial-of-service surface. */
    expect(r.status(), 'a malformed signature produced something other than 401').toBe(401);
    expect(r.status(), 'a malformed signature crashed the route').not.toBe(500);
  });

  /* ── A signed event with no user of ours attached ──────────────────────────
   *
   * Needs the SECRET and nothing else: `if (!userId) return` sits at
   * route.ts:56, BEFORE `getSupabaseAdmin()`, so this never touches the
   * database. That is why it is here rather than in `payments-write-path.spec.ts`
   * where I first said it would go - putting it there would have made it skip
   * whenever the service-role key was absent, for a branch that does not use it.
   *
   * WHY IT MATTERS, and it is about to matter for real. `custom_data.user_id` is
   * written by `getCheckoutUrl`, so it is present on events from orders that went
   * through our checkout and ABSENT on an event simulated from the LemonSqueezy
   * dashboard against an order created any other way. Simulation is how the
   * cancelled/expired/refunded branches get exercised without waiting out a real
   * billing period (#243), so this path is about to be hit deliberately.
   *
   * It used to return a bare `{received: true}`, which LemonSqueezy renders as a
   * green delivery - so "the handler ignored this" and "the handler worked" were
   * the same picture, on the payments path, in the run whose purpose is deciding
   * whether payments work. Fixed in #251; this is what stops it regressing.
   *
   * Still 2xx on purpose: a non-2xx makes LemonSqueezy RETRY, and an event with
   * no user of ours attached is not a failure to retry - it is correctly not
   * ours. Asserting the STATUS as well as the reason, because a later "tidy-up"
   * to 4xx would turn every such delivery into a retry storm. */
  test.describe('signed, but no user attached', () => {
    test.skip(!SECRET,
      'LEMONSQUEEZY_WEBHOOK_SECRET is not set, so no correctly-signed payload can be built. ' +
      'Skipping rather than passing: this asserts a REASON string, and a test that never ' +
      'reaches the handler cannot tell a missing reason from a wrong one.');

    test('is refused with a reason, not a bare 200', async ({ request }) => {
      /* Deliberately no `custom_data.user_id`, and a nonce so the replay guard
         does not answer first on a re-run. The guard is downstream of this
         branch, but the nonce costs nothing and the failure it prevents is the
         confusing kind. */
      const body = JSON.stringify({
        meta: { event_name: 'subscription_created', custom_data: { qa_nonce: crypto.randomUUID() } },
        data: { id: 'sub_no_user', attributes: { status: 'active', user_email: 'nobody@example.test' } },
      });

      const r = await request.post(ENDPOINT, {
        headers: { 'Content-Type': 'application/json', 'x-signature': sign(body) },
        data: body,
        failOnStatusCode: false,
      });

      expect(r.status(), 'a non-2xx makes LemonSqueezy retry an event that will never succeed').toBe(200);

      const text = await r.text();
      expect(text,
        'the handler accepted an event with no user attached and said nothing about it. ' +
        'That renders as a green delivery in the LemonSqueezy log, so a silent no-op is ' +
        'indistinguishable from a successful write - the #228 empty-200 on the payments path.')
        .toContain('no custom_data.user_id');
    });
  });

  test.describe('with a valid signature', () => {
    test.skip(!SECRET,
      'LEMONSQUEEZY_WEBHOOK_SECRET is not set, so no correctly-signed payload can be built. ' +
      'Skipping rather than passing: a signed-payload test that never signs anything proves nothing.');

    /* AND the handler needs SUPABASE_SERVICE_ROLE_KEY.
     *
     * Both branches these tests target run through `getSupabaseAdmin()`: the
     * replay guard inserts into `ls_webhook_events`, and the ownership check
     * calls `sb.auth.admin.getUserById`. Without the admin client the route
     * errors before reaching either, so the test fails on the environment
     * rather than on the behaviour - which is exactly what happened on release
     * PR #141, the first run where these two executed at all.
     *
     * CI now supplies the key (owner decision, 2026-08-09; the reasoning is in
     * `ci.yml` beside the variable). **Keeping this guard anyway.** It is not
     * dead code: it is what makes a missing secret produce a legible skip
     * instead of a confusing failure, and it is what stops these two from ever
     * silently becoming assertions about an environment error.
     *
     * A skip here is now a FINDING, not a limitation - it means the secret is
     * absent from a job that is supposed to have it. Treat it as a red run. */
    test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY,
      'SUPABASE_SERVICE_ROLE_KEY is absent, so the handler errors before reaching the replay guard ' +
      'or the ownership check. CI is supposed to supply this now - if you are reading this in a CI ' +
      'log, the secret E2E_SUPABASE_SERVICE_ROLE_KEY is missing or empty, and these two assertions ' +
      'are verified by nothing. That is a failure to fix, not a limitation to accept.');

    /* THE BOLA OF PAYMENTS, and it has never run.
     *
     * `user_id` arrives in `custom_data`, which `lib/checkout.ts` writes into a
     * CLIENT-SIDE checkout URL — so the payer chooses it. The signature proves
     * LemonSqueezy sent the event; it never proves the payer owns the account
     * they named. Without the email check, someone edits the id in their own
     * browser, makes one genuine purchase, and Pro lands on any account. */
    test('a payer cannot grant Pro to an account they do not own', async ({ request }) => {
      const body = payload('subscription_created', '00000000-0000-4000-8000-000000000000', 'attacker@example.test');
      const r = await request.post(ENDPOINT, {
        headers: { 'Content-Type': 'application/json', 'x-signature': sign(body) },
        data: body,
        failOnStatusCode: false,
      });

      expect(r.status(), 'the handler errored rather than refusing cleanly').toBe(200);
      const text = await r.text();
      expect(text, 'a payer granted Pro to an account they do not own').toContain('email_mismatch');
    });

    /* LemonSqueezy retries any non-2xx with a byte-identical body. The handlers
     * are idempotent upserts today, so a replay is only wasteful - but this is
     * what stops the next non-idempotent thing added here becoming a billing
     * bug. Same payload twice: the second must be recognised, not re-applied. */
    test('a replayed payload is recognised and not re-applied', async ({ request }) => {
      /* One body, posted twice. The nonce makes it unique to THIS run, so the
       * first POST is genuinely first and the second is genuinely a replay -
       * which is the only arrangement where this assertion means anything. */
      const body = payload('subscription_created', '00000000-0000-4000-8000-000000000001', 'replay@example.test', 'sub_replay_probe');
      const opts = {
        headers: { 'Content-Type': 'application/json', 'x-signature': sign(body) },
        data: body,
        failOnStatusCode: false,
      };

      const first = await request.post(ENDPOINT, opts);
      const second = await request.post(ENDPOINT, opts);

      expect(first.status()).toBe(200);
      expect(second.status()).toBe(200);

      /* The first is refused for email mismatch (the user id is synthetic), so
       * it never reaches the write - which is exactly why this is safe to run
       * against a shared database. The SECOND must be stopped earlier still, by
       * the replay guard, and saying so is the assertion. */
      expect(await second.text(), 'the same payload was processed twice').toContain('replay');
    });
  });
});
