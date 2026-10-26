import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Best Hours to Trade Crypto',
  description:
    'Which hours of the day and days of the week actually see volume and volatility in crypto, broken down by trading session.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/hours' },
};

export default function HoursLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
