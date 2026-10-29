import type { Metadata } from 'next';
import RootDocument, { rootViewport, ROOT_METADATA_BASE } from '@/components/RootDocument';
import { OG_IMAGES } from '@/lib/seo';

/* ROOT LAYOUT FOR THE ENGLISH APP - one of TWO root layouts (#1740 item 2).
 *
 * This file was app/layout.tsx. It moved into the (main) route group so that app/(intl)/[locale] can
 * have a root layout of its own and render <html lang="ko"> / <html lang="zh">: only a root layout
 * renders <html>, and a root layout cannot see a dynamic segment below it. Route groups are invisible
 * in URLs, so nothing about any path changed - /about is still /about.
 *
 * The <html>/<body> tree itself is in components/RootDocument, shared with the intl root. What stays
 * here is only what is specific to the English app: its metadata. */

export const metadata: Metadata = {
  metadataBase: ROOT_METADATA_BASE,
  title: {
    /* #1740 item 3: was the bare 'LiquidityHQ' - 11 characters on the one page with the most to say
       for itself. This is the DEFAULT, so it titles '/' only; every other route sets its own and gets
       the template below. Kept under ~60 so a search result does not truncate it. */
    default: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    template: '%s - LiquidityHQ',
  },
  description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    siteName: 'LiquidityHQ',
    /* #1740: the same string as the <title> default above. These three disagreed - <title> said
       'LiquidityHQ', openGraph said 'Crypto Market Analytics', twitter said 'LiquidityHQ' - so one
       page carried three names depending on who asked. appleWebApp.title stays the bare 'LiquidityHQ'
       on purpose: that is the installed PWA's name on a home screen, not a page title. */
    title: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
    // #1633: this pointed at /icons/icon-512.jpg, which does not exist (404), so every shared link
    // showed no picture. The file is a .png. #1740 item 3: one constant, shared with /learn and
    // /[locale], which each had to repeat it because a local openGraph object replaces this one rather
    // than merging - and which, not repeating it, had no share image at all.
    images: OG_IMAGES,
  },
  twitter: {
    card: 'summary',
    title: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
    images: ['/icons/icon-512.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LiquidityHQ',
  },
};

export const viewport = rootViewport;

export default function MainRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
