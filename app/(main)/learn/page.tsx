import type { Metadata } from 'next';
import LearnContent from '@/components/LearnContent';
import { OG_IMAGES } from '@/lib/seo';

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
    /* #1740 item 3: a local openGraph object REPLACES the root layout's, it does not merge with it - so defining title and
       description here silently dropped the root's `images`, and this page has had no share picture since it shipped. The constant
       keeps the three definitions from drifting; the url has already been wrong once (#1633). */
    images: OG_IMAGES,
  },
};

export default function LearnPage() {
  return <LearnContent />;
}
