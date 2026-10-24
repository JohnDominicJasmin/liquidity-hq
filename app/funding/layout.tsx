import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Funding Rates - Live Perpetual Funding by Coin',
  description:
    'Live perpetual funding rates across the major coins, showing which side is paying and where positioning has become crowded enough to matter.',
};

export default function FundingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
