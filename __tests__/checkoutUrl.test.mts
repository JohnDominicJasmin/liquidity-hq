import test from 'node:test';
import assert from 'node:assert/strict';

/* `getCheckoutUrl` is where the payments BOLA surface is CREATED.
 *
 * `qa/e2e/payments-webhook.spec.ts` asserts the handler refuses a payload that
 * claims someone else's `user_id`. This file asserts the other end: where that
 * value comes from, and that it is exactly as untrustworthy as the handler
 * assumes.
 *
 * The webhook reads `custom_data.user_id`. That value is put there by this
 * function, into a URL, in the browser - so the payer can edit it before paying.
 * The ownership check exists precisely because of this line:
 *
 *     url.searchParams.set('checkout[custom][user_id]', user.id)
 *
 * WHY THIS IS A UNIT TEST AND WHAT IT THEREFORE DOES NOT PROVE. It pins the
 * CONTRACT - what the URL contains for a given user. It cannot prove the
 * function is WIRED to the button, which is the failure mode that produced #164
 * (a fix whose hook returned a context default forever, passing 22 source-level
 * tests). The wiring is covered separately in the e2e spec; both halves are
 * needed and neither substitutes for the other.
 *
 * Runs with `npm test`, needs no network and no LemonSqueezy account.
 */

const KEY = 'NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL';

/** Import fresh each time: the module reads process.env at call time, but a
 *  cached module would hide it if that ever changed to read-at-import. */
async function checkout() {
  const mod = await import(`../lib/checkout.ts?t=${Date.now()}`);
  return mod.getCheckoutUrl as (u: { id: string; email?: string } | null) => string;
}

async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try { return await fn(); } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'payer@example.test' };

test('the checkout URL carries the identity the webhook must not trust', async (t) => {
  await t.test('unconfigured checkout sends the user to signup, not to a broken URL', async () => {
    const getCheckoutUrl = await checkout();
    await withEnv(undefined, async () => {
      assert.equal(getCheckoutUrl(USER), '/login?signup=1');
    });
    /* '#' is what the env file ships as a placeholder. Treating it as
     * "configured" would produce a checkout link that goes nowhere. */
    await withEnv('#', async () => {
      assert.equal(getCheckoutUrl(USER), '/login?signup=1');
    });
  });

  await t.test('a signed-in user gets their OWN id and email in the URL', async () => {
    const getCheckoutUrl = await checkout();
    await withEnv('https://example.lemonsqueezy.com/checkout/buy/abc', async () => {
      const url = new URL(getCheckoutUrl(USER));
      assert.equal(url.searchParams.get('checkout[custom][user_id]'), USER.id);
      assert.equal(url.searchParams.get('checkout[email]'), USER.email);
    });
  });

  /* THE POINT OF THE FILE.
   *
   * This is not a defect and must not be "fixed" - a checkout URL has to carry
   * the buyer's id somehow, and it is a URL, so the buyer can change it. The
   * test exists so that nobody later reads the webhook's ownership check as
   * belt-and-braces and removes it.
   *
   * If this assertion ever fails because the id moved somewhere signed or
   * server-side, that is an improvement - and the ownership check should still
   * stay, because defence in depth is the whole argument. */
  await t.test('the id is client-editable, which is WHY the webhook verifies ownership', async () => {
    const getCheckoutUrl = await checkout();
    await withEnv('https://example.lemonsqueezy.com/checkout/buy/abc', async () => {
      const mine = new URL(getCheckoutUrl(USER));

      // Anyone can do this in the address bar before paying.
      mine.searchParams.set('checkout[custom][user_id]', '99999999-9999-4999-8999-999999999999');

      assert.equal(
        mine.searchParams.get('checkout[custom][user_id]'),
        '99999999-9999-4999-8999-999999999999',
        'the user_id is a plain query parameter with no signature - if this ever stops being ' +
        'true, say so on the payments issue, but do NOT remove the webhook ownership check',
      );
    });
  });

  await t.test('a signed-out visitor leaks no checkout parameters', async () => {
    const getCheckoutUrl = await checkout();
    await withEnv('https://example.lemonsqueezy.com/checkout/buy/abc', async () => {
      const url = new URL(getCheckoutUrl(null));
      assert.equal(url.searchParams.get('checkout[custom][user_id]'), null);
      assert.equal(url.searchParams.get('checkout[email]'), null);
    });
  });

  /* A malformed value must not throw. `getCheckoutUrl` runs during render on
   * /upgrade and inside UpgradeGateModal; an exception there blanks the page a
   * user reached in order to give us money. */
  await t.test('a malformed checkout URL degrades instead of throwing', async () => {
    const getCheckoutUrl = await checkout();
    await withEnv('not a url', async () => {
      assert.doesNotThrow(() => getCheckoutUrl(USER));
      assert.equal(getCheckoutUrl(USER), 'not a url');
    });
  });
});
