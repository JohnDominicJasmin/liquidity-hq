import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Best Hours' };

export default function HoursLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
