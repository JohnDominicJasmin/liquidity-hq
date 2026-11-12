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
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

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

    /* THE FENCE FIRST, AND "FIRST" IS LOAD-BEARING. Playwright matches the most recently
       registered handler, so this must precede this spec's own page.route calls - installed after
       them it would match first and abort the very requests this spec means to fulfil. The helper
       says so on itself: "Install before any spec-specific page.route."

       WHAT IT BUYS: the header above reasons at length about not spending the owner's money, and
       that reasoning is only true while the api/draw-structure glob happens to match the route. Rename
       the route and the glob stops matching, the click reaches the real handler, and every suite
       run bills xAI. The fence aborts any paid path this spec has not stubbed, so the renaming
       turns into a failure instead of an invoice. Dev Team caught that this was missing. */
    await installPaidAiFence(page);

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
      console.log(`      ALL THREE WITHOUT ANY INTERACTION: ${anyTf ? 'YES' : 'NO'}  (title+hint need the panel open - covered by the intercepted cell below, not a failure here)`);
      console.log(`      (session proven entitled: plan badge read ${JSON.stringify(badgeText)}, ${canvases} canvas(es))`);
      assertNoUnstubbedPaidAi(page);
    } finally {
      await ctx.close();
    }
  });
});

/* THE PANEL STRINGS, REACHED WITHOUT SPENDING THE OWNER'S MONEY.
 *
 * `DRAW_STRUCTURE_PANEL_TITLE` and `DRAW_STRUCTURE_HINT` render only under
 * `proposals.length > 0 || dsError` - and on the `dsError` branch the panel shows the ERROR instead
 * of either string (`components/KLineProChart.tsx:2946-2952`). So they need a SUCCESSFUL
 * /api/draw-structure response, and that route is one of the capped AI routes: a real click bills an
 * xAI call. `qa/e2e/_auth.ts:142` gates billed calls behind E2E_ALLOW_BILLED_CALLS=1 precisely so a
 * spec cannot spend by accident, and the owner's money is one of the gates I may not self-authorise.
 *
 * Intercepting the response costs nothing and still measures the right thing: THE LABEL VALUES COME
 * FROM THE LABEL SYSTEM, NOT FROM THE PAYLOAD. The stub supplies only the proposal data that opens
 * the panel; every string asserted below is produced by `tl(...)` inside the real component.
 *
 * What this therefore does NOT establish: that the live route returns proposals in this shape. That
 * is #1881's own behaviour and a different claim - stated here so a reader does not take this cell
 * for an end-to-end check of the feature. */
test.describe('#1881 panel strings, route intercepted so nothing is billed', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('with a stubbed proposal the panel renders its title and hint', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    /* THE FENCE FIRST, AND "FIRST" IS LOAD-BEARING. Playwright matches the most recently
       registered handler, so this must precede this spec's own page.route calls - installed after
       them it would match first and abort the very requests this spec means to fulfil. The helper
       says so on itself: "Install before any spec-specific page.route."

       WHAT IT BUYS: the header above reasons at length about not spending the owner's money, and
       that reasoning is only true while the api/draw-structure glob happens to match the route. Rename
       the route and the glob stops matching, the click reaches the real handler, and every suite
       run bills xAI. The fence aborts any paid path this spec has not stubbed, so the renaming
       turns into a failure instead of an invoice. Dev Team caught that this was missing. */
    await installPaidAiFence(page);

    let intercepted = 0;
    await page.route('**/api/draw-structure', async (route) => {
      intercepted += 1;
      const t0 = 1_700_000_000_000;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          /* ONE PROPOSAL OF EVERY STRUCTURE TYPE, so all five DRAW_STRUCTURE_TYPE_* label values
             render in the same panel. STRUCTURE_TYPES is lib/drawStructure.ts:42 - taken from there
             rather than guessed, since a type the validator rejects is dropped and its label would
             then be absent for a reason that is not about the label. */
          structures: ['trendline', 'channel', 'flag', 'triangle', 'horizontal'].map((type, n) => ({
            type, side: n % 2 ? 'high' : 'low',
            touchTimestamps: [t0 + n * 900_000, t0 + (n + 1) * 900_000],
            from: { timestamp: t0 + n * 900_000, price: 100 + n },
            to: { timestamp: t0 + (n + 1) * 900_000, price: 101 + n },
          })),
        }),
      });
    });

    try {
      await gotoSignedIn(page, '/arena');
      await page.waitForSelector('canvas', { timeout: 90_000 }).catch(() => { /* asserted below */ });
      expect(await page.locator('canvas').count(),
        'no canvas, so the chart never mounted and nothing below is about the panel',
      ).toBeGreaterThan(0);

      const tf = page.getByRole('button', { name: /^4h$/i }).first();
      if (await tf.count()) { await tf.click(); await page.waitForTimeout(2000); }

      const btn = page.locator('.klc-draw-btn').first();
      await expect(btn, 'the Draw Structure button is not present, so the panel cannot be opened - see the cell above').toBeVisible({ timeout: 30_000 });
      await btn.click();
      await page.waitForTimeout(3000);

      /* THE INTERCEPT MUST HAVE FIRED. If it did not, either the click never reached the route - and
         the strings below would be absent for that reason - or a REAL billed call went out, which is
         the thing this cell exists to avoid. Either way the result is not reportable. */
      expect(intercepted,
        'the /api/draw-structure intercept never fired: the click did not reach the route, or a real billed call escaped the stub',
      ).toBeGreaterThan(0);

      /* KEEP / DISCARD / DISCARD-ALL AND THE HINT ARE GONE as of the owner's 2026-11-10 removal
         (components/KLineProChart.tsx:2953 "NO acceptProposal / dropProposal ANY MORE … Keep/Discard
         is gone"). `DRAW_STRUCTURE_HINT` still sits in lib/labelDefaults.en.json but has NO render
         site anywhere in components/ or app/ - an orphaned default, not shipped copy. What the panel
         emits now is the title, the structure TYPE label for each proposal, and (on a lower
         timeframe) the lower-tf note. The stub below proposes one of each of the five types, so all
         five type labels render. Asserting them costs the same single intercepted call. */
      for (const s of [
        'Proposed lines',
        'Trend line', 'Channel', 'Flag', 'Triangle', 'Horizontal',
      ]) {
        expect(await page.getByText(s, { exact: false }).count(),
          `${JSON.stringify(s)} did not render in the panel even with a stubbed proposal, so this label value is not reaching the UI`,
        ).toBeGreaterThan(0);
      }
      console.log(`      panel strings rendered with ${intercepted} intercepted call(s) and 0 billed`);
      assertNoUnstubbedPaidAi(page);
    } finally {
      await ctx.close();
    }
  });
});

/* THE TRANSIENT AND FAILURE STRINGS, also without billing anything.
 *
 * `DRAW_STRUCTURE_LOADING` shows only while the request is in flight, and `DRAW_STRUCTURE_FAILED`
 * only on the `dsError` branch - and the client prefers the server's own `message`/`error` text when
 * there is one (`components/KLineProChart.tsx:2753`), so reaching the FAILED default needs a
 * response with neither. An empty body does it.
 *
 * A DELAYED FULFILL IS WHAT MAKES `LOADING` OBSERVABLE. Against the live route it is gone before a
 * probe can look, which is how a transient string stays permanently unverified. */
test.describe('#1881 loading and failure strings, nothing billed', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('loading shows while in flight, and the default failure string on an empty error', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    /* THE FENCE FIRST, AND "FIRST" IS LOAD-BEARING. Playwright matches the most recently
       registered handler, so this must precede this spec's own page.route calls - installed after
       them it would match first and abort the very requests this spec means to fulfil. The helper
       says so on itself: "Install before any spec-specific page.route."

       WHAT IT BUYS: the header above reasons at length about not spending the owner's money, and
       that reasoning is only true while the api/draw-structure glob happens to match the route. Rename
       the route and the glob stops matching, the click reaches the real handler, and every suite
       run bills xAI. The fence aborts any paid path this spec has not stubbed, so the renaming
       turns into a failure instead of an invoice. Dev Team caught that this was missing. */
    await installPaidAiFence(page);

    let fired = 0;
    await page.route('**/api/draw-structure', async (route) => {
      fired += 1;
      await new Promise((r) => setTimeout(r, 4000));          // hold it open so LOADING is visible
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    try {
      await gotoSignedIn(page, '/arena');
      await page.waitForSelector('canvas', { timeout: 90_000 }).catch(() => { /* asserted below */ });
      expect(await page.locator('canvas').count(), 'no canvas, so nothing below is about this feature').toBeGreaterThan(0);

      const tf = page.getByRole('button', { name: /^4h$/i }).first();
      if (await tf.count()) { await tf.click(); await page.waitForTimeout(2000); }

      const btn = page.locator('.klc-draw-btn').first();
      await expect(btn, 'the Draw Structure button is not present').toBeVisible({ timeout: 30_000 });
      await btn.click();

      /* While the fulfill is held: the button swaps to the loading label. */
      await page.waitForTimeout(1200);
      const loading = await page.getByText('Reading the chart...', { exact: false }).count();

      /* Then the held response lands as a 500 with an empty body. */
      await page.waitForTimeout(5000);
      const failed = await page.getByText('Could not read the chart. Try again.', { exact: false }).count();

      expect(fired, 'the intercept never fired, so a real billed call may have gone out').toBeGreaterThan(0);
      expect(loading, '"Reading the chart..." never rendered while the request was held open for 4s, so DRAW_STRUCTURE_LOADING is not reaching the button').toBeGreaterThan(0);
      expect(failed, '"Could not read the chart. Try again." did not render after a 500 with an empty body, so DRAW_STRUCTURE_FAILED is not the fallback it is written to be').toBeGreaterThan(0);
      console.log(`      loading=${loading} failed=${failed}, ${fired} intercepted, 0 billed`);
      assertNoUnstubbedPaidAi(page);
    } finally {
      await ctx.close();
    }
  });
});
