import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog - What Has Shipped on LiquidityHQ',
  description:
    'Every LiquidityHQ release in plain language, newest first - fixes, new features, and the accessibility and reliability work behind them.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/about/layout.tsx: it is
     deliberately never set on the root layout, so each page sets its own or has none. */
  alternates: { canonical: '/changelog' },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
