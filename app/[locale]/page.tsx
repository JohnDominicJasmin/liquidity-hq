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
