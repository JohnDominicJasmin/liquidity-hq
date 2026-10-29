import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'Trade Journal', robots: NOINDEX_APP_PAGE };

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
