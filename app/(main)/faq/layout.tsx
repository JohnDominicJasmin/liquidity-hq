import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import { faqGraph, breadcrumbGraph } from '@/lib/structuredData';

export const metadata: Metadata = {
  title: 'FAQ - Plans, Data & Signals',
  description:
    'Answers to the common questions about LiquidityHQ: what the data covers, how the signals are produced, what each plan includes, and how billing works.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/faq' },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StructuredData graph={faqGraph()} />
      <StructuredData graph={breadcrumbGraph('FAQ', '/faq')} />
      {children}
    </>
  );
}
