import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Live Prices' };

export default function PricesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
