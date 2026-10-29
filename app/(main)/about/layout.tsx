import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About the Platform & Its Data Sources',
  description:
    'What LiquidityHQ tracks, where the data comes from, and how the signals on the dashboard are put together.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/about' },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
