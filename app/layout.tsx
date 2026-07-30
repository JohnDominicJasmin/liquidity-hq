import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/AppShell';

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  // Without this, relative URLs in openGraph.images (below) resolve against
  // whatever host issued the request - in production that silently defaulted
  // to localhost:3000 (visible as a build warning), so every shared link's
  // preview image has been broken since launch. Also needed for sitemap.ts's
  // canonical entry URLs.
  metadataBase: new URL('https://liquidity-hq.com'),
  title: {
    default: 'LiquidityHQ',
    template: '%s - LiquidityHQ',
  },
  description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    siteName: 'LiquidityHQ',
    title: 'LiquidityHQ - Crypto Trading Intelligence',
    description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
    images: [{ url: '/icons/icon-512.jpg', width: 512, height: 512, alt: 'LiquidityHQ' }],
  },
  twitter: {
    card: 'summary',
    title: 'LiquidityHQ',
    description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LiquidityHQ',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the app's real body background (app/globals.css) - was
  // #0d0d0d, a stale value from before the icon redesign that public/
  // manifest.json also had and got corrected there but was missed here.
  themeColor: '#06070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${figtree.variable} ${plexMono.variable}`} suppressHydrationWarning>
      {/* No manual apple-touch-icon <link> here - app/apple-icon.png's file
          convention already generates the correct tag automatically. The old
          hardcoded one pointed at /icons/icon-192.jpg, which the icon
          redesign deleted; keeping it would have shipped a broken link
          alongside the correct auto-generated one. */}
      <body>
        {/* beforeInteractive - injected into the initial server HTML and
            runs before hydration, so data-theme is correct before first
            paint (no flash of the wrong theme). Mirrors lib/theme.ts's
            getStoredTheme(): explicit localStorage choice wins, otherwise
            follow the device's prefers-color-scheme. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
