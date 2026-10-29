import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Economic Calendar for Crypto Traders',
  description:
    'The macro releases that move crypto - CPI, FOMC, jobs and rate decisions - with release times, previous figures and what is scheduled next.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/econ-calendar' },
};

export default function EconCalendarLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
