import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import { proProductGraph, breadcrumbGraph } from '@/lib/structuredData';

export const metadata: Metadata = {
  title: 'Pro - Full Access to Every Market Tool',
  description:
    'What LiquidityHQ Pro unlocks: every coin on the scanner, the full liquidation map, AI market reads and alerting. Current pricing is shown on the page.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/upgrade' },
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StructuredData graph={proProductGraph()} />
      <StructuredData graph={breadcrumbGraph('Upgrade to Pro', '/upgrade')} />
      {children}
    </>
  );
}
