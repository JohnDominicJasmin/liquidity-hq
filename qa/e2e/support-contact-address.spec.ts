import { test, expect } from '@playwright/test';
import { gotoGuarded, getGuarded } from './_shared';

/* #1347 item 34 (#1360, fix by Dev Team) - support@liquidity-hq.com now
 * exists, and two of the three dead-end surfaces that pointed at nothing
 * now name it: the About page's new Contact card (ABOUT_CONTACT_LABEL /
 * ABOUT_CONTACT_BODY) and the suspended-account gate (AUTH_GATE_BANNED_DESC,
 * appended with the address rather than replaced).
 *
 * NEITHER SURFACE NEEDS AUTH. The Contact card is public; the banned
 * message only ever shows to a SIGNED-OUT visitor (AuthGate.tsx renders it
 * in place of `!user`'s branch, gated on a one-shot sessionStorage flag
 * AuthProvider sets right before its realtime ban-kill signs the tab out -
 * `BAN_NOTICE_KEY = 'lhq_ban_notice'`). Simulated here by setting that key
 * before navigating anonymously to a page AuthGate wraps (`/alerts`),
 * rather than needing a real banned account.
 *
 * PER PM/DEVOPS: "assert by label key rather than by rendered English, or
 * the test passes on the fallback and tells you nothing about the other
 * four languages." The five-locale DB row insert (ar/ko/ru/zh) is a
 * SEPARATE gated write Dev's PR does not include - as of this file, only
 * `en` exists anywhere (lib/labelDefaults.en.json). So:
 *   - the EN structural checks (rendered UI) are expected GREEN now.
 *   - the per-locale API checks assert the one thing that must hold in
 *     EVERY locale regardless of translation quality - the address itself
 *     is present - which is already true today via the English fallback.
 *   - the "actually translated, not silently falling back to English"
 *     checks for ar/ko/ru/zh are expected RED until that DB write lands,
 *     same shape as the verdict-note migration and TimezoneSync item 19
 *     tonight - written against the target end state, not the proposal.
 */

const SUPPORT_EMAIL = 'support@liquidity-hq.com';
const LOCALES = ['en', 'ar', 'ko', 'ru', 'zh'] as const;

test.describe('Support contact surfaces name a real address (#1360)', () => {
  test('the About page renders a Contact card naming the support address', async ({ page }) => {
    await gotoGuarded(page, '/about');
    const card = page.locator('.card', { hasText: SUPPORT_EMAIL });
    await expect(card, `no .card on /about contains "${SUPPORT_EMAIL}" - the Contact card ` +
      'never rendered, or the address changed').toBeVisible({ timeout: 10_000 });
  });

  test('a banned, signed-out visitor sees the address inline in the suspension message, not the generic gate text', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // Set BEFORE navigation - AuthGate reads it in a mount-only effect,
      // the same instant AuthProvider's realtime ban-kill would have set
      // it for a real account.
      await page.addInitScript(key => { sessionStorage.setItem(key, '1'); }, 'lhq_ban_notice');
      await gotoGuarded(page, '/alerts');

      const gateDesc = page.locator('.auth-gate-desc');
      await expect(gateDesc, 'AuthGate never rendered its signed-out description on /alerts - ' +
        'this run measured nothing').toBeVisible({ timeout: 10_000 });
      await expect(gateDesc, `expected the BANNED description (naming ${SUPPORT_EMAIL}) once the ` +
        'ban-notice flag is set - got the generic "create a free account" text instead, so the ' +
        'banned branch never fired').toContainText(SUPPORT_EMAIL);
      await expect(gateDesc, 'the banned description must not still read as the generic ' +
        'sign-in prompt').not.toContainText('Create a free account');
    } finally {
      await ctx.close();
    }
  });

  for (const locale of LOCALES) {
    test(`/api/labels?locale=${locale}: ABOUT_CONTACT_BODY and AUTH_GATE_BANNED_DESC both name the address`, async ({ request }) => {
      const res = await getGuarded(request, `/api/labels?locale=${locale}`);
      expect(res.status(), `/api/labels?locale=${locale} answered ${res.status()}`).toBe(200);
      const body = await res.json() as Record<string, string>;

      for (const key of ['ABOUT_CONTACT_BODY', 'AUTH_GATE_BANNED_DESC'] as const) {
        const value = body[key];
        expect(value, `${key} has no row for locale=${locale} at all (English fallback covers ` +
          'a MISSING translation, but this key is missing from the response entirely)').toBeTruthy();
        expect(value, `${key} in locale=${locale} ("${value}") does not name ${SUPPORT_EMAIL} - the ` +
          'one substring that must survive translation untouched').toContain(SUPPORT_EMAIL);
      }
    });
  }

  test.describe('translated, not English-fallback (expected RED until PM/DevOps applies the 5-locale DB write)', () => {
    for (const locale of LOCALES.filter(l => l !== 'en')) {
      test(`locale=${locale} does not silently fall back to the English wording`, async ({ request }) => {
        const [enRes, localeRes] = await Promise.all([
          getGuarded(request, '/api/labels?locale=en'),
          getGuarded(request, `/api/labels?locale=${locale}`),
        ]);
        const en = await enRes.json() as Record<string, string>;
        const translated = await localeRes.json() as Record<string, string>;

        for (const key of ['ABOUT_CONTACT_BODY', 'AUTH_GATE_BANNED_DESC'] as const) {
          expect(translated[key], `${key} in locale=${locale} is byte-identical to the English ` +
            `value ("${en[key]}") - either the DB row for this key/locale has not landed yet ` +
            '(expected, until PM/DevOps applies the write - see this file\'s header) or the ' +
            'label system fell back silently, which is the exact failure "assert by key, not ' +
            'rendered English" exists to catch').not.toBe(en[key]);
        }
      });
    }
  });
});
