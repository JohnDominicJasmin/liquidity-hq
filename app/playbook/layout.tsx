import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Liquidity Playbook' };

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
