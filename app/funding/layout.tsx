import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Funding Rates' };

export default function FundingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
