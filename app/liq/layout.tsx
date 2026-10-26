import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Liquidation Map - Leverage Clusters',
  description:
    'A live map of liquidation clusters across the major perpetual markets, showing which price levels hold the most leveraged exposure on each side.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/liq' },
};

export default function LiqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
