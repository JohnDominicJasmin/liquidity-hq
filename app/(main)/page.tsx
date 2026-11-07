import type { Metadata } from 'next';
import LandingContent from '@/components/LandingContent';
import { en } from '@/lib/i18n/dictionaries';

/* #1740: `/`'s canonical lives HERE rather than on the root layout, because a canonical on the layout is
   inherited by every page that does not set its own - and each of those would then declare itself to be
   `/`. The title and description still come from the layout; only this one field is page-scoped. */
export const metadata: Metadata = {
  alternates: {
    canonical: '/',
    /* #1740: hreflang for the three landing locales that ACTUALLY EXIST. Reciprocal on all three, with
       x-default on the English one, so they stop competing with each other for the same queries.

       `ru` IS listed as of 2026-11-08; `ar` still is not, and the difference is the point.
       This comment used to say both 404 because the landing copy lives only in dictionaries.ts and
       `LandingContent` takes it as a prop, not from the label table - so adding a locale was a
       TRANSLATION job, not a list change. That is still true, and it is why `ar` stays out: Arabic
       is withdrawn under owner decision #138 for unimplemented RTL, not for missing strings.
       Russian got its 107 landing strings written and reviewed (#1740), so it became a list change.

       FOUR LISTS HAD TO MOVE IN ONE COMMIT and nothing enforces that: this map, the identical one in
       app/(intl)/[locale]/page.tsx, SUPPORTED_LOCALES, the `dictionaries` map, and the sitemap.
       Listing an hreflang that 404s is worse than omitting it, so if a locale is ever added again,
       grep for one of the existing codes rather than trusting this list to be the only one.

       ONLY THE LANDING CARRIES THIS. /about, /faq and the rest have no translations, so claiming
       alternates for them would point a crawler at pages that do not exist in that language. */
    languages: {
      en: '/',
      ko: '/ko',
      zh: '/zh',
      ru: '/ru',
      'x-default': '/',
    },
  },
};

export default function LandingPage() {
  return <LandingContent dict={en} locale="en" dir="ltr" />;
}
