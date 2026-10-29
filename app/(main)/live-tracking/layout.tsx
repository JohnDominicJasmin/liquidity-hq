import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'Live Tracking', robots: NOINDEX_APP_PAGE };

export default function LiveTrackingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
