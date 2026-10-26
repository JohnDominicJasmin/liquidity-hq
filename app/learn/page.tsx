import type { Metadata } from 'next';
import LearnContent from '@/components/LearnContent';

export const metadata: Metadata = {
  title: 'Crypto Trading Glossary - RSI, Funding Rate, Squeeze Score & More',
  description: 'Plain-English definitions for the momentum, order-flow, sentiment, and risk-management terms crypto traders use every day - RSI, funding rate, open interest, CVD, liquidation, squeeze score, and more.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/learn' },
  openGraph: {
    title: 'Crypto Trading Glossary - LiquidityHQ',
    description: 'Plain-English definitions for the terms crypto traders use every day.',
  },
};

export default function LearnPage() {
  return <LearnContent />;
}
