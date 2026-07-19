import type { Metadata } from 'next';
import LearnContent from '@/components/LearnContent';

export const metadata: Metadata = {
  title: 'Crypto Trading Glossary - RSI, Funding Rate, Squeeze Score & More',
  description: 'Plain-English definitions for the momentum, order-flow, sentiment, and risk-management terms crypto traders use every day - RSI, funding rate, open interest, CVD, liquidation, squeeze score, and more.',
  openGraph: {
    title: 'Crypto Trading Glossary - LiquidityHQ',
    description: 'Plain-English definitions for the terms crypto traders use every day.',
  },
};

export default function LearnPage() {
  return <LearnContent />;
}
