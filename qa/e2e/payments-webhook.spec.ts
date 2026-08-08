import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

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

function payload(eventName: string, userId: string, payerEmail: string, id = 'sub_test_1') {
  return JSON.stringify({
    meta: { event_name: eventName, custom_data: { user_id: userId } },
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

  test.describe('with a valid signature', () => {
    test.skip(!SECRET,
      'LEMONSQUEEZY_WEBHOOK_SECRET is not set, so no correctly-signed payload can be built. ' +
      'Skipping rather than passing: a signed-payload test that never signs anything proves nothing.');

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
