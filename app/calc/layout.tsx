import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Position Size Calculator',
  description:
    'Work out position size from account size, risk per trade and stop distance, with the leverage and liquidation distance that result.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/calc' },
};

export default function CalcLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
