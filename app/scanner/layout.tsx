import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Setup Scanner' };

export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
