import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Liquidity Playbook - Setups & Risk',
  description:
    'How to read liquidity on a crypto chart: where stops cluster, what a sweep looks like, which confirmations matter, and the risk rules that go with each setup.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/playbook' },
};

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
