import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Economic Calendar' };

export default function EconCalendarLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
