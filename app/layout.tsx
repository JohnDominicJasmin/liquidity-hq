import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/AppShell';

// Self-hosted, previously next/font/google.
//
// next/font/google downloads the font files from fonts.gstatic.com AT BUILD
// TIME, which quietly made every build - including CI and every Render deploy -
// dependent on Google being reachable. It bit twice on 2026-08-04, both times
// failing the whole build with "Failed to fetch `Figtree` from Google Fonts"
// and both times passing on a retry. A deploy that fails for reasons unrelated
// to the code is worth removing outright, and CI has no retry.
//
// The files in app/fonts are the exact latin-subset woff2s next/font/google was
// fetching (Figtree v9 variable 300-900, IBM Plex Mono v20 at 400/500/600/700),
// pulled from the same gstatic URLs its CSS resolves to. Both families are
// OFL-licensed, so redistribution here is permitted. Only the latin subset is
// included, matching the previous `subsets: ['latin']`.
//
// display: 'swap' matches next/font/google's default, so first-paint behaviour
// is unchanged.
const figtree = localFont({
  src: [{ path: './fonts/figtree-latin-var.woff2', weight: '300 900', style: 'normal' }],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: './fonts/plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plex-mono-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plex-mono-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
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
      {/* consent-pending is set here, in the server markup, and removed by
          components/CookieConsent.tsx once it has read the stored consent
          state. It holds the Ask AI FAB back for those first few frames.
          Without it the FAB painted immediately, then the consent bar mounted
          and displaced it - which is how it got reported as "the FAB
          disappears". See body.consent-pending in globals.css. */}
      <body className="consent-pending">
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
