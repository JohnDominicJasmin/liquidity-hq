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
  };
}

export default async function LocalizedLandingPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <LandingContent dict={dict} locale={locale} dir={dirForLocale(locale)} />;
}
