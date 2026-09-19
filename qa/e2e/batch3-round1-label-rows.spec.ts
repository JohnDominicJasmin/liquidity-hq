import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';

/* #1309 batch 3 round 1 (#1386): the three NEW label keys have database rows in all five
 * locales. Migration 20260919d_labels_batch3_round1_error_states.sql adds them; PM/DevOps
 * applies it at release time, so until then this file is expected RED and that is the
 * point - it is the check that the rows landed.
 *
 *   SETTINGS_TG_STATUS_ERROR      Settings > Telegram: the status check itself failed
 *   SETTINGS_PUSH_ENABLE_FAILED   Settings > push toggle: the server refused the subscription
 *   ONBOARDING_FLOW_SAVE_FAILED   Onboarding wizard: the profile save failed
 *
 * WHY A RAW /api/labels READ, NOT servedLabels(): the question here is "is there a
 * DATABASE row", and servedLabels() layers the shipped English defaults over the rows, so
 * it would answer "yes" for a key that has no row at all. /api/labels serves rows only;
 * the English fallback is the client's. A locale with no row shows English to every user of
 * that language and nothing says so.
 *
 * Per locale, three questions: the row exists; it is not the English wording (a copy-paste
 * into the wrong locale); and it is written in that locale's script. The script check is
 * coarse on purpose - it catches an English or wrong-language paste, not a poor translation.
 * ar/ko/ru/zh are machine translations awaiting a native reviewer; this does not judge them.
 *
 * Anonymous, GET only. No account, no AI credits. */

const KEYS = ['SETTINGS_TG_STATUS_ERROR', 'SETTINGS_PUSH_ENABLE_FAILED', 'ONBOARDING_FLOW_SAVE_FAILED'] as const;
const LOCALES = ['en', 'ar', 'ko', 'ru', 'zh'] as const;
const SCRIPT: Record<string, RegExp> = {
  ar: /[؀-ۿ]/,
  ko: /[가-힯]/,
  ru: /[Ѐ-ӿ]/,
  zh: /[一-鿿]/,
};

test.describe('#1386 new label rows exist in every locale (applied at release time - a red here before then means "not applied yet", not a defect in the PR)', () => {
  for (const locale of LOCALES) {
    test(`locale=${locale}: ${KEYS.length} keys have a row${locale === 'en' ? '' : ', translated, in the right script'}`, async ({ request }) => {
      const res = await getGuarded(request, `/api/labels?locale=${locale}`);
      expect(res.status(), `/api/labels?locale=${locale} answered ${res.status()}`).toBe(200);
      const rows = await res.json() as Record<string, string>;
      const en = locale === 'en' ? rows : await (await getGuarded(request, '/api/labels?locale=en')).json() as Record<string, string>;

      const problems: string[] = [];
      for (const key of KEYS) {
        const v = rows[key];
        if (!v || !v.trim()) { problems.push(`${key}: no database row (/api/labels serves rows only; the client's English fallback hides this)`); continue; }
        if (locale === 'en') continue;
        if (v === en[key]) problems.push(`${key}: byte-identical to the English row ("${v}")`);
        else if (!SCRIPT[locale].test(v)) problems.push(`${key}: "${v}" is not written in the ${locale} script`);
      }
      expect(problems, `locale=${locale}: ${problems.join(' | ')}`).toEqual([]);
    });
  }
});
