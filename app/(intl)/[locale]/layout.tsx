import type { Metadata } from 'next';
import RootDocument, { rootViewport, ROOT_METADATA_BASE } from '@/components/RootDocument';
import { isSupportedLocale } from '@/lib/i18n/dictionaries';

/* ROOT LAYOUT FOR THE LANDING TRANSLATIONS - the second of two root layouts (#1740 item 2).
 *
 * WHY THIS EXISTS: <html lang> was hardcoded 'en' in the single root layout, so /ko and /zh served
 * lang="en" to crawlers. Three client components corrected it after mount, which is too late for a
 * crawler that runs no JavaScript.
 *
 * WHY IT SITS AT [locale] AND NOT AT (intl)/layout.tsx. A root layout is any layout with no layout
 * above it, and this is the topmost layout on this branch, so it IS the root layout for /ko and /zh.
 * It has to be here rather than one level up because a layout can only read the params of a dynamic
 * segment at or below itself - app/(intl)/layout.tsx sits ABOVE [locale] and would have no way to know
 * the locale. The alternatives were middleware or calling headers()/cookies() in a root layout; the
 * second opts the entire subtree out of static rendering, which is every page in the app, so neither
 * was acceptable for a two-route fix. Awaiting `params` is not a dynamic API: with the page's
 * generateStaticParams and `dynamicParams = false`, /ko and /zh stay prerendered.
 *
 * NO LOCALE VALIDATION BEYOND THE GUARD BELOW. `dynamicParams = false` on the page already 404s any
 * segment outside generateStaticParams before anything renders (#157/#163). The fallback to 'en' here
 * exists so this layout can never emit `lang` for a locale we do not ship even if that routing
 * guarantee changes - it is defence, not the mechanism. */

export const metadata: Metadata = {
  /* REQUIRED HERE TOO, not inherited. Metadata does not cross root layouts, and both OG_IMAGES
     (/icons/icon-512.png) and this page's `alternates.canonical` (/ko) are RELATIVE - without a
     metadataBase they resolve against whatever host issued the request, which in production silently
     defaulted to localhost:3000. The Korean and Chinese pages are the two most likely to be shared
     into a chat app, so this is the pair that could least afford to lose it. */
  metadataBase: ROOT_METADATA_BASE,
};

export const viewport = rootViewport;

export default async function IntlRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <RootDocument lang={isSupportedLocale(locale) ? locale : 'en'}>{children}</RootDocument>;
}
