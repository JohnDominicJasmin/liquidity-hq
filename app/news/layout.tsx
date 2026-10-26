import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto News - Market-Moving Headlines',
  description:
    'Crypto and macro headlines filtered for market relevance and ranked by how much they tend to move price, with the source and timestamp on every item.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/news' },
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
