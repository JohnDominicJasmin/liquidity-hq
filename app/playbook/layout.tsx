import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crypto Liquidity Playbook - Setups, Triggers & Risk Rules',
  description:
    'How to read liquidity on a crypto chart: where stops cluster, what a sweep looks like, which confirmations matter, and the risk rules that go with each setup.',
};

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
