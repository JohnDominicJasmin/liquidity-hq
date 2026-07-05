import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import LandingContent from '@/components/LandingContent';
import { getDictionary, dirForLocale, isSupportedLocale } from '@/lib/i18n/dictionaries';

interface Params { locale: string }

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'zh' }, { locale: 'ar' }];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const dict = getDictionary(locale);
  return {
    title: 'LiquidityHQ.ai',
    description: dict.hero.sub,
    openGraph: { title: 'LiquidityHQ.ai', description: dict.hero.sub },
  };
}

export default async function LocalizedLandingPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <LandingContent dict={dict} locale={locale} dir={dirForLocale(locale)} />;
}
