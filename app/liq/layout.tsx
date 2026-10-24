import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Liquidation Map - Leverage Clusters',
  description:
    'A live map of liquidation clusters across the major perpetual markets, showing which price levels hold the most leveraged exposure on each side.',
};

export default function LiqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
