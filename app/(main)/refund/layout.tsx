import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Refund Policy',
  /* A DESCRIPTION OF ITS OWN (SEO audit, PM 2026-11-20): every page without one inherited the root's sentence, so six legal and contact pages shared it. 140-160 characters. */
  description:
    'The LiquidityHQ refund policy: how cancellation works, what happens to your billing period, the free trial, billing errors, chargebacks and EU withdrawal.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/terms/layout.tsx (#1185). */
  alternates: { canonical: '/refund' },
};

export default function RefundLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
