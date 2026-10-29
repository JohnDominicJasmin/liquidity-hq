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

       `ar` and `ru` are NOT listed, and that is the point rather than an omission. They 404:
       SUPPORTED_LOCALES in lib/i18n/dictionaries.ts is ['ko','zh'] and generateStaticParams with
       dynamicParams=false rejects everything else before it renders. Prod lhq_labels holds 2,679 rows
       each for ar and ru, but ZERO landing strings - the landing copy lives only in dictionaries.ts and
       LandingContent takes it as a prop, not from the label table. So adding them is a translation job,
       not a list change, and listing an hreflang that 404s is worse than omitting it.

       ONLY THE LANDING CARRIES THIS. /about, /faq and the rest have no translations, so claiming
       alternates for them would point a crawler at pages that do not exist in that language. */
    languages: {
      en: '/',
      ko: '/ko',
      zh: '/zh',
      'x-default': '/',
    },
  },
};

export default function LandingPage() {
  return <LandingContent dict={en} locale="en" dir="ltr" />;
}
