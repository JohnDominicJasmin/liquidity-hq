import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Correlation Heatmap',
  description:
    'A heatmap of how the major coins have moved relative to one another, so you can see what is genuinely diversified and what is one position in disguise.',
};

export default function CorrelationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
