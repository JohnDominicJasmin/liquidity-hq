import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Platform Status',
  description:
    'A live check of the LiquidityHQ website, its account database, and the Bybit and Binance market-data feeds.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/about/layout.tsx. */
  alternates: { canonical: '/status' },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
