import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Trade Journal' };

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
