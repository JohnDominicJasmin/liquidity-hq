import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Correlation Heatmap',
  description:
    'A heatmap of how the major coins have moved relative to one another, so you can see what is genuinely diversified and what is one position in disguise.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/correlation' },
};

export default function CorrelationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
