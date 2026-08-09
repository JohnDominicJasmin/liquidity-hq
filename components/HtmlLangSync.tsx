'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLabels } from '@/lib/labels';
import { isSupportedLocale as isLandingLocale } from '@/lib/i18n/dictionaries';
import { dirForLocale } from '@/lib/i18n/dictionaries';

/* `<html lang>` was hardcoded to "en" on every page.
 *
 * WCAG 2.2 SC 3.1.1 (Level A). A screen reader picks its pronunciation from
 * this attribute, so Korean read as English is not accented - it is
 * unintelligible.
 *
 * TWO SOURCES OF TRUTH, AND THE ORDER MATTERS (#164).
 *
 * The first version of this read the PATH only, which was wrong everywhere the
 * path carries no locale. This app localises in two independent ways:
 *
 *   /ko, /zh          the landing page, build-time static dictionaries
 *   LabelsProvider    the whole app, locale from localStorage or the signed-in
 *                     user's user_settings.language
 *
 * So a user who picks 한국어 from the nav sees Korean copy on /upgrade,
 * /dashboard and everywhere else while `lang` said `en`. That is the Level A
 * failure on the majority of routes - the landing pages were the only ones the
 * path could ever have got right.
 *
 * PATH WINS WHERE A PATH EXISTS. /ko is an explicit request for Korean and
 * must not be overridden by a stale localStorage value from a previous visit.
 * Everywhere else the labels layer is the only thing that knows.
 *
 * STILL CLIENT-SIDE, and the reasoning is unchanged: only a root layout may
 * render <html>, it receives no route params, and reading headers() there would
 * make all 76 prerendered routes dynamic. The labels locale is localStorage
 * anyway, so it could not be server-rendered even if that were free.
 *
 * WHAT THAT STILL DOES NOT FIX: the server-rendered HTML says lang="en" until
 * hydration. A crawler reading only the initial response sees English. That
 * needs the layout restructure and stays on #138.
 */
export default function HtmlLangSync() {
  const pathname = usePathname();
  const { locale } = useLabels();

  useEffect(() => {
    /* The landing routes are the only ones with a locale in the URL, and there
       the URL is the user's explicit choice. `isLandingLocale` is the landing
       list deliberately - /ru is not a route, so a stored `ru` preference must
       not make the app think it is on a Russian landing page. */
    const first = pathname?.split('/')[1] ?? '';
    const fromPath = isLandingLocale(first) ? first : null;

    const active = fromPath ?? locale;

    document.documentElement.lang = active;

    /* Set together, never separately. A document whose language is Arabic but
       whose direction is ltr is the state #138 was filed about. Arabic is no
       longer offered in any picker, but a preference stored before that shipped
       still resolves - so this has to stay correct for it. */
    document.documentElement.dir = dirForLocale(active);
  }, [pathname, locale]);

  return null;
}
