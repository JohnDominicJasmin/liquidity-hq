import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import LandingContent from '@/components/LandingContent';
import { getDictionary, dirForLocale, isSupportedLocale, SUPPORTED_LOCALES } from '@/lib/i18n/dictionaries';

interface Params { locale: string }

/* Derived from SUPPORTED_LOCALES rather than listed, so removing a locale
   cannot leave a prerendered route behind. `ar` was in this literal and in that
   array, and the two would have had to be edited together - see #138. */
export function generateStaticParams() {
  return SUPPORTED_LOCALES.map(locale => ({ locale }));
}

/* THIS IS WHAT MAKES A BAD URL A REAL 404 (#157).
 *
 * `[locale]` is a single-segment dynamic route, so it matches EVERY
 * single-segment path - /nope, /pricing, /admin-typo. Every one of them reached
 * this page, hit the `notFound()` below, and answered **200**, because by then
 * the response had already started streaming and per Next's docs "the status
 * code of the response cannot be updated".
 *
 * That is the whole of #157: the site was not missing a 404 page, it had a
 * catch-all in front of one. Multi-segment paths like /nope/deeper were
 * genuinely unmatched and did return 404 all along.
 *
 * `dynamicParams = false` moves the decision to routing: a locale not in
 * generateStaticParams 404s before anything renders. From the docs -
 *
 *   > **false**: Dynamic route segments not included in `generateStaticParams`
 *   > will return a 404.
 *
 * The `isSupportedLocale` guard below stays as defence. It is now unreachable
 * in production, and that is fine - it costs nothing and it is the thing that
 * still works if this line is ever removed. */
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const dict = getDictionary(locale);
  return {
    title: 'LiquidityHQ',
    description: dict.hero.sub,
    openGraph: { title: 'LiquidityHQ', description: dict.hero.sub },
    /* #1740: SELF-referencing - `/ko` canonicalises to `/ko`, not to `/`.
     *
     * Pointing a translation at the English page is the obvious-looking move and it is the wrong one: a
     * canonical is a request to index the OTHER url instead, so `/ko -> /` asks Google to drop the Korean
     * page. These are translations of the same content, not duplicates of it, and the mechanism for saying
     * so is `hreflang`, not `canonical`.
     *
     * The `hreflang` set below is what says they are translations. It lists only the three that exist, so it
     * is correct whatever the owner decides about `ar` and `ru` - adding a locale later means adding a
     * dictionary and a list entry, not revisiting this.
     *
     * STILL OPEN AND NOT FIXED HERE: `<html lang>` is hardcoded `en` in app/layout.tsx, so `/ko` and `/zh`
     * declare the wrong language in their server HTML. Three client components correct it after mount, which
     * is too late for a crawler that runs no JavaScript. Only the ROOT layout renders `<html>` and it cannot
     * see this route's `[locale]` segment, so fixing it needs middleware or a route restructure - bigger than
     * a metadata change and deliberately not smuggled into one. */
    alternates: {
      canonical: `/${locale}`,
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
}

export default async function LocalizedLandingPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <LandingContent dict={dict} locale={locale} dir={dirForLocale(locale)} />;
}
