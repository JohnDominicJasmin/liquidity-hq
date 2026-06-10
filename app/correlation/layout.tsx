import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Correlation Heatmap' };

export default function CorrelationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
