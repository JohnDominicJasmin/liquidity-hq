import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About LiquidityHQ - What It Does and Who Builds It',
  description:
    'What LiquidityHQ tracks, where the data comes from, and how the signals on the dashboard are put together.',
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
