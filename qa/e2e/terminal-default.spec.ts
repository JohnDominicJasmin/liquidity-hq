import { test, expect } from '@playwright/test';

/* TERMINAL IS THE DEFAULT, EVERYWHERE (#748).
 *
 * This is the first design change any real visitor sees. Everything here is a
 * user-visible contract, not an implementation detail:
 *
 *   `/`              terminal, for someone with no query param and no storage
 *   every app route  terminal, on the same terms
 *   both escape hatches still work
 *
 * THIS FILE USED TO ASSERT THE OPPOSITE, and the correction is recorded rather
 * than quietly swapped. It was written for #719, which shipped terminal on `/`
 * alone and left every app route on the current design. #748 reversed that on
 * the owner's instruction - "remove ?design terminal make terminal design
 * default" - and `lib/designMode.ts` now ends `return 'terminal'` with
 * `pathname` no longer an input to the resolver at all.
 *
 * The two tests that encoded #719's route split kept passing on `dev` for a day
 * and then failed on the release candidate's CI run, which is the wrong order:
 * the spec should have failed in the PR that changed the behaviour. It did not,
 * because the browser suite runs on exactly one automatic trigger - a PR into
 * `main`. That gap is real and is named in CI's own header comment; this file is
 * one of the things that fell into it. See #844.
 *
 * `data-design` is the thing under test rather than any rendered pixel: it is
 * what the whole terminal stylesheet keys off, it is set before first paint by
 * the `design-init` script in app/layout.tsx, and it is observable without
 * depending on live market data - which is what made an earlier spec in this
 * suite a coin flip (#723).
 *
 * Each test starts from a CLEARED storage state. The mode is sticky by design,
 * so a leaked preference from a previous test would silently make the next one
 * assert nothing.
 */

const APP_ROUTES = ['/dashboard', '/arena', '/liq', '/scanner'];

/** The attribute the terminal stylesheet keys off, or null when absent. */
async function designAttr(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-design'));
}

test.describe('#748 terminal is the default on every route', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/ renders terminal for a first-time visitor', async ({ page }) => {
    await page.goto('/');
    expect(await designAttr(page)).toBe('terminal');
  });

  test('app routes render terminal too, on the same terms', async ({ page }) => {
    /* The #719 version of this test asserted `.toBeNull()` here - that an app
       route must NOT be terminal. Inverted for #748 rather than deleted,
       because "every route agrees with `/`" is still a contract worth holding:
       a route that opts itself out of the default would strand a visitor in a
       design the rest of the app has left. */
    for (const route of APP_ROUTES) {
      await page.goto(route);
      expect(await designAttr(page), `${route} must be terminal by default`).toBe('terminal');
    }
  });

  test('?design=current on / is a working escape hatch, and survives a reload', async ({ page }) => {
    /* The reload half is the part that matters. The param writes a stored
       preference; if the route default outranked it, the hatch would undo
       itself on the next load and the visitor would be stuck on terminal. */
    await page.goto('/?design=current');
    expect(await designAttr(page)).toBeNull();

    /* Same asynchronous write as the stickiness test above - the preference is
       persisted in an effect, so the reload has to happen after it lands.
       On `/` this is more than a test detail: until that write completes the
       route default is still terminal, so a visitor who opts out and reloads
       instantly gets terminal back. Narrow, pre-existing (the write has always
       been in an effect), and now visible because `/` finally has a default
       that differs from the stored value. Recorded on the PR. */
    await expect
      .poll(() => page.evaluate(() => { try { return localStorage.getItem('lhq-design-mode'); } catch { return null; } }),
        { message: 'the opt-out was never persisted' })
      .toBe('current');

    await page.goto('/');
    expect(await designAttr(page), 'stored "current" must outrank the route default').toBeNull();
  });

  test('?design=terminal still works on app routes, and sticks', async ({ page }) => {
    /* QA reviews deployed builds through this path. After #748 the param names
       the default rather than changing anything, so the ATTRIBUTE half of this
       test would now pass with the param removed entirely. The half that still
       earns its keep is the persisted write below: `?design=terminal` must
       leave a stored 'terminal', because that is what pins a reviewer's session
       if the default is ever moved back. */
    await page.goto('/dashboard?design=terminal');
    expect(await designAttr(page)).toBe('terminal');

    /* WAIT FOR THE WRITE, do not assume it. The preference is persisted by
       DesignModeProvider's useEffect, so it lands after hydration - navigating
       immediately beats it. My first version of this test did exactly that and
       failed, and the failure looked like broken stickiness rather than a
       racing assertion. Probed it: stored was still null right after goto, and
       'terminal' a moment later.
       Worth knowing beyond this test - a visitor who clicks away from the
       param URL within a few hundred ms genuinely does not get the preference
       saved. Pre-existing and not introduced by #719, but real. */
    await expect
      .poll(() => page.evaluate(() => { try { return localStorage.getItem('lhq-design-mode'); } catch { return null; } }),
        { message: 'the design preference was never persisted' })
      .toBe('terminal');

    await page.goto('/arena');
    expect(await designAttr(page), 'the review path must stay sticky across navigation').toBe('terminal');
  });

  test('no flash: data-design is set before the first paint, not after hydration', async ({ page }) => {
    /* THE REGRESSION THIS FILE EXISTS FOR. DesignModeProvider sets the
       attribute in a useEffect, which runs after hydration. That was fine
       while terminal was opt-in - someone who typed the param tolerates one
       frame of the old palette. It is not fine now: every visitor to `/` would
       see the current design's light ground paint and then swap to terminal's
       near-black, on the first frame of the acquisition page.
     *
     * Reading the attribute during `document-start` proves the bootstrap
     * script ran before any content was painted. If the attribute is only set
     * by the React effect, this is null and the test fails. */
    let atDocumentStart: string | null | undefined;
    await page.addInitScript(() => {
      // Runs before the page's own scripts on every navigation.
      (window as unknown as { __designAtStart?: string | null }).__designAtStart = null;
      document.addEventListener('readystatechange', () => {
        const w = window as unknown as { __designAtStart?: string | null };
        if (document.readyState === 'interactive' && w.__designAtStart === null) {
          w.__designAtStart = document.documentElement.getAttribute('data-design');
        }
      });
    });

    await page.goto('/');
    atDocumentStart = await page.evaluate(
      () => (window as unknown as { __designAtStart?: string | null }).__designAtStart,
    );

    expect(
      atDocumentStart,
      'data-design was absent when the document became interactive - the attribute is being ' +
      'set by the React effect instead of the beforeInteractive script, so / will flash the ' +
      'current design before swapping to terminal',
    ).toBe('terminal');
  });

  test('#714: / shows landing\'s own nav and NOT the app nav', async ({ page }) => {
    /* `/` was rendering two stacked navs: LandingTerminal's own (Sign In,
       Get Started Free) and AppShell's `.tnav` (Overview, Arena, Scan, Flow,
       Book). The second is worse than redundant - every one of its five items
       is a GATED app route, so a logged-out visitor clicking any of them lands
       somewhere unusable, on the page meant to convert them.
     *
     * Latent until #719. `.tnav` only renders in terminal, and before terminal
     * became the default on `/` anyone seeing it had typed ?design=terminal and
     * was already a signed-in operator. Same shape as the duplicate ticker
     * #592 fixed, and fixed the same way - one line in the `body.landing`
     * hide block.
     *
     * Asserts the app nav is not VISIBLE rather than not present: the fix is a
     * `display: none`, so the element still exists in the tree. */
    await page.goto('/');

    /* WAIT FOR THE PAGE TO LEAVE ITS LOADING BRANCH FIRST. LandingContent
       returns `lp-loading` while the Supabase session resolves, so asserting
       straight after goto() measures a page that has not rendered its nav yet.
       My first two versions of this test did exactly that and failed on both
       halves in turn - the second failure ("no sign-in link") was the test
       being early, not the fix being wrong. Anchoring on landing's own sign-in
       link is the signal that the real content has arrived. */
    await page.locator('a[href^="/login"]').first().waitFor({ state: 'attached', timeout: 20_000 });

    const appNavVisible = await page.evaluate(() => {
      const el = document.querySelector('.tnav');
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0;
    });
    expect(appNavVisible, 'the terminal APP nav is rendering on the landing page - its five items are gated routes a logged-out visitor cannot use').toBe(false);

    /* And landing's own nav is still there - the fix must not have hidden the
       one a visitor actually needs. Matched on the routes rather than the copy,
       since the labels are dictionary-driven. */
    const landingNavHrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .map(a => a.getAttribute('href') ?? '')
        .filter(h => h.startsWith('/login') || h.startsWith('/signup')));
    expect(landingNavHrefs.length, 'landing has no sign-in or sign-up link left').toBeGreaterThan(0);
  });

  test('the boundary: / to an app route no longer swaps the design', async ({ page }) => {
    /* THERE IS NO LONGER A BOUNDARY, AND THAT IS THE ASSERTION.
     *
     * Under #719 this test read the other way: crossing from `/` into an app
     * route was a real design change mid-session, the owner's decision WAS that
     * the two surfaces differ, and the test existed to prove the swap was clean
     * rather than to pretend it was invisible.
     *
     * #748 removed the split, so the swap is the defect now. Kept as a test
     * rather than deleted because the crossing is exactly where a per-route
     * default would reappear if someone reintroduced one, and it would reappear
     * silently - both sides render, both look deliberate, and only a visitor
     * moving between them sees the flip. */
    await page.goto('/');
    expect(await designAttr(page)).toBe('terminal');

    await page.goto('/dashboard');
    expect(await designAttr(page), 'crossing into the app must stay on terminal - #748 retired the route split').toBe('terminal');

    await page.goBack();
    expect(await designAttr(page), 'going back to / must still be terminal').toBe('terminal');
  });

  test('the opt-out crosses the boundary too', async ({ page }) => {
    /* The half that matters more than the default. A visitor who opts out on
       `/` must stay opted out when they reach the app - otherwise the escape
       hatch is only an escape from the landing page, and the first app route
       silently puts them back. Not covered before #748, because before #748 an
       app route was current-design regardless and this would have passed
       vacuously. */
    await page.goto('/?design=current');
    expect(await designAttr(page)).toBeNull();

    await expect
      .poll(() => page.evaluate(() => { try { return localStorage.getItem('lhq-design-mode'); } catch { return null; } }),
        { message: 'the opt-out was never persisted' })
      .toBe('current');

    await page.goto('/dashboard');
    expect(await designAttr(page), 'the opt-out must survive crossing into the app').toBeNull();
  });
});
