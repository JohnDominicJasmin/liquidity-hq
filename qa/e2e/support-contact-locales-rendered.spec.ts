import { test, expect } from '@playwright/test';
import { gotoGuarded, servedLabels } from './_shared';
import { AVAILABLE_LOCALES } from '../../lib/locales';

/* #1360, the RENDERED half, in every locale. support-contact-address.spec.ts asserts
 * the label ROWS (via /api/labels) in all five locales but only renders English. A row
 * being right is not the same as the page showing it, and the failure this guards
 * already happened once: AUTH_GATE_BANNED_DESC existed in English only on production,
 * so four locales had been silently falling back to English while every English check
 * passed.
 *
 * For each of en/ar/ko/ru/zh this loads the page in that locale and asserts the text a
 * visitor SEES equals the label the app serves for that locale (database rows layered
 * over the shipped defaults, exactly as the client merges them) AND names the address:
 *   - the About page Contact card, and
 *   - the suspended-account message a banned, signed-out visitor sees.
 * A non-English locale that renders the English wording is caught as a mismatch with
 * what the API serves for it.
 *
 * WHICH LOCALES RENDER, AND THE MISTAKE THIS HEADER RECORDS. The first version of this
 * file assumed all five render. The first production run (2026-09-19, b96dcb3) failed
 * both `ar` tests with the page showing English, and that was MY error, not the app's:
 * Arabic is deliberately not offered (owner decision #138), and a stored `ar` preference
 * resolves to English (resolveOfferedLocale in lib/locales.ts, #165), so the page is
 * SUPPOSED to show English. The rows are still served and still right (support-contact-
 * address.spec.ts asserts them and passed). So: a locale in AVAILABLE_LOCALES must render
 * its own served wording; one that is not offered must render the ENGLISH served wording.
 * The list is imported from the app, so re-adding Arabic later makes this file expect
 * Arabic without anyone editing it.
 *
 * ANONYMOUS AND READ-ONLY: no account, no request other than page loads and GETs, the
 * ban notice is a sessionStorage flag set in the visitor's own browser. Safe against
 * production (allowlisted in qa/prod-readonly.ts). No AI credits. */

const SUPPORT_EMAIL = 'support@liquidity-hq.com';
const LOCALES = ['en', 'ar', 'ko', 'ru', 'zh'] as const;

for (const locale of LOCALES) {
  // The locale the page will actually show for a stored preference of `locale`.
  const shown = (AVAILABLE_LOCALES as string[]).includes(locale) ? locale : 'en';
  test.describe(`locale=${locale}${shown === locale ? '' : ' (stored preference, NOT offered: renders English, #138/#165)'}`, () => {
    test('the About page Contact card shows the served wording and names the address', async ({ browser, request }) => {
      const expected = (await servedLabels(request, shown)).ABOUT_CONTACT_BODY;
      expect(expected, `ABOUT_CONTACT_BODY is not served for locale=${shown}`).toContain(SUPPORT_EMAIL);

      const ctx = await browser.newContext();
      await ctx.addInitScript((l) => { localStorage.setItem('lhq_lang_v1', l); }, locale);
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/about');
        const card = page.locator('.card', { hasText: SUPPORT_EMAIL });
        await expect(card, `no Contact card naming ${SUPPORT_EMAIL} on /about in locale=${locale}`).toBeVisible({ timeout: 30_000 });
        // The page paints the shipped English first and swaps to the locale once its
        // labels land, so wait for the served wording rather than reading once.
        await expect(card, `the card in locale=${locale} does not show the wording the app serves for it ` +
          '("' + expected + '") - it is showing something else, most likely the English fallback')
          .toContainText(expected.replace(/\s+/g, ' ').trim(), { timeout: 30_000 });
      } finally {
        await ctx.close();
      }
    });

    test('a banned, signed-out visitor sees the served suspension wording naming the address', async ({ browser, request }) => {
      const expected = (await servedLabels(request, shown)).AUTH_GATE_BANNED_DESC;
      expect(expected, `AUTH_GATE_BANNED_DESC is not served for locale=${shown}`).toContain(SUPPORT_EMAIL);

      const ctx = await browser.newContext();
      await ctx.addInitScript(([l]) => {
        localStorage.setItem('lhq_lang_v1', l);
        // The one-shot flag AuthProvider's ban-kill sets; AuthGate reads it on mount.
        sessionStorage.setItem('lhq_ban_notice', '1');
      }, [locale]);
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/alerts');
        const desc = page.locator('.auth-gate-desc');
        await expect(desc, `AuthGate never rendered its description on /alerts in locale=${locale}`).toBeVisible({ timeout: 30_000 });
        await expect(desc, `the suspension message in locale=${locale} does not show the wording the app serves for it ` +
          '("' + expected + '") - the banned branch may not have fired, or the label fell back to English')
          .toContainText(expected.replace(/\s+/g, ' ').trim(), { timeout: 30_000 });
      } finally {
        await ctx.close();
      }
    });
  });
}
