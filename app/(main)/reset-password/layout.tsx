import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

/* Its own title and no search listing (SEO quick wins, #1185). The page is a client component, so its metadata lives here. */
export const metadata: Metadata = { title: "Set a new password", robots: NOINDEX_APP_PAGE };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
