import { test, expect } from '@playwright/test';
import { gotoGuarded, getGuarded } from './_shared';

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
    await gotoGuarded(page, '/ko', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('button.lp-lang-btn'),
      'the POSITIVE CONTROL failed: /ko is a supported locale and must render the landing page. ' +
      'Without this, "the picker is absent on /ar" would also be satisfied by a blank page.',
    ).toBeVisible({ timeout: 20_000 });

    await gotoGuarded(page, '/ar', { waitUntil: 'domcontentloaded' });
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

  /* THE KNOWN-FAILURE TEST THAT USED TO LIVE HERE HAS BEEN DELETED, AND THAT IS
   * THE POINT OF IT.
   *
   * It asserted `/ar` answers 200 "because nothing on this site 404s" (#157),
   * and it carried its own instruction: when #157 is fixed this test FAILS, and
   * that failure is the signal to move the check into seo.spec.ts across all
   * routes.
   *
   * #163 fixed it - `dynamicParams = false`, so an unmatched locale is refused
   * at ROUTING rather than after the response has started streaming. The test
   * failed on the next run, exactly as designed, and the strict check now lives
   * in `seo.spec.ts` where it applies to every route rather than to /ar alone.
   *
   * Worth keeping the note: a known failure recorded as a passing test that
   * inverts when fixed is the only form of "we know about this" that cannot rot.
   * A skip would have stayed silent forever. */
  test('/ar returns a real 404, not a 200 with a not-found page', async ({ request }) => {
    const res = await getGuarded(request, '/ar');
    expect(res.status(),
      '/ar must 404. It renders the not-found page either way, so a 200 here means ' +
      '`dynamicParams = false` was removed from app/[locale]/page.tsx and every unknown ' +
      'URL is a soft 404 again - see #157 and #163.',
    ).toBe(404);
  });

  for (const [path, expected] of [['/', 'en'], ['/ko', 'ko'], ['/zh', 'zh']] as const) {
    test(`${path} sets documentElement.lang to "${expected}"`, async ({ page }) => {
      const res = await gotoGuarded(page, path, { waitUntil: 'domcontentloaded' });
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

  /* THE ASSERTION NEITHER SIDE HAD, AND THE REASON #164 SURVIVED A 9/9 SIGN-OFF.
   *
   * Everything above pins `lang` on the three routes that carry a locale in the
   * URL - and those were the only routes ever checked. They were also the only
   * routes that already worked. A verification that visits only the surface a
   * fix touched will confirm any fix, which is what happened: 9 of 9 passed
   * against production while 30 of 32 routes served Korean copy under
   * `lang="en"`.
   *
   * The locale that actually decides the UI is the SELECTED one - stored in
   * `lhq_lang_v1` by lib/labels.ts, and on the server in
   * `user_settings.language`. `/upgrade` carries no locale segment, so it can
   * only be right if the attribute follows the selection rather than the path.
   *
   * `ru` is in here because AVAILABLE_LOCALES offers Russian in the app pickers
   * while the landing picker offers three - so Russian is reachable and had
   * never once been asserted. */
  for (const [stored, expected] of [['ko', 'ko'], ['zh', 'zh'], ['ru', 'ru']] as const) {
    test(`a selected locale "${stored}" sets lang on a route with no locale in its URL`, async ({ browser }) => {
      const ctx = await browser.newContext();
      await ctx.addInitScript((v: string) => {
        try { localStorage.setItem('lhq_lang_v1', v); } catch { /* private mode */ }
      }, stored);
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/upgrade', { waitUntil: 'domcontentloaded' });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 })
          .toBe(expected);
      } finally { await ctx.close(); }
    });
  }

  /* A WITHDRAWN LOCALE MUST RESOLVE, NOT PERSIST.
   *
   * Arabic is still in SUPPORTED_LOCALES on purpose - that list answers "is this
   * a code we recognise", and anyone who selected Arabic before it was withdrawn
   * still has `ar` in storage. It must resolve to English rather than fail.
   *
   * Measured 2026-08-09, and it took two attempts to get right: the first fix
   * fell back to English LABELS while `lang`/`dir` still followed the stored
   * value, so the page rendered English declared as Arabic in a right-to-left
   * layout - the same defect as #164 with the operands swapped. This asserts all
   * three agree, because agreeing is the actual requirement. */
  test('a withdrawn locale in storage resolves to English, in every signal', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_lang_v1', 'ar'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/upgrade', { waitUntil: 'domcontentloaded' });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 })
        .toBe('en');

      const state = await page.evaluate(() => ({
        dir: document.documentElement.dir || 'ltr',
        arabic: /[؀-ۿ]/.test(document.body.innerText),
        len: document.body.innerText.length,
      }));

      expect(state.len, 'the page did not render, so nothing below is meaningful').toBeGreaterThan(200);
      expect(state.dir, 'lang resolved to English but dir stayed rtl - the two disagree').toBe('ltr');
      expect(state.arabic,
        'lang says English and the page is rendering Arabic. That is #164 inverted: ' +
        'a screen reader would apply English pronunciation to Arabic text.',
      ).toBe(false);
    } finally { await ctx.close(); }
  });

  test('the language picker offers exactly English, Korean and Chinese', async ({ page }) => {
    await gotoGuarded(page, '/', { waitUntil: 'domcontentloaded' });

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
    const html = await (await getGuarded(request, '/ko')).text();
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
