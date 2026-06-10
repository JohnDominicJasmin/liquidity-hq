import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Morning Briefing' };

export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
