import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Markets - Prices, Grades & Signals',
  description:
    'Live prices and 24-hour change across the major coins, each with a health grade, volume, buy pressure and the strongest signal currently firing.',
};

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
