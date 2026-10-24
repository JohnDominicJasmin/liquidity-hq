import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import { proProductGraph, breadcrumbGraph } from '@/lib/structuredData';

export const metadata: Metadata = {
  title: 'Pro - Full Access to Every Market Tool',
  description:
    'What LiquidityHQ Pro unlocks: every coin on the scanner, the full liquidation map, AI market reads and alerting. Current pricing is shown on the page.',
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
