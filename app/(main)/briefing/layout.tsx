import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'Morning Briefing', robots: NOINDEX_APP_PAGE };

export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
