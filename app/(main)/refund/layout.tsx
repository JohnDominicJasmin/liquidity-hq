import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Refund Policy',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/terms/layout.tsx (#1185). */
  alternates: { canonical: '/refund' },
};

export default function RefundLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
