import { test, expect } from '@playwright/test';
import { CONVERTED_ROUTES } from './_design-tokens';

/* THE PAYWALL MUST SURVIVE THE REDESIGN.
 *
 * Dev shipped `/arena?design=terminal` for one commit with the Confluence score
 * wired unguarded — free users would have seen the full score and every factor.
 * They caught it re-reading their own commit message, and reported it rather
 * than patching it quietly.
 *
 * WHY NOTHING CAUGHT IT. The entitlement check lives at the CALL SITE, not
 * inside the component:
 *
 *     app/arena/page.tsx:2112
 *     {authLoading || entitled ? <ConfluenceScore … /> : <LockedFeatureCard … />}
 *
 * So moving a panel into the new design moves its markup and leaves its guard
 * behind. `tsc`, `eslint`, `build` and all 442 tests passed — the props are
 * unchanged, the call is valid, and not one test asserts entitlement at a call
 * site.
 *
 * MY CENSUS CANNOT SEE THIS, and that is the point of a second spec rather than
 * an extra assertion in the first. `no-lost-components.spec.ts` compares sets
 * for what went MISSING; this bug ADDS a panel, so the census passed with
 * `94 buttons` on both sides while the leak was live. The two are the same class
 * of defect from opposite directions: one catches UI that vanished, this catches
 * UI that appeared for people who have not paid for it.
 *
 * A redesign is precisely the operation that separates a component from its
 * guard, and ~20 screens are still to move.
 */

/* THE BASELINE IS THE LEGACY DESIGN IN THIS SAME BUILD, NOT PRODUCTION.
 *
 * My first version compared against `https://liquidity-hq.com`, and it could
 * never have passed. Production serves `main`, and `data-testid="locked-feature"`
 * landed on `dev` (#442) - so the marker is absent from prod by definition until
 * a release ships it. The control would have failed forever, for a reason that
 * has nothing to do with the paywall.
 *
 * That is the same error as every other entry in HANDOVER §14, arriving in my
 * own gate: an instrument pointed at something that cannot answer the question.
 *
 * The right baseline was available the whole time. **Both designs coexist in one
 * build** behind `?design=terminal`, so loading the route WITHOUT the flag gives
 * the legacy screen from the SAME code, with the same marker compiled in. That
 * comparison isolates exactly one variable - the redesign - which is the thing
 * being tested. Comparing against production would also have folded in every
 * unrelated change between `main` and `dev`. */

/** The locked-card marker. Dev is adding `data-testid="locked-feature"` to
 *  `LockedFeatureCard` — see #441.
 *
 *  IT HAS TO BE A TESTID, not the card's text. The labels are DB-driven
 *  (`lib/labelKeys.ts:209` — `UPGRADE_GATE_PRO_FEATURE_LABEL` is a KEY, resolved
 *  at runtime through `useLabels()`), so matching on the rendered string binds
 *  this spec to whatever the labels table says today and to one locale. Matching
 *  on the inline gradient instead would bind it to `UpgradeGateModal`'s styling,
 *  which the redesign is about to change — the spec would break on the very
 *  commit it exists to check. */
const LOCKED = '[data-testid="locked-feature"]';

/** Count locked cards on a signed-out load. */
async function lockedCount(page: import('@playwright/test').Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('lhq_analytics_consent_v1', 'denied'));
  await page.waitForTimeout(2500);   // entitlement resolves async; `authLoading` renders the Pro branch
  return page.locator(LOCKED).count();
}

test.describe('the paywall survives the redesign', () => {
  test.use({ storageState: { cookies: [], origins: [] } });   // SIGNED OUT is the whole point

  /* THE CONTROL, AND IT IS NOT OPTIONAL.
   *
   * Every assertion below compares a count against the legacy design. If the marker is
   * missing from both sides — because dev has not landed it yet, or because it
   * got renamed — then `0 === 0` and every route passes while measuring nothing.
   *
   * That is the exact failure this suite keeps re-learning: an instrument that
   * returns a clean result may be pointed at nothing at all. So this asserts the
   * instrument works BEFORE the comparisons are allowed to mean anything, and it
   * FAILS rather than skips: a skip reads as caution and means "measured
   * nothing", which is indistinguishable from the bug. */
  test('CONTROL: the legacy design shows locked cards to a signed-out visitor', async ({ page }) => {
    test.setTimeout(90_000);
    const n = await lockedCount(page, '/arena');   // no flag = legacy design
    expect(n,
      'no [data-testid="locked-feature"] on the LEGACY /arena signed out. Either the ' +
      'marker was renamed, or entitlement resolved as entitled — every comparison ' +
      'below would be 0 vs 0 and would pass without measuring anything.',
    ).toBeGreaterThan(0);
  });

  /* WHAT THIS SPEC HAS NOT YET PROVEN, STATED BEFORE ANYONE TRUSTS IT.
   *
   * The control passes: the legacy design does show locked cards signed out, so
   * the marker resolves and the instrument is pointed at something real.
   *
   * **But it has never caught a leak, because it has not yet had one to catch.**
   * On `dev` today no converted screen renders a DIFFERENT tree under
   * `?design=terminal` - the terminal Arena is parked in #438 - so both sides of
   * the comparison are the same markup and `local >= legacy` is satisfied by
   * construction. A green run here currently means "nothing differs", not "the
   * paywall survived".
   *
   * I tried to prove it against the real defect: dev's `949b97f` shipped the
   * confluence rail with one guard where `9c545e6` has two. Swapping that page
   * into the current tree does not compile - it expects a tree that has moved -
   * and rebuilding the historical tree would also mean patching in a
   * `data-testid` that commit never had, which is a control against a build that
   * never existed.
   *
   * So: **the negative control is owed, not skipped.** The moment a converted
   * screen renders its own terminal tree, remove one `entitled ?` guard from it
   * locally and confirm this goes red. Until then this file is wiring, and
   * saying so is cheaper than someone reading three green ticks as coverage.
   *
   * Recorded because "a test that has never failed has never been tested" is the
   * rule this suite keeps relearning, and it applies to my own gate. */
  for (const route of CONVERTED_ROUTES) {
    test(`${route} locks at least as much as the legacy design does`, async ({ page }) => {
      test.setTimeout(120_000);

      const legacy = await lockedCount(page, route);          // baseline: no flag

      const local = await lockedCount(page, `${route}?design=terminal`);
      /* AWAITED. `expect(promiseReturningFn(page)).toBeTruthy()` asserts that a
       * Promise object is truthy, which it always is — the assertion passes
       * whatever the page does. Same family as every other entry in HANDOVER §14:
       * an instrument that returns a clean result while pointed at nothing. */
      expect(await inTerminalMode(page), 'the terminal design did not apply').toBe(true);

      /* GREATER-THAN-OR-EQUAL, not equality.
       *
       * Locking MORE than the legacy design is not a leak — it is a screen that has not
       * finished converting, or a panel dev deliberately gated tighter. Only a
       * DROP means a guard was left behind during the move. Asserting equality
       * would make this spec fail on changes that are not defects, and a spec
       * that cries wolf gets its failures explained away — which is how the
       * 24px/44px a11y bar sat mislabelled for weeks. */
      expect(local,
        `${route} shows ${local} locked cards signed out, the legacy design shows ${legacy}. ` +
        'A panel moved into the terminal design without its entitlement guard.',
      ).toBeGreaterThanOrEqual(legacy);
    });
  }
});

/* Asserted separately from the count so a failure says WHICH thing broke: a
 * count mismatch on a page that never entered terminal mode is a different
 * defect from one that did. */
function inTerminalMode(page: import('@playwright/test').Page) {
  return page.evaluate(() => document.documentElement.dataset.design === 'terminal');
}
