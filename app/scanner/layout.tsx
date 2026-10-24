import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Setup Scanner - Squeeze & Funding',
  description:
    'Scans the major perpetual markets for squeeze pressure, funding extremes, order-flow imbalance and structure breaks, and grades what it finds.',
};

export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
