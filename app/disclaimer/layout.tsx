import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Disclaimer' };

export default function DisclaimerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
