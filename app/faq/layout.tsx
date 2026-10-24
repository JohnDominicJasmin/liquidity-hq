import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import { faqGraph, breadcrumbGraph } from '@/lib/structuredData';

export const metadata: Metadata = {
  title: 'FAQ - Plans, Data & Signals',
  description:
    'Answers to the common questions about LiquidityHQ: what the data covers, how the signals are produced, what each plan includes, and how billing works.',
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
