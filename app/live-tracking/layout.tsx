import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Live Tracking' };

export default function LiveTrackingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
