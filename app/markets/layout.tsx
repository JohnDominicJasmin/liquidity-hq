import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Markets - Prices, Grades & Signals',
  description:
    'Live prices and 24-hour change across the major coins, each with a health grade, volume, buy pressure and the strongest signal currently firing.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/markets' },
};

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
