import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Funding Rates by Coin, Live',
  description:
    'Live perpetual funding rates across the major coins, showing which side is paying and where positioning has become crowded enough to matter.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/funding' },
};

export default function FundingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
