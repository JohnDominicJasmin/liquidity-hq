import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono } from 'next/font/google';
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
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'LiquidityHQ' }],
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
  themeColor: '#0d0d0d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${figtree.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
