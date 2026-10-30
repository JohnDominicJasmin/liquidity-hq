import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help - How to Use LiquidityHQ',
  description:
    'How to use each part of LiquidityHQ: reading the chart signals and Confluence Score, setting up alerts and Telegram, AI Arena, the Journal and the calculators, and your account settings.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/about/layout.tsx. */
  alternates: { canonical: '/help' },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
