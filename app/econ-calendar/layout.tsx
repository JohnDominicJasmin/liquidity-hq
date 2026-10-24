import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Economic Calendar for Crypto Traders',
  description:
    'The macro releases that move crypto - CPI, FOMC, jobs and rate decisions - with release times, previous figures and what is scheduled next.',
};

export default function EconCalendarLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
