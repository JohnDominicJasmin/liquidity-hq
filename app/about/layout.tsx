import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About the Platform & Its Data Sources',
  description:
    'What LiquidityHQ tracks, where the data comes from, and how the signals on the dashboard are put together.',
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
