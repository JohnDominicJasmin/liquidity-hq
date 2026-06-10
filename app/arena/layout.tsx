import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI Arena' };

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
