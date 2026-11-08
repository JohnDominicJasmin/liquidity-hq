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

/** The attribute the terminal stylesheet keys off, or null when absent.
 *
 * A LOCATOR READ, NOT page.evaluate. The `evaluate` version threw
 * `Execution context was destroyed, most likely because of a navigation`
 * and flaked :196 on mobile in run 42436245702 - several callers below read
 * this attribute immediately after crossing between `/` and an app route, and
 * `evaluate` resolves against one execution context, so a navigation still in
 * flight destroys it mid-call. A locator auto-waits and retries, so it rides
 * the navigation out instead of racing it. `getAttribute` returns null for a
 * missing attribute, which is the same contract the `toBeNull()` callers rely
 * on. */
async function designAttr(page: import('@playwright/test').Page): Promise<string | null> {
  return page.locator('html').getAttribute('data-design');
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

  /* THESE THREE CELLS USED TO ASSERT THAT `?design=current` WORKED, AND THEY WERE RED IN EVERY CI RUN
   * FOR WEEKS. The escape hatch was not broken - it was DELETED, deliberately, and the deletion is
   * owner-accepted. They were my stale expectation, not a product defect, and a standing red trains
   * everyone to skim the failure list.
   *
   * The expectation below is derived from the RULING, never from what the page currently happens to
   * do. `components/RootDocument.tsx:80-85` is the governing statement:
   *
   *     "data-design is a static attribute on <html> (#1111). It used to be resolved from ?design=
   *      and localStorage ... So it is gone, `?design=` no longer does anything, and a stale
   *      `lhq-design-mode` value in someone's storage is simply never read."
   *
   * Accepted per #1111 Pattern A / #1139's owner-relayed ruling. Confirmed structurally rather than
   * taken on faith: `lib/designMode.ts` and `components/DesignModeProvider.tsx` no longer exist, and
   * no non-comment line in `app/`, `components/` or `lib/` reads a `design` param or
   * `lhq-design-mode`. The source-level guard for all of that lives in
   * `__tests__/designParamInert.test.mts`; these cells are the runtime half.
   *
   * SO THE INVARIANT IS INERTNESS, and it is asserted for an ARBITRARY value, not just 'current'.
   * Pinning only 'current' would pass on a page that still honoured some other value. */

  test('?design= is inert on /: any value, across a reload, and a stale stored preference is never read', async ({ page }) => {
    await page.goto('/?design=current');
    expect(await designAttr(page), '?design=current changed the design - the param is supposed to have no reader at all').toBe('terminal');

    /* An arbitrary value. If the param were read again, 'current' might be special-cased while this
       one fell through to a default that happens to be terminal - so this is what distinguishes
       "no reader" from "a reader that currently agrees with us". */
    await page.goto('/?design=totally-made-up-value');
    expect(await designAttr(page), 'an unrecognised ?design= value was treated as meaningful').toBe('terminal');

    /* THE CELL THE RULING SPECIFICALLY PROMISES, and the one a reintroduced storage read would break
       while every other cell here stayed green. Someone who used the hatch before #1111 still has
       'current' in their storage; it must be ignored, not honoured. Seeded before any script runs. */
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq-design-mode', 'current'); } catch { /* private mode */ }
    });
    await page.goto('/');
    expect(await designAttr(page), 'a stale lhq-design-mode=current in storage was read and honoured').toBe('terminal');

    /* Still terminal after a reload, with that stale value present. */
    await page.reload();
    expect(await designAttr(page), 'the stale preference took effect on the second load').toBe('terminal');
  });

  test('?design= is inert on app routes too, and writes NOTHING to storage', async ({ page }) => {
    /* This cell used to assert the param persisted a preference, polling for
       localStorage['lhq-design-mode'] to become 'terminal'. Nothing writes that key any more -
       DesignModeProvider was its only writer and it is gone - so the poll could never pass. The
       assertion is now the inverse, and it is the stronger one: the param must leave no trace. */
    for (const route of ['/dashboard', '/arena']) {
      await page.goto(`${route}?design=current`);
      expect(await designAttr(page), `${route}?design=current changed the design`).toBe('terminal');
    }

    /* NOTHING WRITES THE KEY. Asserting the absence of a write is only meaningful because the cell
       above proves the page rendered at all - without that, "no storage written" is also what a blank
       page looks like. Read through a try/catch because storage throws in private mode, and treat a
       throw as "not written" rather than failing on the environment. */
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem('lhq-design-mode'); } catch { return null; }
    });
    expect(stored, 'something persisted a design preference - the param is supposed to have no reader and no writer').toBeNull();
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

  test('?design= stays inert across the landing/app boundary, in both directions', async ({ page }) => {
    /* The boundary is where a reintroduced reader would most plausibly differ, because `/` and the app
       routes are rendered by different layouts - so a param honoured in one shell and ignored in the
       other is a real shape this could take. Both directions, with the param on the FIRST hop only:
       the design must not change when the param is dropped from the URL either. */
    await page.goto('/?design=current');
    expect(await designAttr(page), 'the param changed the design on /').toBe('terminal');

    await page.goto('/dashboard');
    expect(await designAttr(page), 'crossing into the app after a ?design= visit changed the design').toBe('terminal');

    await page.goto('/arena?design=current');
    expect(await designAttr(page), 'the param changed the design on an app route').toBe('terminal');

    await page.goto('/');
    expect(await designAttr(page), 'returning to / after a ?design= visit changed the design').toBe('terminal');
  });
});
