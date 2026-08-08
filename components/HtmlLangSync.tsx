'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isSupportedLocale, dirForLocale } from '@/lib/i18n/dictionaries';

/* `<html lang>` was hardcoded to "en" on every page, including /ko and /zh.
 *
 * WCAG 2.2 SC 3.1.1 (Level A). A screen reader picks its pronunciation from
 * this attribute, so Korean read as English is not accented - it is
 * unintelligible. Measured on production 2026-08-08: /ar and every other route
 * served `<html lang="en">` with no `dir`.
 *
 * WHY THIS IS CLIENT-SIDE, WHICH IS NOT THE OBVIOUS CHOICE.
 *
 * Only the root layout may render <html>, and a root layout receives no route
 * params. The server-side alternatives are:
 *
 *   - read headers() in the root layout -> makes EVERY route dynamic, and the
 *     build currently prerenders 76 of them. A Level A fix that costs the whole
 *     static build is the wrong trade.
 *   - multiple root layouts via route groups -> restructures the entire app
 *     three weeks before launch.
 *
 * So this sets the attribute on the live DOM instead.
 *
 * WHAT THAT DOES AND DOES NOT FIX, stated rather than left to be discovered:
 *
 *   fixed  - screen readers, which read the live DOM after hydration. That is
 *            the actual accessibility failure and the actual user.
 *   NOT    - the server-rendered HTML, which still says lang="en" until this
 *            runs. A crawler reading only the initial response sees English.
 *
 * The second half needs the layout restructure above. It is a real remainder,
 * not a rounding error, and it is on #138.
 */
export default function HtmlLangSync() {
  const pathname = usePathname();

  useEffect(() => {
    // The locale is the first path segment, and only on the landing routes -
    // /ko, /zh. Everything else is the English app.
    const first = pathname?.split('/')[1] ?? '';
    const locale = isSupportedLocale(first) ? first : 'en';

    document.documentElement.lang = locale;

    // Set together, never separately. A document whose language is Arabic but
    // whose direction is ltr is the state #138 was filed about; keeping the two
    // in one place is what stops them disagreeing again.
    document.documentElement.dir = dirForLocale(locale);
  }, [pathname]);

  return null;
}
