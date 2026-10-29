import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Setup Scanner - Squeeze & Funding',
  description:
    'Scans the major perpetual markets for squeeze pressure, funding extremes, order-flow imbalance and structure breaks, and grades what it finds.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/scanner' },
};

export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
