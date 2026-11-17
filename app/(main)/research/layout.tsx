import PageH1 from '@/components/PageH1';
import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'Market Research', robots: NOINDEX_APP_PAGE };

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return <><PageH1 labelKey="PAGE_H1_RESEARCH" />{children}</>;
}
