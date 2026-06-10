import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Market Hours' };

export default function HoursLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
