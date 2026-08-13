/* Which language the document should declare, given where the user is and what
 * they have chosen.
 *
 * Pure, and separate from the component, because the previous version of this
 * was wrong in a way no source-level test could see: it called `useLabels()`
 * from a component mounted OUTSIDE `LabelsProvider`, so the hook returned the
 * context default - `locale: 'en'` - on every route. The test asserted the hook
 * was called. It was. It just never returned anything real, and `lang` stayed
 * `en` while the page rendered Korean (#164, caught by QA in a browser).
 *
 * A pure function moves the decision somewhere it can be checked without a
 * provider, a DOM or a build. What it cannot check is that the caller is
 * mounted correctly - only a browser can - which is why that half is asserted
 * in qa/e2e rather than here.
 */
/* Relative, not the `@/` alias: this module is imported directly by
   __tests__/localeOffering.test.mts under `node --test`, which resolves neither
   tsconfig paths nor Next's alias. The alias works in app code and fails here,
   silently in the sense that only the test breaks. */
import { dirForLocale, isSupportedLocale as isLandingLocale } from './i18n/dictionaries.ts';

export interface HtmlLangAttributes {
  lang: string;
  dir: 'ltr' | 'rtl';
}

/**
 * @param pathname the current path, or null before it is known
 * @param locale   the labels locale - localStorage, or the signed-in user's
 *                 `user_settings.language` once LanguageSync has applied it
 *
 * THE PATH WINS WHERE A PATH EXISTS. `/ko` is an explicit request for Korean
 * and must not be overridden by a stale stored preference from a previous
 * visit. Everywhere else the URL carries no locale at all, and the labels layer
 * is the only thing that knows - which is the entire content of #164.
 */
export function htmlLangFor(pathname: string | null, locale: string): HtmlLangAttributes {
  const first = pathname?.split('/')[1] ?? '';

  /* Deliberately the LANDING locale list, not the app-wide one. Only /ko and
     /zh are real routes, so a stored `ru` preference must not make this treat
     the first segment of /russia-page as a locale. */
  const fromPath = isLandingLocale(first) ? first : null;

  const lang = fromPath ?? locale ?? 'en';

  /* Set together, always. A document whose language is Arabic and whose
     direction is ltr is the state #138 was filed about. Arabic is no longer
     offered anywhere, but a preference stored before that shipped still
     resolves, so this has to stay correct for it. */
  return { lang, dir: dirForLocale(lang) };
}
