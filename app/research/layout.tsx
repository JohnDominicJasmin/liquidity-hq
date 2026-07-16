import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Market Research' };

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
