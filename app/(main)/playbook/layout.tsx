import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import { playbookArticleGraph, breadcrumbGraph } from '@/lib/structuredData';

/* One string for the meta description AND the Article's description, so the two cannot drift apart. */
const DESCRIPTION =
  'How to read liquidity on a crypto chart: where stops cluster, what a sweep looks like, which confirmations matter, and the risk rules that go with each setup.';

export const metadata: Metadata = {
  title: 'Crypto Liquidity Playbook - Setups & Risk',
  description: DESCRIPTION,
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/playbook' },
};

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StructuredData graph={playbookArticleGraph(DESCRIPTION)} />
      {/* 'Playbook', not the page title: it is what the nav calls this page (NAV_PLAYBOOK). */}
      <StructuredData graph={breadcrumbGraph('Playbook', '/playbook')} />
      {children}
    </>
  );
}
