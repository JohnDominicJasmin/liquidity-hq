/* #1881's render gate: the Draw Structure label values, under an ENTITLED session.
 *
 * WHY A SPEC AND NOT A ONE-OFF. It has to run twice against the same URL - once before #1881 is on
 * `dev` and once after - and the two halves are only comparable if the probe is byte-identical. A
 * script re-typed between runs is not a control.
 *
 * WHAT DEV TEAM COULD NOT DO, AND WHY. `components/KLineProChart.tsx:2936` gates the control on
 * `drawStructureAvailable(tf) && entitlementStatus !== 'not_entitled'`, and
 * `components/AuthProvider.tsx:73` gives a signed-out visitor `'not_entitled'`. So every one of
 * these strings is unreachable from an anonymous render - correct behaviour, not a failure.
 *
 * THE CONFOUND THIS IS BUILT AROUND. "The button is absent" has two explanations: the code is not
 * deployed, or my session is not entitled. Those are indistinguishable from the absence alone, and
 * reporting the first while the second was true is the mistake I have made before. So the ENTITLED
 * ASSERTIONS COME FIRST and they are hard failures: if the plan badge does not read PRO, this spec
 * fails rather than reporting anything about Draw Structure. Only once the session is proven
 * entitled does the presence or absence of the button carry information.
 *
 * DEV TEAM SAID A `dev` CONTROL WAS NOT AVAILABLE FOR THESE because the strings do not exist there
 * at all. That is exactly what makes the pair work: the SAME probe, the SAME credentials, run on
 * `dev` before and after #1881 lands. Absent-then-present over one changed variable is a stronger
 * statement than "present on the branch", which is all a single run could say.
 *
 * ONLY USER_A WORKS. Measured, not assumed: USER_A is `role: pro` in `lhq_dev_user_subscriptions`,
 * USER_B and ADMIN are both `free` and would fail the gate for a reason that has nothing to do with
 * the deployed code.
 */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/** The timeframes that show the control at all - `lib/drawStructure.ts:146`. */
const DRAW_TFS = ['4h', '1d'] as const;

/** The three Dev Team named. Pinned as values, because a label VALUE change is what the gate is on. */
const EXPECT_STRINGS = [
  'Draw Structure',
  'Proposed lines',
  'Keep the ones you agree with. A line you keep becomes your own drawing.',
] as const;

const BADGE = '.plan-badge:visible, .plan-badge-free-text:visible';

test.describe('#1881 Draw Structure label values, entitled render', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('an entitled session on a supported timeframe: report which strings render', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    try {
      await gotoSignedIn(page, '/arena');

      /* ── 1. THE SESSION IS REAL. Hard failures, before anything is claimed about the feature. ── */
      await expect(page.locator(BADGE).first(),
        'no plan badge rendered, so this run cannot tell an unentitled session from missing code - everything below would be uninterpretable',
      ).toBeVisible({ timeout: 30_000 });

      const badgeText = ((await page.locator(BADGE).first().textContent()) ?? '').trim();
      expect(badgeText.toUpperCase(),
        `the plan badge reads ${JSON.stringify(badgeText)} rather than PRO. USER_A is role=pro in lhq_dev_user_subscriptions, so this is a session or entitlement problem on THIS run - the Draw Structure result below would be explained by it and must not be reported`,
      ).toContain('PRO');

      /* ── 2. The chart has to actually be up, or the control's absence says nothing. ── */
      /* WAIT, DO NOT COUNT IMMEDIATELY. The dev service is on the free plan and sleeps when idle, so the
         first load after a gap is slow, and klinecharts mounts its canvas after hydration. Counting
         at once read 0 and the guard below correctly refused to report anything about the feature -
         which is the guard working, but the fix belongs here rather than in a shorter assertion. */
      await page.waitForSelector('canvas', { timeout: 90_000 }).catch(() => { /* reported by the count below */ });
      const canvases = await page.locator('canvas').count();
      expect(canvases,
        'no canvas on /arena, so the chart never mounted and KLineProChart never ran - an absent Draw Structure button here is about the page not loading',
      ).toBeGreaterThan(0);

      /* ── 3. Now the feature, on each supported timeframe. ── */
      const report: Record<string, Record<string, boolean>> = {};
      for (const tf of DRAW_TFS) {
        const tfButton = page.getByRole('button', { name: new RegExp(`^${tf}$`, 'i') }).first();
        if (await tfButton.count()) {
          await tfButton.click();
          await page.waitForTimeout(2500);
        }

        const seen: Record<string, boolean> = {};
        for (const s of EXPECT_STRINGS) {
          seen[s] = (await page.getByText(s, { exact: false }).count()) > 0;
        }
        report[tf] = seen;
        console.log(`      tf=${tf}  ` + EXPECT_STRINGS.map((s) => `${seen[s] ? 'YES' : 'no '} ${s.slice(0, 44)}`).join('\n              '));
      }

      /* REPORTED, NOT ASSERTED, AND THAT IS DELIBERATE. This same spec runs on a `dev` that does
         not carry #1881, where every answer is correctly `no` - so an assertion either way would be
         wrong on one of the two trees, which is the ARRIVING_WITH bind in a place where it buys
         nothing. The pair of reports is the evidence; the entitled assertions above are what make
         each report mean something. */
      const anyTf = DRAW_TFS.some((tf) => EXPECT_STRINGS.every((s) => report[tf][s]));
      console.log(`      ALL THREE STRINGS RENDER ON A SUPPORTED TIMEFRAME: ${anyTf ? 'YES' : 'NO'}`);
      console.log(`      (session proven entitled: plan badge read ${JSON.stringify(badgeText)}, ${canvases} canvas(es))`);
    } finally {
      await ctx.close();
    }
  });
});
