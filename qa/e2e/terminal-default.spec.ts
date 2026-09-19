import { test, expect } from '@playwright/test';

/* TERMINAL IS THE DEFAULT, EVERYWHERE (#748).
 *
 * This is the first design change any real visitor sees. Everything here is a
 * user-visible contract, not an implementation detail:
 *
 *   `/`              terminal, for someone with no query param and no storage
 *   every app route  terminal, on the same terms
 *   ?design= and a stored preference do nothing at all (the switch was deleted, #1111)
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
 * what the whole terminal stylesheet keys off, it is set before first paint (a static
 * attribute in app/layout.tsx since #1111; it used to be the `design-init` script), and it is observable without
 * depending on live market data - which is what made an earlier spec in this
 * suite a coin flip (#723).
 *
 * 2026-09-19, #1111: the `?design=current` switch itself was deleted. `data-design` is
 * now a STATIC attribute on <html> in app/layout.tsx, so it is in the server HTML rather
 * than set by a script, and `?design=`, `?design=terminal` and a stored `lhq-design-mode`
 * are all ignored. Three tests here asserted the switch (`?design=current` as a working
 * escape hatch, `?design=terminal` sticking, the opt-out crossing the boundary); they
 * were replaced by the two that pin what is true now: the attribute is in the raw server
 * HTML, and the old inputs change nothing and write nothing. The history above is kept
 * because the boundary and no-flash tests still guard what it describes.
 *
 * Each test starts from a CLEARED storage state, so a leaked value from a previous test
 * cannot make the next one assert nothing.
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

  test('the attribute is in the raw server HTML, not only set by script afterwards', async ({ request }) => {
    /* NEW WITH #1111. data-design used to be resolved from ?design= and localStorage by an
       inline script and by DesignModeProvider, so the served HTML never carried it. It is now
       a static attribute on <html>. `request` fetches the document WITHOUT running any of
       the page's JavaScript, so this is the one check that cannot be satisfied by a script
       that still sets it after load: if someone puts a script back, or moves the attribute
       into an effect, the raw HTML loses it and this fails while every browser-based check
       above still passes. */
    for (const route of ['/', '/about', '/arena', '/dashboard']) {
      const res = await request.get(route);
      expect(res.status(), `${route} answered ${res.status()}`).toBe(200);
      const html = await res.text();
      const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
      expect(htmlTag, `no <html> tag found in the raw response for ${route}`).not.toBe('');
      expect(htmlTag, `the raw <html> tag for ${route} carries no data-design="terminal": ${htmlTag}`).toMatch(/\sdata-design="terminal"/);
    }
  });

  test('?design=current, ?design=terminal and a stored lhq-design-mode=current change nothing and write nothing', async ({ browser }) => {
    /* #1111's own "How to test" item 1. The three inputs that used to select or persist a
       design are all ignored now. For each: the attribute is terminal, on `/` and on an app
       route, and localStorage is exactly as it started. A stale stored value is never read
       and, deliberately, never cleaned up - so it must still be there afterwards, which also
       proves nothing rewrote it. */
    const cases: Array<{ name: string; url: string; stored: string | null }> = [
      { name: '?design=current', url: '/?design=current', stored: null },
      { name: '?design=terminal', url: '/?design=terminal', stored: null },
      { name: 'stored current', url: '/', stored: 'current' },
      { name: 'stored current AND ?design=current', url: '/?design=current', stored: 'current' },
    ];
    for (const c of cases) {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        if (c.stored) await ctx.addInitScript((v) => { try { localStorage.setItem('lhq-design-mode', v); } catch { /* private mode */ } }, c.stored);
        const page = await ctx.newPage();
        await page.goto(c.url);
        expect(await designAttr(page), `${c.name}: / must be terminal`).toBe('terminal');
        // Time for any effect that used to persist a preference to have run.
        await page.waitForTimeout(1500);
        await page.goto('/dashboard');
        expect(await designAttr(page), `${c.name}: /dashboard must be terminal`).toBe('terminal');
        const stored = await page.evaluate(() => { try { return localStorage.getItem('lhq-design-mode'); } catch { return null; } });
        expect(stored, `${c.name}: localStorage['lhq-design-mode'] is ${JSON.stringify(stored)}, expected ${JSON.stringify(c.stored)} - the app wrote (or removed) a design preference that no longer exists`).toBe(c.stored);
      } finally {
        await ctx.close();
      }
    }
  });

  test('no flash: data-design is set before the first paint, not after hydration', async ({ page }) => {
    /* THE REGRESSION THIS FILE EXISTS FOR. DesignModeProvider sets the
       attribute in a useEffect, which runs after hydration. That was fine
       while terminal was opt-in - someone who typed the param tolerates one
       frame of the old palette. It is not fine now: every visitor to `/` would
       see the current design's light ground paint and then swap to terminal's
       near-black, on the first frame of the acquisition page.
     *
     * Reading the attribute during `document-start` proves the attribute
     * was already there before any content was painted. If the attribute is only set
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
      'being set late (by script or an effect) instead of being static in the server HTML, so / will flash the ' +
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
});
