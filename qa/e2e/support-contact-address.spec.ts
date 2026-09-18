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
 * four languages." So the locale checks query /api/labels directly.
 *
 * WHAT IS GREEN AND WHAT IS RED, CORRECTED (Dev's review of #1366, confirmed
 * against the served values on deployed qa and prod, 2026-09-19). The first
 * version of this header said the English checks were green now and that the
 * per-locale checks were "already true today via the English fallback". That
 * was wrong, and it is worth saying how:
 *
 *   - The English fallback (`DEFAULT_EN_LABELS`, from labelDefaults.en.json)
 *     is CLIENT-side, in LabelsProvider. `/api/labels` returns DATABASE ROWS
 *     ONLY - English layered under the requested locale - and never fills a
 *     missing key from labelDefaults.
 *   - The two NEW keys (ABOUT_CONTACT_*) have no database row, so
 *     /api/labels has no such key in ANY locale, `en` included. The page
 *     still renders them, in English, because the client merges the defaults
 *     under the fetched map.
 *   - AUTH_GATE_BANNED_DESC already HAS a database row in every locale
 *     (seeded by 20260728d), and a database row shadows the shipped default
 *     (#675's class). It currently serves the OLD text with no address, on
 *     qa and on prod alike, in English too.
 *
 * So after #1360 merges and BEFORE the label rows were applied, only the
 * About-card test was green and about ten others were red.
 *
 * UPDATE 2026-09-19: PM/DevOps applied the rows to BOTH projects, owner-
 * approved (one update and fourteen inserts on prod - AUTH_GATE_BANNED_DESC
 * existed in English only there, so the other four locales had been silently
 * falling back to English). Checked against the served /api/labels on deployed
 * qa and on prod: ABOUT_CONTACT_BODY and AUTH_GATE_BANNED_DESC name the address
 * in all five locales on both. The group below is therefore now expected GREEN.
 * It stays grouped and its messages stay as written, because the failure it
 * guards is the one that already happened once: an upsert that only inserts
 * leaves a shadowing row in place, and a locale that has no row falls back to
 * English without saying so.
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

  test.describe('depend on the database label rows (applied 2026-09-19 - see header); a red here means a row is missing or shadowing, not a defect in #1360', () => {
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
        await expect(gateDesc, `expected the BANNED description naming ${SUPPORT_EMAIL} once the ` +
          'ban-notice flag is set. If it reads "...Contact support if you believe this is a mistake." with ' +
          'no address, the banned branch DID fire and the served label is the OLD database row shadowing ' +
          'the new default - the held label write has not landed yet').toContainText(SUPPORT_EMAIL);
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
          expect(value, `${key} has no database row for locale=${locale} (/api/labels serves rows only and ` +
            'never fills from labelDefaults.en.json - the client does that, not this route)').toBeTruthy();
          expect(value, `${key} in locale=${locale} ("${value}") does not name ${SUPPORT_EMAIL} - the ` +
            'one substring that must survive translation untouched').toContain(SUPPORT_EMAIL);
        }
      });
    }

    for (const locale of LOCALES.filter(l => l !== 'en')) {
      test(`locale=${locale} does not silently fall back to the English wording`, async ({ request }) => {
        const [enRes, localeRes] = await Promise.all([
          getGuarded(request, '/api/labels?locale=en'),
          getGuarded(request, `/api/labels?locale=${locale}`),
        ]);
        const en = await enRes.json() as Record<string, string>;
        const translated = await localeRes.json() as Record<string, string>;

        for (const key of ['ABOUT_CONTACT_BODY', 'AUTH_GATE_BANNED_DESC'] as const) {
          expect(translated[key], `${key} in locale=${locale} is missing or byte-identical to the English ` +
            `value ("${en[key]}") - either the database row has not landed yet (expected until PM/DevOps ` +
            'applies the write) or the label system fell back silently, which is the exact failure ' +
            '"assert by key, not rendered English" exists to catch').toBeTruthy();
          expect(translated[key], `${key} in locale=${locale} must be translated, not the English value`).not.toBe(en[key]);
        }
      });
    }
  });
});
