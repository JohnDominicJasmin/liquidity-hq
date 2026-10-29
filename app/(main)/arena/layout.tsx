import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'AI Arena', robots: NOINDEX_APP_PAGE };

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
