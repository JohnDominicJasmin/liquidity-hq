import { test, expect } from '@playwright/test';

/* TERMINAL SHIPS ON `/` ONLY (#719).
 *
 * This is the first design change any real visitor sees. Everything here is a
 * user-visible contract, not an implementation detail:
 *
 *   `/`            terminal, for someone with no query param and no storage
 *   every app route  current, unchanged
 *   both escape hatches still work
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

test.describe('#719 terminal on landing only', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/ renders terminal for a first-time visitor', async ({ page }) => {
    await page.goto('/');
    expect(await designAttr(page)).toBe('terminal');
  });

  test('app routes stay on the current design', async ({ page }) => {
    for (const route of APP_ROUTES) {
      await page.goto(route);
      expect(await designAttr(page), `${route} must not be terminal by default`).toBeNull();
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
    // QA reviews deployed builds through this path.
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

  test('the boundary: / to an app route swaps the design, and says so', async ({ page }) => {
    /* #719 asks what the user sees crossing from landing into the app. It is a
       real design change mid-session and there is no hiding it - the owner's
       decision IS that the two surfaces differ. What must not happen is a
       BROKEN intermediate state, so this asserts the attribute is correct on
       both sides of a client-side navigation rather than pretending the swap
       is invisible. */
    await page.goto('/');
    expect(await designAttr(page)).toBe('terminal');

    await page.goto('/dashboard');
    expect(await designAttr(page), 'crossing into the app must land on the current design').toBeNull();

    await page.goBack();
    expect(await designAttr(page), 'going back to / must return to terminal').toBe('terminal');
  });
});
