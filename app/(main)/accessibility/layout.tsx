import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description:
    'What LiquidityHQ aims for on accessibility, what is in place today, where we know we fall short, and how to tell us when something blocks you.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/about/layout.tsx. */
  alternates: { canonical: '/accessibility' },
};

export default function AccessibilityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
