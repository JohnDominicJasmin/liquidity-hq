import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Position Sizer' };

export default function CalcLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
