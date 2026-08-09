import { test, expect } from '@playwright/test';

/* WCAG 2.2 SC 3.1.1 "Language of Page" is Level A - the lowest bar there is -
 * and this app failed it on every page until 2026-08-08.
 *
 * WHAT WAS WRONG. Four locales shipped. `/ar` served Arabic prose inside
 * `<html lang="en">` with no `dir` at all, so a screen reader pronounced Arabic
 * with English phonetics and the layout never mirrored. Issue #138.
 *
 * WHAT SHIPPED (#147) is deliberately NOT an RTL implementation. The offer was
 * withdrawn instead: `ar` is out of `SUPPORTED_LOCALES` and out of the picker,
 * the dictionary is kept, and `lang`/`dir` are now set from the route. Option B
 * of two, chosen by the owner - shipping a mirrored layout was the other, and it
 * was not worth blocking a release nobody could otherwise sign off.
 *
 * WHY A BROWSER TEST AND NOT ONLY A UNIT TEST. `__tests__/localeOffering.test.mts`
 * already asserts the offering lists. It cannot observe the thing that actually
 * failed: what `document.documentElement.lang` reads in a running page. That is
 * set client-side by `components/HtmlLangSync.tsx`, so only a browser sees it.
 *
 * READ THIS BEFORE FILING A BUG ABOUT THE SERVED HTML. `view-source:/ko` shows
 * `lang="en"`, and that is EXPECTED. `app/layout.tsx` is the root layout and is
 * not locale-aware; the sync happens on hydration. A screen reader reads the
 * live DOM, so the criterion is met - but anyone diffing raw HTML will see the
 * old value and think nothing changed. Dev called this out on the promotion and
 * asked that it not come back as a bug report. It is asserted below as a
 * KNOWN state rather than left undocumented, so if it ever changes, this test
 * says so rather than silently passing.
 */

/** The locales the picker is allowed to offer. `ar` must not appear. */
const OFFERED = ['English', '한국어', '中文'];

test.describe('i18n: locale offering and page language', () => {
  // HTML/DOM level - the mobile project would assert the identical strings.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'DOM-level, viewport irrelevant');
  });

  /* THE DEFECT THAT STARTED #138, asserted directly: /ar must not serve Arabic
   * prose any more. A route that silently keeps serving the WRONG language is
   * the failure one layer down from the one that was reported.
   *
   * This originally asserted `404` - dev's own promotion step said "/ar returns
   * 404, not an English page". It does not, and finding out why turned into
   * issue #157: `/definitely-not-a-route` answers 200 on PRODUCTION today, so
   * nothing on this site 404s and it has nothing to do with locales.
   *
   * So the assertion is split. What #147 actually promised is checked strictly
   * here; the status code is recorded in the KNOWN test below rather than
   * failing every release for a pre-existing app-wide defect. */
  test('/ar no longer serves Arabic - it renders the not-found page', async ({ page }) => {
    /* Anchored on STRUCTURE, not copy. `app/not-found.tsx` renders its text
     * through `useLabels()` / `t('NOT_FOUND_TITLE')`, so the words arrive after
     * a client fetch and are absent from the server HTML. An earlier draft of
     * this test grepped for "not found" and failed for that reason - the page
     * was correct and the assertion was measuring the wrong layer.
     *
     * The landing page carries the language picker; the not-found page does
     * not. That difference is structural, present at the same moment for both,
     * and does not move when someone rewrites the 404 copy. */
    await page.goto('/ko', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('button.lp-lang-btn'),
      'the POSITIVE CONTROL failed: /ko is a supported locale and must render the landing page. ' +
      'Without this, "the picker is absent on /ar" would also be satisfied by a blank page.',
    ).toBeVisible({ timeout: 20_000 });

    await page.goto('/ar', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('button.lp-lang-btn'),
      '/ar rendered the LANDING page. It is serving some other language under an Arabic URL, ' +
      'which is worse than the original bug - a user who picked Arabic gets English silently.',
    ).toHaveCount(0);

    const arabic = await page.evaluate(() => /[؀-ۿ]/.test(document.body.innerText));
    expect(arabic,
      '/ar is rendering Arabic script again. The dictionary stays in ' +
      'lib/i18n/dictionaries.ts on purpose, but `ar` must stay out of SUPPORTED_LOCALES ' +
      'until the layout actually mirrors - issue #138.',
    ).toBe(false);
  });

  /* KNOWN FAILURE, tracked as #157. Recorded rather than skipped: a skip is
   * invisible in a passing run, and this is a live production defect.
   *
   * When #157 is fixed this test FAILS, and that failure is the signal to move
   * the assertion into seo.spec.ts as a strict "a bad URL must not answer 200"
   * check across all routes - which is where it belonged in the first place. */
  test('KNOWN (#157): /ar answers 200, because nothing on this site 404s', async ({ request }) => {
    const ar = await request.get('/ar');
    const junk = await request.get('/definitely-not-a-route');

    expect(junk.status(),
      'A nonexistent route now answers something other than 200 - #157 may be fixed. ' +
      'If so, delete this test and add the check to seo.spec.ts for every route.',
    ).toBe(200);
    expect(ar.status(), '/ar diverged from the app-wide behaviour - re-measure before assuming').toBe(200);
  });

  for (const [path, expected] of [['/', 'en'], ['/ko', 'ko'], ['/zh', 'zh']] as const) {
    test(`${path} sets documentElement.lang to "${expected}"`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res!.status(), `${path} did not load`).toBeLessThan(400);

      /* HtmlLangSync runs on hydration, so the attribute is not correct at
       * domcontentloaded. Poll rather than sleep - a fixed wait either flakes or
       * wastes time, and this is the assertion the whole issue turns on. */
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 })
        .toBe(expected);

      /* `dirForLocale` still knows about ar/he/fa/ur, so this is not "dir is
       * always ltr" - it is "every locale we currently OFFER is ltr". If a
       * genuine RTL locale is ever restored, this line is what fails and points
       * at the mirroring work. */
      const dir = await page.evaluate(() => document.documentElement.dir || 'ltr');
      expect(dir, `${path} should be left-to-right while no RTL locale is offered`).toBe('ltr');
    });
  }

  test('the language picker offers exactly English, Korean and Chinese', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const btn = page.locator('button.lp-lang-btn');
    /* Positive control. Every assertion below is about what is ABSENT, and an
     * unrendered picker looks identical to a picker with no Arabic in it. */
    await expect(btn, 'the language picker did not render - nothing below would be meaningful').toBeVisible({ timeout: 20_000 });

    await btn.click();
    const labels = (await page.locator('button.lp-lang-btn ~ div a').allInnerTexts())
      .map(s => s.trim()).filter(Boolean);

    expect(labels.length, 'the picker menu did not open, so its contents were never read').toBeGreaterThan(0);
    expect(labels.sort(), `picker offered: ${labels.join(', ')}`).toEqual([...OFFERED].sort());
    expect(labels.join(' '),
      'العربية is back in the picker. Putting it back needs a mirrored layout, ' +
      'not just the dictionary - see lib/i18n/dictionaries.ts and issue #138.',
    ).not.toContain('العربية');
  });

  /* Documented, not aspirational. See the header: the ROOT layout is not
   * locale-aware, so the first byte says `en` on every route and hydration
   * corrects it. Asserted so that a change here is announced rather than
   * discovered by someone reading view-source and filing a duplicate of #138. */
  test('KNOWN: the server-rendered HTML still says lang="en" on /ko', async ({ request }) => {
    const html = await (await request.get('/ko')).text();
    const m = /<html[^>]*\slang="([^"]*)"/.exec(html);
    expect(m, '/ko served no lang attribute at all - that is a real regression').toBeTruthy();
    expect(m![1],
      'The served lang is no longer "en". If it is now "ko", app/layout.tsx has been made ' +
      'locale-aware and this test should be inverted to assert that - it is a genuine ' +
      'improvement, because it would remove the hydration gap where the page is briefly ' +
      'the wrong language for assistive technology.',
    ).toBe('en');
  });
});
