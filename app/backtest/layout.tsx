import type { Metadata } from 'next';
import { NOINDEX_APP_PAGE } from '@/lib/seo';

export const metadata: Metadata = { title: 'Backtest', robots: NOINDEX_APP_PAGE };

export default function BacktestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
