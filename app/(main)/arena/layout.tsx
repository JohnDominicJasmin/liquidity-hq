import PageH1 from '@/components/PageH1';
import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'AI Arena', robots: NOINDEX_APP_PAGE };

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <><PageH1 labelKey="PAGE_H1_ARENA" />{children}</>;
}
