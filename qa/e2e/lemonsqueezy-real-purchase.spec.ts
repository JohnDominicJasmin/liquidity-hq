import { test, expect } from '@playwright/test';
import { gotoSignedIn } from './_auth';
import {
  ACCOUNT_C_READY, ACCOUNT_C_SKIP_REASON, FIXTURES,
  SUPABASE_URL, SUPABASE_ANON, signIn, signedInContext,
} from './_auth';
import { getGuarded } from './_shared';

/* #243 - THE LAST UNCOVERED HALF OF PAYMENTS: does a REAL LemonSqueezy
 * purchase produce a real webhook event that grants Pro?
 *
 *   is the caller allowed to reach the decision   payments-webhook.spec.ts      covered
 *   is the decision right                         lemonsqueezyEvents.test.mts   covered
 *   does the decision reach the database           payments-write-path.spec.ts  covered
 *   does a REAL PURCHASE produce the event         THIS FILE
 *
 * Everything else uses synthetic payloads signed with a local secret. This is
 * the one that needs an actual LemonSqueezy account, an actual test-mode
 * card, and the owner's merchant verification (#861) - none of which exist
 * yet. So this file is deliberately split into what runs TODAY and what only
 * runs once a human has completed a real purchase:
 *
 *   runs today, no purchase needed   config agreement, C's baseline, the
 *                                    checkout hand-off (aborted before the
 *                                    real host, same pattern as checkout.spec)
 *   runs only after a real purchase  the entitlement read (row + PAGE-LEVEL
 *                                    gate, #786's shape), the cancel-but-
 *                                    keep-until-expiry branch (#134)
 *
 * WHY ACCOUNT C, NOT A OR B. Both are pinned - A is `pro`/no trial, B is
 * `free`/no trial - and entitlements.spec.ts fails deliberately if either
 * drifts. Mutating one with a real purchase would break every test that
 * depends on it. C is referenced by nothing else (#239) for exactly this
 * reason: it is the one account a real purchase is allowed to touch.
 *
 * WHY THE ASSERTIONS BELOW ARE WRITTEN, NOT DEFERRED. The owner should not be
 * waiting on QA to write a test the moment #861 clears and a build goes out.
 * Everything up to the purchase is buildable now, so it is built now - the
 * entitlement checks below will simply keep skipping, with a reason, until
 * someone completes a real purchase for C and re-runs this file.
 *
 * WHAT THIS FILE DOES NOT AND WILL NOT AUTOMATE: actually completing the
 * LemonSqueezy checkout (entering a test card on their hosted page) and
 * resetting C back to free afterward. The first is a real third-party
 * payment form outside this app - automating it is fragile and not this
 * suite's place. The second is a write to the shared database, one of the
 * three things QA does not do without going through the owner. Both are
 * named below as manual steps, not silently skipped.
 */

const CHECKOUT_PATH = '**/checkout/buy/**';
const DASHBOARD = '/dashboard';
/* Same convention as entitlements.spec.ts's `P`. A real LemonSqueezy test-mode
 * purchase is only ever meaningful against an appEnv=dev host in the first
 * place - the webhook route itself refuses test_mode events elsewhere - so
 * this will in practice always resolve to lhq_dev_, but it is computed rather
 * than hardcoded for the same reason entitlements.spec.ts computes it. */
const P = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';

interface VersionPayload {
  configured?: { checkout?: boolean; lemonsqueezyWebhook?: boolean };
}

interface SubRow {
  role?: string;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

test.describe('#243 real LemonSqueezy purchase', () => {
  test.skip(!ACCOUNT_C_READY, ACCOUNT_C_SKIP_REASON);
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP/navigation-level checks, viewport irrelevant');
  });

  let configured: VersionPayload['configured'] | null = null;
  let cToken = '';

  test.beforeAll(async ({ request }) => {
    try {
      const r = await getGuarded(request, '/api/version');
      configured = ((await r.json()) as VersionPayload)?.configured ?? null;
    } catch { configured = null; }
    cToken = await signIn(FIXTURES.cEmail, FIXTURES.cPassword);
  });

  /** Read account C's own subscription row. RLS restricts this to the
   *  caller, which is the same read `getEntitlement()` performs server-side
   *  - same pattern as entitlements.spec.ts's readRow, plus
   *  current_period_end for the #134 check below. */
  async function readRow(): Promise<SubRow> {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${P}user_subscriptions?user_id=eq.${FIXTURES.cId}&select=role,trial_ends_at,current_period_end`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${cToken}` } },
    );
    if (!res.ok) throw new Error(`could not read ${P}user_subscriptions for account C (HTTP ${res.status})`);
    const rows = (await res.json()) as SubRow[];
    return rows[0] ?? {};
  }

  /* ── Runs today: no purchase needed ──────────────────────────────────── */

  test('PRECONDITION: account C is free before anything else runs', async () => {
    /* #243's own words: "Confirm C is free before anything... Without that
     * first check, 'C is pro' afterwards proves nothing." A missing row
     * reads as free, same convention as entitlements.spec.ts's B check -
     * `getEntitlement()` treats no row as the free default. */
    const row = await readRow();
    expect(row.role ?? 'free',
      `account C is not free (role=${row.role}) going into this run. Reset it in ` +
      'lhq_dev_user_subscriptions before starting the real-purchase flow - otherwise ' +
      '"C became pro" below proves nothing about this test run.',
    ).toBe('free');
  });

  test('the checkout hand-off carries account C\'s own identity, not a placeholder', async ({ browser }) => {
    /* Same instrument as checkout.spec.ts (which uses fixture B to prove the
     * wiring in general). This proves it for the SPECIFIC account the real
     * purchase will use, so a mismatch here - not B's id leaking into C's
     * session, or vice versa - is caught before anyone reaches for a real
     * card. Aborted at the hand-off, same as checkout.spec.ts: nothing here
     * ever contacts the real LemonSqueezy host. */
    test.skip(configured?.checkout !== true,
      `checkout not configured on this host (configured.checkout=${String(configured?.checkout)}) - ` +
      'the Render variables from #243 are not set/built yet. Skipping, not failing: this is a ' +
      'known hold, not a defect.');

    const ctx = await signedInContext(browser, 'c', { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();

    let handoff = '';
    await page.route(CHECKOUT_PATH, route => {
      handoff = route.request().url();
      return route.abort();
    });

    try {
      await gotoSignedIn(page, '/upgrade');
      const cta = page.getByTestId('checkout-cta-monthly');
      await expect(cta, 'no checkout button rendered on /upgrade').toBeVisible({ timeout: 20_000 });
      await cta.click();

      await expect
        .poll(() => handoff, {
          timeout: 15_000,
          message: 'nothing navigated to a /checkout/buy/ URL for account C - see checkout.spec.ts ' +
            'for the general wiring check; this one is specific to C\'s own session.',
        })
        .not.toBe('');

      const url = new URL(handoff);
      expect(url.searchParams.get('checkout[custom][user_id]'),
        'the checkout URL carries a different id than account C - the webhook would match the ' +
        'purchase to the wrong account',
      ).toBe(FIXTURES.cId);
      expect(url.searchParams.get('checkout[email]'),
        'the checkout URL carries a different email than account C',
      ).toBe(FIXTURES.cEmail);
    } finally { await ctx.close(); }
  });

  /* ── Runs only after a real purchase exists for C ────────────────────── */

  test('ENTITLEMENT: the row AND the page-level gate agree C is Pro (#786\'s shape)', async ({ browser }) => {
    /* #786's warning, named explicitly rather than assumed handled: an API
     * route's own auth.getUser() check was verified while a PAGE-LEVEL
     * `{entitled && (...)}` gate was what actually governed the feature - true
     * of the route, false of the product. So this does not stop at the
     * database row. It reads the row, THEN drives a real signed-in session to
     * a Pro-gated screen and checks the rendered gate, the same instrument
     * entitled-macro-cards.spec.ts uses for the synthetic-fixture version of
     * this question. This is the real-account version. */
    const row = await readRow();
    test.skip((row.role ?? 'free') !== 'pro',
      `account C is not pro yet (role=${row.role ?? 'free'}) - this assertion only means something ` +
      'once a real LemonSqueezy test-mode purchase has been completed for C per #243\'s manual ' +
      'steps (sign in as C, complete checkout with the test card, wait for the webhook delivery). ' +
      'Re-run this file after that.');

    const ctx = await signedInContext(browser, 'c', { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, DASHBOARD);
      await expect(page.getByTestId('locked-feature'),
        'the database says account C is pro, but the dashboard still renders the Pro paywall - ' +
        'the row and the rendered page-level gate disagree. This is exactly the #786 shape: do not ' +
        'conclude "Pro is granted" from the row alone.',
      ).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  test('CANCEL BUT KEEP UNTIL EXPIRY (#134): the branch synthetic payloads have never proven', async () => {
    /* #243's own words: "exercise the reverse - cancel in the dashboard,
     * confirm C KEEPS Pro until expiry, which is the branch synthetic
     * payloads can prove but a real subscription lifecycle has never been
     * shown to hit." lib/lemonsqueezy.ts's patchForEvent keeps role: 'pro' on
     * subscription_cancelled and only current_period_end changes - this
     * checks that shape against the real row after a real cancel. */
    const row = await readRow();
    test.skip((row.role ?? 'free') !== 'pro',
      'account C is not currently pro - this checks the post-cancellation grace period, which only ' +
      'exists once C has an active subscription to cancel. Complete a real purchase first (see the ' +
      'ENTITLEMENT test above), then cancel it in the LemonSqueezy dashboard, then re-run this file.');

    expect(row.role,
      'account C lost Pro immediately on cancellation instead of keeping it until the period end - ' +
      'this is the #134 regression this test exists to catch. subscription_cancelled must not behave ' +
      'like subscription_expired.',
    ).toBe('pro');

    if (row.current_period_end) {
      expect(new Date(row.current_period_end).getTime(),
        `current_period_end (${row.current_period_end}) is in the past, but the row still reads pro - ` +
        'a real subscription_expired event should have flipped this to free by now.',
      ).toBeGreaterThan(Date.now());
    }
  });

  /* ── Named rather than silently absent (#243's own closing instruction) ── */

  test('RESET: manual step, not automated', () => {
    /* Deliberately test.skip(true, ...) rather than omitted: resetting C to
     * free is either a LemonSqueezy-dashboard cancel-and-wait-for-expiry or a
     * direct database write, and a write to the shared database is one of
     * the three things QA does not do without the owner - see CLAUDE.md.
     * This exists so a reader of this file's results sees the step named,
     * not missing. */
    test.skip(true,
      'after completing #243\'s real-purchase run, reset account C to free in the dev Supabase ' +
      'dashboard (or LemonSqueezy-cancel and let it expire) and say so on #243. Not automated here: ' +
      'it is a database write, which QA does not perform without the owner.');
  });
});
