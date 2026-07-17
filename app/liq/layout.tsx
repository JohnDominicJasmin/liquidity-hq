import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Liquidation Map' };

export default function LiqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
