import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/AppShell';

// Runs before hydration and before the browser paints the body — the server
// has no access to localStorage, so it always renders the full landing page
// on "/". This blocking script hides it pre-paint for returning sessions so
// there's never a visible flash of marketing content before the redirect.
// Same FOUC-prevention pattern as a dark-mode flash guard, just gating on a
// stored Supabase session token instead of a theme preference.
const SESSION_FLASH_GUARD = `(function(){
  try {
    if (location.pathname !== '/') return;
    var hasSession = Object.keys(localStorage).some(function(k){
      return k.indexOf('sb-') === 0 && k.endsWith('-auth-token');
    });
    if (hasSession) document.documentElement.classList.add('lp-pending');
  } catch (e) {}
})();`;

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
  title: {
    default: 'LiquidityHQ.ai',
    template: '%s — LiquidityHQ.ai',
  },
  description: 'Real-time crypto trading intelligence — whale trades, funding rates, squeeze alerts, and AI analysis.',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    siteName: 'LiquidityHQ.ai',
    title: 'LiquidityHQ.ai — Crypto Trading Intelligence',
    description: 'Real-time crypto trading intelligence — whale trades, funding rates, squeeze alerts, and AI analysis.',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'LiquidityHQ.ai' }],
  },
  twitter: {
    card: 'summary',
    title: 'LiquidityHQ.ai',
    description: 'Real-time crypto trading intelligence — whale trades, funding rates, squeeze alerts, and AI analysis.',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LiquidityHQ.ai',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d0d0d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${figtree.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <Script id="session-flash-guard" strategy="beforeInteractive">
          {SESSION_FLASH_GUARD}
        </Script>
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
