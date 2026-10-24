import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto News Feed - Market-Moving Headlines, Ranked',
  description:
    'Crypto and macro headlines filtered for market relevance and ranked by how much they tend to move price, with the source and timestamp on every item.',
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
