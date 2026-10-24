import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Position Size Calculator - Risk, Stop & Leverage',
  description:
    'Work out position size from account size, risk per trade and stop distance, with the leverage and liquidation distance that result.',
};

export default function CalcLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
