import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Refund Policy' };

export default function RefundLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
