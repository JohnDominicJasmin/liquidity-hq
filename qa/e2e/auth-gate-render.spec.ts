import { test, expect } from '@playwright/test';
import { FIXTURES, AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* #1742 / #1740: THE AUTH GATES - DOES THE COPY REACH A CRAWLER, AND CAN A SUBSCRIBER REACH A BUY BUTTON?
 *
 * #1742 removed two `if (loading)` branches that returned a full-page spinner FROM THE SERVER, so neither `/`
 * nor `/upgrade` sent content to a client that does not run JavaScript. Production before the change: `/` 47
 * words and 0 h1, `/upgrade` 64 words and 0 h1, against `/learn`'s 1,548 and 1.
 *
 * ── WHY THIS SPEC EXISTS RATHER THAN A SCREENSHOT PASS ─────────────────────────────────────────────────────
 *
 * The behaviour that matters is a FLASH, and an end-state assertion cannot see it. `/upgrade` used to show a
 * Pro account checkout buttons while the subscription read was outstanding (#1309 item 12, whose own comment
 * says "fix before they open" - and Whop is what opens next). #1742 keeps that closed by disabling the reveal
 * until `purchaseReady`. An assertion that runs AFTER the entitlement read settles would pass on code that
 * flashed an enabled buy button for 400ms, which is precisely the defect.
 *
 * SO THE PRO CELL SAMPLES ON A TIMER FROM NAVIGATION, NOT AFTER A `waitFor`. It deliberately does NOT use
 * `gotoSignedIn`, which waits 4s and then waits out the onboarding loader - by which time the window being
 * measured has closed on its own and every sample reads the settled state.
 *
 * ── THE PRO INVARIANT IS BINARY, WHICH IS WHY IT IS THE ONE ASSERTED ───────────────────────────────────────
 *
 * `entitlementsLoading` is internal, so a spec cannot assert "disabled WHILE loading" without reaching into
 * React state. It does not need to: for a Pro account the correct behaviour is that a buy button NEVER enters
 * the DOM at any point - the reveal is disabled until `purchaseReady`, and once the read settles `isPro`
 * replaces the page with the redirect. So the invariant is "no billing choices in any sample, ever", which is
 * observable, has no timing assumption of its own, and fails on exactly the defect.
 *
 * Verified in source on the branch before this was written, which is what makes the invariant safe to assert:
 * `setPlansOpen(true)` has ONE call site (the reveal button), both buy-button clusters sit behind
 * `plansOpen && <>`, `choosePlan` is reachable only from those buttons, `whopUrl` requires a selected plan,
 * and no URL parameter selects one. One door, and it is the gated one.
 *
 * usage: E2E_BASE_URL=https://liquidity-hq-qa.onrender.com npx playwright test auth-gate-render --project=desktop
 *        (desktop only - the cells set their own viewports) */

const REVEAL = 'button[aria-controls="billing-choices"]';
const BILLING = '#billing-choices';

/* The Pro cell samples every 40ms for 6s. 40ms because the thing being caught is a frame, and 6s because the
   entitlement read plus the redirect comfortably fits inside it on the qa database - the sampler stops early
   once the page has clearly left the undecided state, so a fast settle does not cost six seconds. */
const SAMPLE_MS = 40;
const SAMPLE_WINDOW_MS = 6000;

interface Shot { t: number; reveal: 'absent' | 'disabled' | 'enabled'; billing: boolean; buyButtons: number; url: string }

async function sampleUntilSettled(page: import('@playwright/test').Page): Promise<Shot[]> {
  const shots: Shot[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SAMPLE_WINDOW_MS) {
    let shot: Shot;
    try {
      shot = await page.evaluate(([revealSel, billingSel]) => {
        const r = document.querySelector(revealSel) as HTMLButtonElement | null;
        const billing = document.querySelector(billingSel);
        return {
          t: 0,
          reveal: !r ? 'absent' as const : r.disabled ? 'disabled' as const : 'enabled' as const,
          billing: !!billing,
          /* Any element inside the billing choices that would start a payment. Counted rather than asserted
             present/absent, so a partial render shows up as a number instead of a boolean. */
          buyButtons: billing ? billing.querySelectorAll('button, a[href]').length : 0,
          url: location.pathname,
        };
      }, [REVEAL, BILLING]);
    } catch {
      /* A navigation mid-evaluate destroys the execution context. That is not a failure - it is the redirect
         this cell expects - so the sample is skipped rather than throwing. */
      await page.waitForTimeout(SAMPLE_MS);
      continue;
    }
    shots.push({ ...shot, t: Date.now() - t0 });
    /* Left the undecided state: either the redirect happened, or the page settled into a usable upgrade page. */
    if (shot.url !== '/upgrade' || shot.reveal === 'enabled') break;
    await page.waitForTimeout(SAMPLE_MS);
  }
  return shots;
}

/* ── STEP 5: THE ONE THAT MATTERS ─────────────────────────────────────────────────────────────────────────── */

test('#1742 step 5: a Pro account never has a buy button in the DOM on /upgrade, sampled from navigation', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await installPaidAiFence(page);
  try {
    /* THE ENTITLEMENT READ IS SLOWED ON PURPOSE, AND WITHOUT THIS THE CELL PROVES NOTHING.
     *
     * Measured on qa fb6419e before this was added: 70 samples over 5,966ms, billing present in 0, reveal
     * enabled in 0 - a clean pass, and a vacuous one. `reveal` read **absent** in all 70 samples, because for
     * a Pro account `isPro` replaces the whole page with the redirect, so the button never exists. The cell
     * was green whether the gate worked or whether the page had never rendered at all.
     *
     * The window that matters is `user` set AND `entitlementsLoading` true AND `isPro` not yet true, and on qa
     * it closed before the first sample at 166ms. `entitlementsLoading` is cleared by the `user_subscriptions`
     * read in components/AuthProvider.tsx, so delaying THAT request widens the window to something samplable.
     *
     * This slows the real read rather than faking a state - the page follows its own code path, just later.
     * Which is the requirement I put on #1737's control and failed to apply here: inject, do not observe. */
    const ENTITLEMENT_DELAY_MS = 2500;
    await page.route('**/rest/v1/*user_subscriptions*', async (route) => {
      await new Promise((r) => setTimeout(r, ENTITLEMENT_DELAY_MS));
      await route.continue();
    });

    /* `commit` rather than `load`: sampling must start as early as the document exists, because the defect
       lives in the first few hundred milliseconds. */
    await page.goto('/upgrade', { waitUntil: 'commit' });
    const shots = await sampleUntilSettled(page);

    expect(shots.length, 'no samples were taken - the sampler itself failed').toBeGreaterThan(3);

    /* THE CELL MUST PROVE IT SAW THE UNDECIDED STATE, or it fails as NOT EXERCISED rather than passing as NOT
       BREACHED. A reveal that is `absent` throughout means the page went straight to the redirect and the gate
       was never put to the question - which is exactly the pass this cell returned before the delay existed. */
    const sawGate = shots.filter((s) => s.reveal === 'disabled');
    expect(sawGate.length,
      `the undecided window was never observed: reveal was ${[...new Set(shots.map((s) => s.reveal))].join('/')} `
      + `across ${shots.length} samples, so this cell did not exercise the gate. Raise ENTITLEMENT_DELAY_MS, or `
      + 'check that the user_subscriptions route pattern still matches.')
      .toBeGreaterThan(0);

    const withBilling = shots.filter((s) => s.billing);
    const enabledOnUpgrade = shots.filter((s) => s.reveal === 'enabled' && s.url === '/upgrade');

    // eslint-disable-next-line no-console
    console.log(`PRO /upgrade: ${shots.length} samples over ${shots[shots.length - 1].t}ms | `
      + `billing present in ${withBilling.length} | reveal enabled in ${enabledOnUpgrade.length} | `
      + `first ${JSON.stringify(shots[0])} | last ${JSON.stringify(shots[shots.length - 1])}`);

    /* THE ASSERTION. Not "disabled while loading" - "never openable at all", which is what #1309 item 12 needs
       and what the source trace showed is achievable. */
    expect(withBilling.map((s) => `${s.t}ms: ${s.buyButtons} buttons`), 'a Pro account saw the billing choices')
      .toEqual([]);
  } finally {
    assertNoUnstubbedPaidAi(page, 'pro /upgrade');
    await ctx.close();
  }
});

/* ── STEPS 3 AND 4: THE CONTROLS MUST STILL BECOME USABLE ─────────────────────────────────────────────────── */

/* WITHOUT THIS, STEP 5 IS SATISFIED BY A PERMANENTLY BROKEN BUTTON. A reveal that is disabled for everybody
   forever passes the Pro invariant perfectly and takes the product's only purchase path with it. */
for (const [who, label] of [[null, 'signed out'], ['b', 'signed in, not Pro']] as const) {
  test(`#1742 steps 3-4: the reveal becomes enabled and opens the billing choices (${label})`, async ({ browser, page: plainPage }) => {
    test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
    test.skip(who === 'b' && (!FIXTURES.bEmail || !FIXTURES.bPassword), 'no credentials for the free account');

    let page = plainPage;
    let ctx: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    if (who) {
      ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } });
      page = await ctx.newPage();
    } else {
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await installPaidAiFence(page);

    try {
      await page.goto('/upgrade', { waitUntil: 'domcontentloaded' });

      const reveal = page.locator(REVEAL);
      await expect(reveal, 'the reveal button is not on the page').toHaveCount(1);
      /* It may start disabled - that is the gate working. It must not STAY disabled. */
      await expect(reveal, 'the reveal never became enabled, so nobody can buy anything').toBeEnabled({ timeout: 20_000 });

      /* The billing choices must not be in the server render or before the click - `plansOpen` starts false. */
      await expect(page.locator(BILLING), 'the billing choices were present before any click').toHaveCount(0);
      await reveal.click();
      await expect(page.locator(BILLING), 'the reveal did not open the billing choices').toHaveCount(1);
    } finally {
      assertNoUnstubbedPaidAi(page, `/upgrade ${label}`);
      await ctx?.close();
    }
  });
}

/* ── STEPS 1 AND 6: THE COPY REACHES A CLIENT THAT DOES NOT RUN JAVASCRIPT ────────────────────────────────── */

/* THIS IS THE WHOLE POINT OF #1742 AND IT IS THE CHEAPEST THING HERE TO GET WRONG. With JavaScript ENABLED a
   passing word count proves nothing - the page would hydrate and fill in regardless, which is exactly how the
   defect survived until an SEO audit. So the measurement runs with javaScriptEnabled: false, which is what a
   link-preview bot or an AI assistant's fetcher actually is. */
for (const path of ['/', '/upgrade'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1280, 390] as const) {
      test(`#1742 steps 1+6: ${path} serves real copy with JS disabled (${theme}, ${width}px)`, async ({ browser }) => {
        test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');

        const ctx = await browser.newContext({
          javaScriptEnabled: false,
          viewport: { width, height: width === 390 ? 844 : 900 },
          colorScheme: theme,
        });
        const page = await ctx.newPage();
        try {
          await page.goto(path, { waitUntil: 'domcontentloaded' });
          const m = await page.evaluate(() => {
            const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
            return {
              words: (text.match(/[A-Za-z]{2,}/g) || []).length,
              h1: document.querySelectorAll('h1').length,
              /* The spinner copy the old branch served. Label-backed, so matched on the loading CONTAINER as
                 well as the word - a non-English locale would not say "Loading". */
              spinner: !!document.querySelector('.lp-loading'),
              sample: text.slice(0, 120),
            };
          });

          // eslint-disable-next-line no-console
          console.log(`NOJS ${path} ${theme} ${width}px: ${m.words} words, ${m.h1} h1, spinner=${m.spinner} | ${m.sample}`);

          /* THE SPINNER CHECK ABOVE IS THE CERTAIN ONE; THIS THRESHOLD IS CALIBRATED AGAINST A MEASUREMENT.
             The before-figures are 48 words on `/` and 63 on `/upgrade` - measured on production 2026-10-24
             with a plain fetch, not recalled - and both were entirely shared chrome. 100 is comfortably above
             both and below any plausible figure for a page that actually serves its copy, so it fails on a
             regression to a spinner rather than on a copy edit.
             It is deliberately NOT set near the post-fix figure, because that figure has not been measured
             yet: the branch is not deployed anywhere. The log line above prints the real number on the first
             qa run, and the threshold can be tightened then with the figure in hand. A bound I invented and
             a bound I measured are different things and this comment is which one this is. */
          expect(m.words, `${path} served ${m.words} words to a JS-less client (before #1742: 48 on / and 63 on /upgrade)`)
            .toBeGreaterThan(100);
          expect(m.spinner, `${path} still served the full-page loading container to a JS-less client`).toBe(false);
        } finally {
          await ctx.close();
        }
      });
    }
  }
}

/* ── STEP 2: THE ACCEPTED FLASH, RECORDED RATHER THAN ASSERTED ────────────────────────────────────────────── */

/* The owner approved this cost on 2026-10-24: a returning signed-in visitor may see the marketing page for a
   beat before the redirect to /arena. So this cell does NOT fail on the flash - it MEASURES it, because "brief"
   is a product judgement and the owner's, not mine. What it does assert is that the page does not SETTLE on
   the marketing copy, which would be the redirect being broken rather than the flash being accepted. */
test('#1742 step 2: a signed-in visitor leaves / for /arena, and the marketing flash is measured not judged', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await installPaidAiFence(page);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const t0 = Date.now();
    let sawMarketing: number | null = null;
    let leftAt: number | null = null;
    while (Date.now() - t0 < 10_000) {
      let state: { path: string; marketing: boolean } | null = null;
      try {
        state = await page.evaluate(() => ({
          path: location.pathname,
          marketing: !document.querySelector('.lp-loading') && (document.body.innerText || '').length > 400,
        }));
      } catch { /* navigating */ }
      if (state) {
        if (state.path === '/' && state.marketing && sawMarketing === null) sawMarketing = Date.now() - t0;
        if (state.path !== '/') { leftAt = Date.now() - t0; break; }
      }
      await page.waitForTimeout(50);
    }
    // eslint-disable-next-line no-console
    console.log(`SIGNED-IN /: marketing copy first visible at ${sawMarketing ?? 'never'}ms, left / at ${leftAt ?? 'never'}ms`
      + ` -> flash duration ${sawMarketing !== null && leftAt !== null ? leftAt - sawMarketing : 'n/a'}ms`);

    expect(leftAt, 'a signed-in visitor stayed on / - the redirect to /arena did not happen').not.toBeNull();
  } finally {
    assertNoUnstubbedPaidAi(page, 'signed-in /');
    await ctx.close();
  }
});
